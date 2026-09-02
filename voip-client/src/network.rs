use std::net::UdpSocket;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use crate::state::{ClientStatusPayload, PORT_DISCOVERY, SharedClientState};

pub fn discover_server(state: SharedClientState) {
    let socket = UdpSocket::bind("0.0.0.0:0").expect("Błąd bind discovery");
    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));

    loop {
        {
            let st = state.lock().unwrap();
            if !crate::licensing::is_activated() || !st.is_registered() || st.server_ip.is_some() {
                drop(st);
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
        }
        let _ = socket.send_to(b"VOIP_DISCOVER", format!("255.255.255.255:{}", PORT_DISCOVERY));
        let _ = socket.send_to(b"VOIP_DISCOVER", format!("127.0.0.1:{}", PORT_DISCOVERY));

        let mut buf = [0u8; 32];
        if let Ok((size, addr)) = socket.recv_from(&mut buf) {
            if size >= 9 && &buf[..9] == b"VOIP_HERE" {
                let mut st = state.lock().unwrap();
                let ip = addr.ip().to_string();
                st.server_ip = Some(if ip == "0.0.0.0" { "127.0.0.1".to_string() } else { ip });
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

pub fn discover_server_mdns(state: SharedClientState) {
    if let Ok(mdns) = mdns_sd::ServiceDaemon::new() {
        let service_type = "_voip._udp.local.";
        if let Ok(receiver) = mdns.browse(service_type) {
            while let Ok(event) = receiver.recv() {
                if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                    let mut addrs: Vec<String> = info.get_addresses().iter().map(|a| a.to_string()).collect();
                    addrs.sort_by_key(|a| if a.contains(':') { 1 } else { 0 });
                    if let Some(ip) = addrs.first() {
                        let mut st = state.lock().unwrap();
                        if crate::licensing::is_activated() && st.is_registered() && st.server_ip.is_none() {
                            st.server_ip = Some(ip.clone());
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
        let st = state.lock().unwrap();
        let payload = if !crate::licensing::is_activated() {
            ClientStatusPayload {
                connected: false,
                server_ip: "Wymagana aktywacja".to_string(),
                group: "Zablokowany".to_string(),
                is_speaking: false,
            }
        } else if !st.is_registered() {
            ClientStatusPayload {
                connected: false,
                server_ip: "Wpisz imię i nazwisko".to_string(),
                group: "Oczekiwanie".to_string(),
                is_speaking: false,
            }
        } else {
            ClientStatusPayload {
                connected: st.server_ip.is_some(),
                server_ip: st.server_ip.clone().unwrap_or_else(|| "Szukanie serwera...".to_string()),
                group: st.group.clone().unwrap_or_else(|| "Poczekalnia".to_string()),
                is_speaking: st.is_speaking,
            }
        };
        let _ = app_handle.emit("client_status", payload);
    }
}
