use is_elevated::is_elevated;
use std::process::Command;
use tauri::State;
use crate::state::{PORT_AUDIO, PORT_DISCOVERY, SharedServerState};

#[tauri::command]
pub fn check_admin() -> bool {
    is_elevated()
}

#[tauri::command]
pub fn add_firewall_rule() -> Result<String, String> {
    if !is_elevated() {
        return Err("Brak uprawnień administratora!".to_string());
    }
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_str = exe_path.to_str().unwrap_or_default();
        let _ = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP Audio", "dir=in", "action=allow",
                "protocol=UDP", &format!("localport={}", PORT_AUDIO),
                &format!("program={}", exe_str), "enable=yes",
            ])
            .output();
        let _ = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP Discovery", "dir=in", "action=allow",
                "protocol=UDP", &format!("localport={}", PORT_DISCOVERY),
                &format!("program={}", exe_str), "enable=yes",
            ])
            .output();
        Ok("Dodano wyjątki zapory!".to_string())
    } else {
        Err("Błąd ścieżki exe.".to_string())
    }
}

#[tauri::command]
pub fn assign_client_room(ip: String, room: String, state: State<'_, SharedServerState>) {
    let mut st = state.lock().unwrap();
    let old_group = st.ip_to_group.get(&ip).cloned();
    if let Some(old) = old_group {
        if let Some(members) = st.groups.get_mut(&old) {
            members.retain(|m_ip| *m_ip != ip);
        }
    }
    if room != "Brak" {
        st.groups.entry(room.clone()).or_insert_with(Vec::new).push(ip.clone());
    }
    st.ip_to_group.insert(ip.clone(), room.clone());

    // Powiadomienie klienta przez UDP o zmianie pokoju roboczego
    if let Some(target_addr) = st.ip_to_addr.get(&ip) {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let msg = format!("VOIP_ROOM:{}", room);
            let _ = socket.send_to(msg.as_bytes(), target_addr);
        }
    }
}

#[tauri::command]
pub fn set_broadcast(active: bool, state: State<'_, SharedServerState>) {
    state.lock().unwrap().is_broadcasting = active;
}

#[tauri::command]
pub fn set_listen_room(room: Option<String>, state: State<'_, SharedServerState>) {
    state.lock().unwrap().listening_room = room;
}

#[tauri::command]
pub fn clear_hand(ip: String, state: State<'_, SharedServerState>) {
    if let Some(stat) = state.lock().unwrap().client_stats.get_mut(&ip) {
        stat.hand_raised = false;
    }
}
