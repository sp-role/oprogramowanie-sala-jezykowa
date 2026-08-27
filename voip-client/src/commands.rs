use std::net::UdpSocket;
use tauri::State;
use crate::state::{PORT_DISCOVERY, SharedClientState};

#[tauri::command]
pub fn set_username(name: String, state: State<'_, SharedClientState>) {
    state.lock().unwrap().username = name;
}

#[tauri::command]
pub fn raise_hand(state: State<'_, SharedClientState>) {
    let st = state.lock().unwrap();
    if let Some(ip) = &st.server_ip {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let _ = socket.send_to(b"VOIP_HAND", format!("{}:{}", ip, PORT_DISCOVERY));
        }
    }
}
