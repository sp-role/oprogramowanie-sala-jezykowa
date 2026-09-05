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
pub fn set_server_ip(ip: String, state: State<'_, SharedClientState>) -> Result<String, String> {
    let clean = ip.trim();
    if clean.is_empty() || clean.eq_ignore_ascii_case("auto") {
        let mut st = state.lock().unwrap();
        st.server_ip = None;
        st.manual_server_ip = false;
        st.last_server_packet = 0.0;
        return Ok("Włączono automatyczne wykrywanie serwera.".to_string());
    }

    if let Ok(ipv4) = clean.parse::<std::net::Ipv4Addr>() {
        let mut st = state.lock().unwrap();
        st.server_ip = Some(ipv4.to_string());
        st.manual_server_ip = true;
        st.last_server_packet = crate::state::current_time();

        // Natychmiastowe wysłanie pakietu sprawdzającego
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            let _ = sock.send_to(b"VOIP_DISCOVER", format!("{}:{}", ipv4, PORT_DISCOVERY));
        }

        Ok(format!("Ustawiono adres serwera: {}", ipv4))
    } else {
        Err("Wprowadź poprawny adres IPv4 serwera (np. 192.168.0.94)".to_string())
    }
}

#[tauri::command]
pub fn get_server_ip(state: State<'_, SharedClientState>) -> Option<String> {
    state.lock().unwrap().server_ip.clone()
}

#[tauri::command]
pub fn get_client_status(state: State<'_, SharedClientState>) -> crate::state::ClientStatusPayload {
    let st = state.lock().unwrap();
    let is_conn = st.server_ip.is_some();
    let now = crate::state::current_time();
    let is_mic_testing = st.is_mic_test_active && now < st.mic_test_until;
    if !licensing::is_activated() {
        crate::state::ClientStatusPayload {
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
            room_members: vec![],
        }
    } else {
        crate::state::ClientStatusPayload {
            connected: is_conn,
            server_ip: if is_conn {
                st.server_ip.clone().unwrap_or_default()
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
            room_members: st.room_members.clone(),
        }
    }
}

#[tauri::command]
pub fn toggle_self_mute(state: State<'_, SharedClientState>) -> bool {
    let mut st = state.lock().unwrap();
    st.is_self_muted = !st.is_self_muted;
    st.is_self_muted
}

#[tauri::command]
pub fn leave_room(state: State<'_, SharedClientState>) -> Result<(), String> {
    let mut st = state.lock().unwrap();
    st.group = Some("Poczekalnia".to_string());
    st.room_members.clear();

    if let Some(ref server_ip) = st.server_ip {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let target = format!("{}:{}", server_ip, crate::state::PORT_AUDIO);
            let _ = socket.send_to(b"VOIP_LEAVE", &target);
        }
    }
    Ok(())
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
pub fn activate_license(code: String) -> Result<String, String> {
    let hw_id = licensing::get_hardware_id();
    licensing::save_license(&hw_id, &code)?;
    Ok("Stanowisko zostało pomyślnie aktywowane!".to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    crate::updater::get_current_version()
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<crate::updater::UpdateCheckResult, String> {
    crate::updater::check_update(&app).await
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    crate::updater::install_latest_update(&app).await
}

#[tauri::command]
pub fn window_start_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub fn report_frontend_error(message: String, stack: Option<String>) {
    crate::telemetry::capture_error(&message, stack.as_deref());
}

#[tauri::command]
pub fn get_audio_devices(state: State<'_, SharedClientState>) -> crate::state::AudioDevicesInfo {
    let (inputs, outputs) = crate::audio::list_audio_devices();
    let st = state.lock().unwrap();
    crate::state::AudioDevicesInfo {
        input_devices: inputs,
        output_devices: outputs,
        selected_input: st.selected_input_device.clone(),
        selected_output: st.selected_output_device.clone(),
    }
}

#[tauri::command]
pub fn set_input_device(device_name: String, state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.selected_input_device = if device_name == "default" || device_name.is_empty() {
        None
    } else {
        Some(device_name)
    };
}

#[tauri::command]
pub fn set_output_device(device_name: String, state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.selected_output_device = if device_name == "default" || device_name.is_empty() {
        None
    } else {
        Some(device_name)
    };
}

#[tauri::command]
pub fn play_test_sound(streams: State<'_, crate::audio::SharedAudioStreams>) {
    crate::audio::play_test_chime(&streams);
}

#[tauri::command]
pub fn set_vad_threshold(threshold: f32, state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.vad_threshold = threshold.clamp(0.005, 0.200);
}

#[tauri::command]
pub fn set_client_volume(volume: f32, state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.volume = volume.clamp(0.0, 2.0);
}

#[tauri::command]
pub fn start_mic_test(duration_secs: Option<f64>, state: State<'_, SharedClientState>) {
    let dur = duration_secs.unwrap_or(5.0).clamp(1.0, 30.0);
    let mut st = state.lock().unwrap();
    st.is_mic_test_active = true;
    st.mic_test_until = crate::state::current_time() + dur;
}

#[tauri::command]
pub fn stop_mic_test(state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.is_mic_test_active = false;
    st.mic_test_until = 0.0;
}


