use std::net::UdpSocket;
use tauri::State;
use crate::licensing;
use crate::state::{PORT_DISCOVERY, SharedClientState};

#[tauri::command]
pub fn set_username(name: String, state: State<'_, SharedClientState>) {
    if !licensing::is_activated() {
        return;
    }
    let mut st = state.lock().unwrap();
    st.username = name;
}

#[tauri::command]
pub fn raise_hand(state: State<'_, SharedClientState>) {
    if !licensing::is_activated() {
        return;
    }
    let st = state.lock().unwrap();
    if let Some(ip) = &st.server_ip {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let _ = socket.send_to(b"VOIP_HAND", format!("{}:{}", ip, PORT_DISCOVERY));
        }
    }
}

#[tauri::command]
pub fn get_hardware_id() -> String {
    licensing::get_hardware_id()
}

#[tauri::command]
pub fn check_activation() -> bool {
    licensing::is_activated()
}

#[tauri::command]
pub fn activate_license(code: String, token: Option<String>) -> Result<String, String> {
    let hw_id = licensing::get_hardware_id();
    if let Some(tok) = token {
        if !tok.trim().is_empty() {
            licensing::save_license_token(&hw_id, &code, &tok)?;
            return Ok("Stanowisko zostało pomyślnie aktywowane!".to_string());
        }
    }
    licensing::save_license(&hw_id, &code)?;
    Ok("Stanowisko zostało pomyślnie aktywowane!".to_string())
}
