use std::net::{SocketAddr, SocketAddrV4, UdpSocket};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use crate::state::{current_time, ClientStatusPayload, PORT_DISCOVERY, SERVER_TIMEOUT_SECS, SharedClientState};

pub fn get_broadcast_targets() -> Vec<SocketAddr> {
    let mut targets = Vec::new();

    if let Ok(addr) = format!("255.255.255.255:{}", PORT_DISCOVERY).parse() {
        targets.push(addr);
    }
    if let Ok(addr) = format!("127.0.0.1:{}", PORT_DISCOVERY).parse() {
        targets.push(addr);
    }

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
                if v4.ip.is_link_local() || v4.ip.is_loopback() {
                    continue;
                }
                if let Some(bcast) = v4.broadcast {
                    targets.push(SocketAddr::V4(SocketAddrV4::new(bcast, PORT_DISCOVERY)));
                }
            }
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

fn parse_server_response(msg: &str, fallback_addr: SocketAddr) -> Option<String> {
    if let Some(rest) = msg.strip_prefix("VOIP_HERE:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if !parts.is_empty() && !parts[0].is_empty() {
            return Some(sanitize_ip(parts[0]));
        }
    } else if let Some(rest) = msg.strip_prefix("VOIP_SERVER_ANNOUNCE:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if !parts.is_empty() && !parts[0].is_empty() {
            return Some(sanitize_ip(parts[0]));
        }
    } else if msg.trim() == "VOIP_HERE" {
        let ip_str = fallback_addr.ip().to_string();
        if ip_str != "127.0.0.1" && ip_str != "0.0.0.0" {
            return Some(sanitize_ip(&ip_str));
        }
    }

    None
}

fn sanitize_ip(ip: &str) -> String {
    let trimmed = ip.trim();
    if trimmed == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn discover_server(state: SharedClientState) {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => {
            println!("[KLIENT-DISC] Gniazdo discovery zbindowane na: {:?}", s.local_addr());
            s
        }
        Err(e) => {
            eprintln!("[KLIENT-DISC BŁĄD] Nie można zbindować gniazda: {}", e);
            return;
        }
    };

    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    #[cfg(windows)]
    disable_connreset(&socket);

    let mut buf = [0u8; 256];

    loop {
        let has_server = {
            let mut st = state.lock().unwrap();
            let now = current_time();
            // Watchdog utraty łączności (jeśli minęło > SERVER_TIMEOUT_SECS od ostatniego pakietu i nie jest to ręcznie wpisany IP)
            if st.server_ip.is_some() && !st.manual_server_ip && (now - st.last_server_packet > SERVER_TIMEOUT_SECS) {
                println!("[KLIENT-DISC] Brak sygnału z serwera przez ponad {}s. Resetuję sesję i wznawiam szukanie...", SERVER_TIMEOUT_SECS);
                st.server_ip = None;
                st.group = None;
                st.is_speaking = false;
                st.is_muted_by_teacher = false;
            }
            st.server_ip.is_some()
        };

        // Gdy serwer jest już przypisany, wstrzymaj nadawanie zapytań
        if has_server {
            if let Ok((size, _)) = socket.recv_from(&mut buf) {
                let msg = String::from_utf8_lossy(&buf[..size]);
                if msg.starts_with("VOIP_SERVER_ANNOUNCE") || msg.starts_with("VOIP_HERE") {
                    let mut st = state.lock().unwrap();
                    st.last_server_packet = current_time();
                }
            }
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }

        if !crate::licensing::is_activated() {
            std::thread::sleep(Duration::from_millis(1000));
            continue;
        }

        let targets = get_broadcast_targets();
        println!("[KLIENT-DISC] Wysyłam VOIP_DISCOVER do celów: {:?}", targets);
        for target in &targets {
            let _ = socket.send_to(b"VOIP_DISCOVER", target);
        }

        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_millis(800) {
            match socket.recv_from(&mut buf) {
                Ok((size, addr)) => {
                    let msg = String::from_utf8_lossy(&buf[..size]);
                    if let Some(ip) = parse_server_response(&msg, addr) {
                        let mut st = state.lock().unwrap();
                        println!("[KLIENT-DISC] ZNALEZIONO SERWER: {}. Blokuję dalsze discovery.", ip);
                        st.server_ip = Some(ip);
                        st.last_server_packet = current_time();
                        break;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => {
                    continue;
                }
                Err(_) => continue,
            }
        }

        std::thread::sleep(Duration::from_millis(1000));
    }
}

pub fn discover_server_mdns(state: SharedClientState) {
    if let Ok(mdns) = mdns_sd::ServiceDaemon::new() {
        let service_type = "_voip._udp.local.";
        if let Ok(receiver) = mdns.browse(service_type) {
            while let Ok(event) = receiver.recv() {
                if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                    let mut resolved_ip: Option<String> = None;

                    if let Some(prop) = info.get_property("server_ip") {
                        let val = prop.val_str().trim();
                        if !val.is_empty() {
                            resolved_ip = Some(val.to_string());
                        }
                    }

                    if resolved_ip.is_none() {
                        let addrs: Vec<String> = info
                            .get_addresses()
                            .iter()
                            .filter(|a| a.is_ipv4())
                            .map(|a| a.to_string())
                            .collect();
                        if let Some(ip) = addrs.first() {
                            resolved_ip = Some(ip.clone());
                        }
                    }

                    if let Some(ip) = resolved_ip {
                        let mut st = state.lock().unwrap();
                        if crate::licensing::is_activated() && st.server_ip.is_none() {
                            let clean_ip = sanitize_ip(&ip);
                            println!("[KLIENT-mDNS SUKCES] Znaleziono serwer przez mDNS: {}", clean_ip);
                            st.server_ip = Some(clean_ip);
                            st.last_server_packet = current_time();
                        }
                    }
                }
            }
        }
    }
}

pub fn run_ui_updater(app_handle: AppHandle, state: SharedClientState) {
    loop {
        std::thread::sleep(Duration::from_millis(150));
        let now = current_time();
        let mut st = state.lock().unwrap();

        let is_timed_out = (now - st.last_server_packet) > SERVER_TIMEOUT_SECS;
        if is_timed_out && !st.manual_server_ip && st.server_ip.is_some() {
            st.server_ip = None;
            st.group = None;
            st.is_speaking = false;
            st.is_muted_by_teacher = false;
        }

        let is_conn = st.server_ip.is_some() && !is_timed_out;
        let is_mic_testing = st.mic_test_phase != "idle";
        let payload = if !crate::licensing::is_activated() {
            ClientStatusPayload {
                connected: false,
                server_ip: "Wymagana aktywacja".to_string(),
                group: "Zablokowany".to_string(),
                is_speaking: false,
                is_muted_by_teacher: false,
                is_self_muted: st.is_self_muted,
                mic_level: st.mic_level,
                vad_threshold: st.vad_threshold,
                volume: st.volume,
                is_mic_test_active: is_mic_testing,
                mic_test_phase: st.mic_test_phase.clone(),
                mic_test_countdown: st.mic_test_countdown,
                room_members: vec![],
            }
        } else {
            ClientStatusPayload {
                connected: is_conn,
                server_ip: if is_conn {
                    st.server_ip.clone().unwrap_or_default()
                } else if st.server_ip.is_some() && is_timed_out {
                    "Brak odpowiedzi serwera...".to_string()
                } else {
                    "Szukanie serwera...".to_string()
                },
                group: st.group.clone().unwrap_or_else(|| "Poczekalnia".to_string()),
                is_speaking: st.is_speaking,
                is_muted_by_teacher: st.is_muted_by_teacher,
                is_self_muted: st.is_self_muted,
                mic_level: st.mic_level,
                vad_threshold: st.vad_threshold,
                volume: st.volume,
                is_mic_test_active: is_mic_testing,
                mic_test_phase: st.mic_test_phase.clone(),
                mic_test_countdown: st.mic_test_countdown,
                room_members: st.room_members.clone(),
            }
        };
        drop(st);
        let _ = app_handle.emit("client_status", payload);
    }
}