use byteorder::{BigEndian, ReadBytesExt};
use std::collections::{HashSet, VecDeque};
use std::io::Cursor;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use crate::audio::TeacherAudioBuffer;
use crate::state::{
    current_time, ClientDisplayInfo, ClientStat, DashboardData, CLIENT_TIMEOUT_SECS,
    PORT_AUDIO, PORT_DISCOVERY, SAMPLE_RATE, SharedServerState,
};

#[derive(Clone, Debug)]
pub struct InterfaceV4 {
    pub ip: Ipv4Addr,
    pub netmask: Ipv4Addr,
    pub broadcast: Option<Ipv4Addr>,
}

impl InterfaceV4 {
    pub fn contains(&self, target: &Ipv4Addr) -> bool {
        let ip_u32 = u32::from_be_bytes(self.ip.octets());
        let mask_u32 = u32::from_be_bytes(self.netmask.octets());
        let target_u32 = u32::from_be_bytes(target.octets());

        (ip_u32 & mask_u32) == (target_u32 & mask_u32)
    }
}

pub fn get_local_v4_interfaces() -> Vec<InterfaceV4> {
    let mut ifaces = Vec::new();

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for iface in interfaces {
            let name_lower = iface.name.to_lowercase();

            if iface.is_loopback()
                || name_lower.contains("vethernet")
                || name_lower.contains("wsl")
                || name_lower.contains("virtual")
                || name_lower.contains("vmnet")
                || name_lower.contains("docker")
            {
                continue;
            }

            if let if_addrs::IfAddr::V4(ref v4) = iface.addr {
                if !v4.ip.is_link_local() && !v4.ip.is_loopback() {
                    ifaces.push(InterfaceV4 {
                        ip: v4.ip,
                        netmask: v4.netmask,
                        broadcast: v4.broadcast,
                    });
                }
            }
        }
    }

    ifaces.sort_by_key(|iface| {
        let octets = iface.ip.octets();
        if octets[0] == 192 && octets[1] == 168 {
            0
        } else if octets[0] == 10 {
            1
        } else if octets[0] == 172 && (16..=31).contains(&octets[1]) {
            2
        } else {
            3
        }
    });

    if ifaces.is_empty() {
        ifaces.push(InterfaceV4 {
            ip: Ipv4Addr::new(127, 0, 0, 1),
            netmask: Ipv4Addr::new(255, 0, 0, 0),
            broadcast: Some(Ipv4Addr::new(127, 255, 255, 255)),
        });
    }

    ifaces
}

pub fn get_local_ipv4_addrs() -> Vec<Ipv4Addr> {
    get_local_v4_interfaces().into_iter().map(|i| i.ip).collect()
}

pub fn get_discovery_broadcast_addrs() -> Vec<SocketAddr> {
    let mut targets = Vec::new();

    if let Ok(addr) = format!("255.255.255.255:{}", PORT_DISCOVERY).parse() {
        targets.push(addr);
    }
    if let Ok(addr) = format!("127.0.0.1:{}", PORT_DISCOVERY).parse() {
        targets.push(addr);
    }

    for iface in get_local_v4_interfaces() {
        if let Some(bcast) = iface.broadcast {
            targets.push(SocketAddr::V4(SocketAddrV4::new(bcast, PORT_DISCOVERY)));
        }
    }

    targets.sort();
    targets.dedup();
    targets
}

#[cfg(windows)]
pub fn disable_connreset(socket: &UdpSocket) {
    use std::os::windows::io::AsRawSocket;
    let raw = socket.as_raw_socket();
    let mut bytes_returned: u32 = 0;
    let flag: u32 = 0;
    const SIO_UDP_CONNRESET: u32 = 0x9800000C;
    #[link(name = "ws2_32")]
    extern "system" {
        fn WSAIoctl(
            s: usize,
            dwIoControlCode: u32,
            lpvInBuffer: *const u32,
            cbInBuffer: u32,
            lpvOutBuffer: *mut std::ffi::c_void,
            cbOutBuffer: u32,
            lpcbBytesReturned: *mut u32,
            lpOverlapped: *mut std::ffi::c_void,
            lpCompletionRoutine: Option<extern "system" fn(u32, u32, *mut std::ffi::c_void, u32)>,
        ) -> i32;
    }
    unsafe {
        let _ = WSAIoctl(
            raw as usize,
            SIO_UDP_CONNRESET,
            &flag,
            std::mem::size_of::<u32>() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
            None,
        );
    }
}

pub fn run_discovery_server(state: SharedServerState) {
    let socket = match UdpSocket::bind(("0.0.0.0", PORT_DISCOVERY)) {
        Ok(s) => {
            println!("[SERWER-DISC] Nasłuchiwanie na 0.0.0.0:{}", PORT_DISCOVERY);
            s
        }
        Err(e) => {
            eprintln!("[SERWER-DISC BŁĄD] Nie można zająć portu {}: {}", PORT_DISCOVERY, e);
            return;
        }
    };

    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
    #[cfg(windows)]
    disable_connreset(&socket);

    let mut buf = [0u8; 128];
    let mut last_announce = std::time::Instant::now() - Duration::from_secs(5);

    loop {
        if !crate::licensing::is_activated() {
            println!("[SERWER-DISC] Oczekiwanie na aktywację licencji...");
            std::thread::sleep(Duration::from_millis(1000));
            continue;
        }

        let interfaces = get_local_v4_interfaces();
        let primary_ip = interfaces.first().map(|i| i.ip).unwrap_or(Ipv4Addr::new(127, 0, 0, 1));

        if last_announce.elapsed() >= Duration::from_secs(2) {
            last_announce = std::time::Instant::now();
            let announce_msg = format!("VOIP_SERVER_ANNOUNCE:{}:{}", primary_ip, PORT_AUDIO);
            for bcast in get_discovery_broadcast_addrs() {
                let _ = socket.send_to(announce_msg.as_bytes(), bcast);
            }
        }

        match socket.recv_from(&mut buf) {
            Ok((size, addr)) => {
                let msg = String::from_utf8_lossy(&buf[..size]);

                // Wycisz pętlę echa z własnych pakietów rozgłoszeniowych serwera
                if msg.starts_with("VOIP_SERVER_ANNOUNCE") || msg.starts_with("VOIP_HERE") {
                    continue;
                }

                println!("[SERWER-DISC] Odebrano zapytanie od {}: '{}'", addr, msg);

                let client_v4 = match addr.ip() {
                    IpAddr::V4(v4) => Some(v4),
                    IpAddr::V6(_) => None,
                };

                let matched_iface = client_v4.and_then(|c_ip| {
                    interfaces.iter().find(|iface| iface.contains(&c_ip))
                });

                let reply_ip = if addr.ip().is_loopback() {
                    Ipv4Addr::new(127, 0, 0, 1)
                } else {
                    matched_iface.map(|i| i.ip).unwrap_or(primary_ip)
                };

                if msg.starts_with("VOIP_DISCOVER") {
                    let reply_msg = format!("VOIP_HERE:{}:{}", reply_ip, PORT_AUDIO);
                    println!("[SERWER-DISC] Odsyłam do {}: '{}'", addr, reply_msg);
                    let _ = socket.send_to(reply_msg.as_bytes(), addr);

                    if let Some(iface) = matched_iface {
                        if let Some(bcast) = iface.broadcast {
                            let bcast_addr = SocketAddr::V4(SocketAddrV4::new(bcast, PORT_DISCOVERY));
                            let _ = socket.send_to(reply_msg.as_bytes(), bcast_addr);
                        }
                    }
                } else if msg.starts_with("VOIP_PING") {
                    let reply_msg = format!("VOIP_PONG:{}:{}", reply_ip, PORT_AUDIO);
                    let _ = socket.send_to(reply_msg.as_bytes(), addr);
                } else if msg.starts_with("VOIP_HAND") {
                    let ip = addr.ip().to_string();
                    let mut st = state.lock().unwrap();
                    if let Some(stat) = st.client_stats.get_mut(&ip) {
                        stat.hand_raised = true;
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => {
                eprintln!("[SERWER-DISC RECV ERROR] {}", e);
            }
        }
    }
}

pub fn run_mdns_server() {
    let local_ips = get_local_ipv4_addrs();
    let primary_ip = local_ips.first().cloned().unwrap_or(Ipv4Addr::new(127, 0, 0, 1));
    let primary_ip_str = primary_ip.to_string();

    if let Ok(mdns) = mdns_sd::ServiceDaemon::new() {
        let service_type = "_voip._udp.local.";
        let instance_name = "VoIP_Server";
        let service_hostname = "voip-server.local.";
        let port = PORT_AUDIO;
        let disc_port_str = PORT_DISCOVERY.to_string();
        let audio_port_str = PORT_AUDIO.to_string();
        let properties = [
            ("discovery_port", disc_port_str.as_str()),
            ("audio_port", audio_port_str.as_str()),
            ("server_ip", primary_ip_str.as_str()),
        ];

        if let Ok(service_info) = mdns_sd::ServiceInfo::new(
            service_type,
            instance_name,
            service_hostname,
            &primary_ip_str,
            port,
            &properties[..],
        ) {
            println!("[SERWER-mDNS] Zarejestrowano usługę mDNS na IP: {}", primary_ip_str);
            let _ = mdns.register(service_info);
            std::thread::park();
        }
    }
}

pub fn run_udp_server(state: SharedServerState, teacher_audio_buffer: TeacherAudioBuffer) {
    let socket = match UdpSocket::bind(("0.0.0.0", PORT_AUDIO)) {
        Ok(s) => {
            println!("[SERWER-AUDIO] Port audio UDP aktywny na 0.0.0.0:{}", PORT_AUDIO);
            s
        }
        Err(e) => {
            eprintln!("[SERWER-AUDIO BŁĄD] Nie można zająć portu {}: {}", PORT_AUDIO, e);
            return;
        }
    };
    #[cfg(windows)]
    disable_connreset(&socket);

    if let Ok(cloned) = socket.try_clone() {
        state.lock().unwrap().audio_socket = Some(std::sync::Arc::new(cloned));
    }

    let mut buf = [0u8; 8192];
    loop {
        if !crate::licensing::is_activated() {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }

        if let Ok((size, addr)) = socket.recv_from(&mut buf) {
            let sender_ip = addr.ip().to_string();
            let recv_time = current_time();
            let data = &buf[..size];

            if size >= 13 {
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

                let display_name = if name_str.is_empty() {
                    format!("Uczeń ({})", sender_ip)
                } else {
                    name_str.to_string()
                };

                let is_new = !st.ip_to_group.contains_key(&sender_ip);
                if is_new {
                    println!("[SERWER-AUDIO] Nowy uczeń zarejestrowany: {} ({})", display_name, sender_ip);
                    st.ip_to_group.insert(sender_ip.clone(), "Brak".to_string());
                    let _ = socket.send_to(b"VOIP_ROOM:Brak", addr);
                } else if !has_audio {
                    let cur_room = st.ip_to_group.get(&sender_ip).cloned().unwrap_or_else(|| "Brak".to_string());
                    let pong = format!("VOIP_PONG:{}", cur_room);
                    let _ = socket.send_to(pong.as_bytes(), addr);
                }

                st.ip_to_name.insert(sender_ip.clone(), display_name);
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
                if (0.0..2000.0).contains(&latency) {
                    client_stat.latencies.push(latency);
                    if client_stat.latencies.len() > 15 {
                        client_stat.latencies.remove(0);
                    }
                }
                if seq_num > client_stat.last_seq + 1 {
                    client_stat.packets_lost += seq_num - client_stat.last_seq - 1;
                }
                client_stat.last_seq = seq_num;

                // Routing audio do innych uczniów
                if has_audio && !st.is_broadcasting {
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

pub fn run_dashboard_updater(
    app_handle: AppHandle,
    state: SharedServerState,
    media_player: crate::state::SharedMediaPlayer,
) {
    loop {
        std::thread::sleep(Duration::from_millis(200));
        if !crate::licensing::is_activated() {
            continue;
        }
        let now = current_time();
        let mut st = state.lock().unwrap();

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
        let mut total_pings_sum = 0.0;
        let mut total_pings_count = 0;
        let mut active_clients = vec![];

        for ip in &active_ips {
            if let Some(data) = st.client_stats.get(ip) {
                total_lost += data.packets_lost;
                total_recv += data.packets_recv;
                let group = st.ip_to_group.get(ip).cloned().unwrap_or_else(|| "Brak".to_string());
                let name = st.ip_to_name.get(ip).cloned().unwrap_or_else(|| "Uczeń".to_string());
                let is_speaking = (now - data.last_spoken) < 0.45;

                let avg_ping: u32 = if !data.latencies.is_empty() {
                    let sum: f64 = data.latencies.iter().sum();
                    total_pings_sum += sum;
                    total_pings_count += data.latencies.len();
                    (sum / data.latencies.len() as f64).round() as u32
                } else {
                    4
                };

                let client_total = data.packets_recv + data.packets_lost;
                let client_loss = if client_total > 0 {
                    ((data.packets_lost as f64 / client_total as f64) * 100.0 * 10.0).round() / 10.0
                } else {
                    0.0
                };

                let quality = if client_loss >= 8.0 || avg_ping >= 120 {
                    "poor".to_string()
                } else if client_loss >= 3.0 || avg_ping >= 60 {
                    "fair".to_string()
                } else if avg_ping >= 25 {
                    "good".to_string()
                } else {
                    "excellent".to_string()
                };

                active_clients.push(ClientDisplayInfo {
                    ip: ip.clone(),
                    name,
                    group,
                    hand_raised: data.hand_raised,
                    is_speaking,
                    ping_ms: avg_ping,
                    loss_pct: client_loss,
                    quality,
                });
            }
        }

        let loss_percentage = if total_recv + total_lost > 0 {
            (total_lost as f64 / (total_recv + total_lost) as f64) * 100.0
        } else {
            0.0
        };

        let avg_latency = if total_pings_count > 0 {
            total_pings_sum / total_pings_count as f64
        } else {
            0.0
        };

        let media_status = crate::audio::get_media_status(&media_player);

        if let Err(e) = app_handle.emit(
            "dashboard_update",
            DashboardData {
                mbps,
                avg_latency,
                loss_percentage,
                active_clients,
                media_status,
            },
        ) {
            eprintln!("[SERWER-DASHBOARD EMIT BŁĄD]: {}", e);
        }
    }
}