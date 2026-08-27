use byteorder::{BigEndian, ReadBytesExt};
use std::collections::{HashSet, VecDeque};
use std::io::Cursor;
use std::net::UdpSocket;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use crate::audio::TeacherAudioBuffer;
use crate::state::{
    current_time, ClientDisplayInfo, ClientStat, DashboardData, CLIENT_TIMEOUT_SECS,
    PORT_AUDIO, PORT_DISCOVERY, SAMPLE_RATE, SharedServerState,
};

pub fn run_discovery_server(state: SharedServerState) {
    let socket = UdpSocket::bind(("0.0.0.0", PORT_DISCOVERY)).expect("Błąd portu discovery");
    let mut buf = [0u8; 32];
    loop {
        if let Ok((size, addr)) = socket.recv_from(&mut buf) {
            if size >= 13 && &buf[..13] == b"VOIP_DISCOVER" {
                let _ = socket.send_to(b"VOIP_HERE", addr);
            } else if size >= 9 && &buf[..9] == b"VOIP_HAND" {
                let ip = addr.ip().to_string();
                let mut st = state.lock().unwrap();
                if let Some(stat) = st.client_stats.get_mut(&ip) {
                    stat.hand_raised = true;
                }
            }
        }
    }
}

pub fn run_mdns_server() {
    if let Ok(mdns) = mdns_sd::ServiceDaemon::new() {
        let service_type = "_voip._udp.local.";
        let instance_name = "VoIP_Server";
        let service_hostname = "voip-server._voip._udp.local.";
        let port = PORT_AUDIO;
        let properties = [("discovery_port", "5006")];

        if let Ok(service_info) = mdns_sd::ServiceInfo::new(
            service_type,
            instance_name,
            service_hostname,
            "",
            port,
            &properties[..],
        ) {
            let service_info = service_info.enable_addr_auto();
            let _ = mdns.register(service_info);
            std::thread::park();
        }
    }
}

pub fn run_udp_server(state: SharedServerState, teacher_audio_buffer: TeacherAudioBuffer) {
    let socket = UdpSocket::bind(("0.0.0.0", PORT_AUDIO)).expect("Błąd portu audio");
    let mut buf = [0u8; 8192];
    loop {
        if let Ok((size, addr)) = socket.recv_from(&mut buf) {
            let sender_ip = addr.ip().to_string();
            let recv_time = current_time();
            let data = &buf[..size];

            if size > 13 {
                let mut cursor = Cursor::new(&data[0..12]);
                let seq_num = cursor.read_u32::<BigEndian>().unwrap_or(0);
                let send_time = cursor.read_f64::<BigEndian>().unwrap_or(0.0);
                let name_len = data[12] as usize;
                let header_offset = 13 + name_len;

                let mut max_amp: i16 = 0;
                let has_audio = size > header_offset;
                if has_audio {
                    let mut audio_cursor = Cursor::new(&data[header_offset..size]);
                    while let Ok(sample_i16) = audio_cursor.read_i16::<BigEndian>() {
                        max_amp = max_amp.max(sample_i16.saturating_abs());
                    }
                }

                let mut st = state.lock().unwrap();
                st.ip_to_addr.insert(sender_ip.clone(), addr);

                let name_str = if size >= header_offset && name_len > 0 {
                    std::str::from_utf8(&data[13..header_offset]).unwrap_or("").trim()
                } else {
                    ""
                };

                // Blokada nienazwanych uczniów - nie rejestrujemy w poczekalni dopóki uczeń nie poda imienia
                if name_str.is_empty() || name_str == "Uczeń" {
                    continue;
                }

                st.ip_to_name.insert(sender_ip.clone(), name_str.to_string());

                let is_new = !st.ip_to_group.contains_key(&sender_ip);
                if is_new {
                    st.ip_to_group.insert(sender_ip.clone(), "Brak".to_string());
                    let _ = socket.send_to(b"VOIP_ROOM:Brak", addr);
                }

                st.total_bytes_sec += size;

                let client_stat = st.client_stats.entry(sender_ip.clone()).or_insert(ClientStat {
                    last_seq: seq_num,
                    packets_recv: 0,
                    packets_lost: 0,
                    latencies: vec![],
                    last_seen: recv_time,
                    hand_raised: false,
                    last_spoken: 0.0,
                });
                client_stat.last_seen = recv_time;
                client_stat.packets_recv += 1;

                if max_amp > 800 {
                    client_stat.last_spoken = recv_time;
                }

                let latency = (recv_time - send_time) * 1000.0;
                if latency > 0.0 && latency < 2000.0 {
                    client_stat.latencies.push(latency);
                }
                if seq_num > client_stat.last_seq + 1 {
                    client_stat.packets_lost += seq_num - client_stat.last_seq - 1;
                }
                client_stat.last_seq = seq_num;

                // Routing audio pakietu do innych uczniów w tym samym pokoju
                if has_audio {
                    if let Some(group_name) = st.ip_to_group.get(&sender_ip) {
                        if let Some(members) = st.groups.get(group_name).cloned() {
                            for target_ip in members {
                                if target_ip != sender_ip {
                                    if let Some(target_addr) = st.ip_to_addr.get(&target_ip) {
                                        let _ = socket.send_to(data, target_addr);
                                    }
                                }
                            }
                        }

                        // Podsłuch dla nauczyciela z miksowaniem per uczeń i adaptacyjnym buforem 150 ms
                        if st.listening_room.as_ref() == Some(group_name) {
                            let mut audio_cursor = Cursor::new(&data[header_offset..size]);
                            let mut decoded = Vec::new();
                            while let Ok(sample_i16) = audio_cursor.read_i16::<BigEndian>() {
                                decoded.push((sample_i16 as f32) / 32767.0);
                            }
                            let mut t_streams = teacher_audio_buffer.lock().unwrap();
                            let buf = t_streams.entry(sender_ip.clone()).or_insert_with(VecDeque::new);

                            let max_jitter_samples = (SAMPLE_RATE as usize * 150) / 1000;
                            let target_jitter_samples = (SAMPLE_RATE as usize * 40) / 1000;
                            if buf.len() > max_jitter_samples {
                                let drain_count = buf.len() - target_jitter_samples;
                                buf.drain(..drain_count);
                            }
                            buf.extend(decoded);
                        }
                    }
                }
            }
        }
    }
}

pub fn run_dashboard_updater(app_handle: AppHandle, state: SharedServerState) {
    loop {
        std::thread::sleep(Duration::from_millis(200));
        let now = current_time();
        let mut st = state.lock().unwrap();

        // Wykrywanie aktywnych uczniów i automatyczny timeout dla rozłączonych
        let active_ips: HashSet<String> = st
            .client_stats
            .iter()
            .filter(|(_, data)| now - data.last_seen < CLIENT_TIMEOUT_SECS)
            .map(|(ip, _)| ip.clone())
            .collect();

        let mbps = (st.total_bytes_sec as f64 * 8.0 * 5.0) / (1024.0 * 1024.0);
        st.total_bytes_sec = 0;

        let mut total_lost = 0;
        let mut total_recv = 0;
        let mut active_clients = vec![];

        for ip in &active_ips {
            if let Some(data) = st.client_stats.get(ip) {
                total_lost += data.packets_lost;
                total_recv += data.packets_recv;
                let group = st.ip_to_group.get(ip).cloned().unwrap_or_else(|| "Brak".to_string());
                let name = st.ip_to_name.get(ip).cloned().unwrap_or_else(|| "Uczeń".to_string());
                let is_speaking = (now - data.last_spoken) < 0.45;

                active_clients.push(ClientDisplayInfo {
                    ip: ip.clone(),
                    name,
                    group,
                    hand_raised: data.hand_raised,
                    is_speaking,
                });
            }
        }

        let loss_percentage = if total_recv + total_lost > 0 {
            (total_lost as f64 / (total_recv + total_lost) as f64) * 100.0
        } else {
            0.0
        };

        let _ = app_handle.emit(
            "dashboard_update",
            DashboardData {
                mbps,
                avg_latency: 0.0,
                loss_percentage,
                active_clients,
            },
        );
    }
}
