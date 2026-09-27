use is_elevated::is_elevated;
use std::collections::VecDeque;
use std::net::UdpSocket;
use std::process::Command;
use std::time::Duration;
use tauri::State;
use crate::audio::SharedAudioStreams;
use crate::licensing;
use crate::state::{PORT_DISCOVERY, SharedClientState};

#[tauri::command]
pub fn check_admin() -> bool {
    is_elevated()
}

#[tauri::command]
pub fn check_firewall_rule() -> bool {
    #[cfg(windows)]
    {
        let check_rule = Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=VoIP Klient"])
            .output();

        check_rule.map(|out| out.status.success()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[cfg(windows)]
fn run_elevated_windows(cmd: &str, params: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct SHELLEXECUTEINFOW {
        cbSize: u32,
        fMask: u32,
        hwnd: *mut std::ffi::c_void,
        lpVerb: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShow: i32,
        hInstApp: *mut std::ffi::c_void,
        lpIDList: *mut std::ffi::c_void,
        lpClass: *const u16,
        hkeyClass: *mut std::ffi::c_void,
        dwHotKey: u32,
        hIconOrMonitor: *mut std::ffi::c_void,
        hProcess: *mut std::ffi::c_void,
    }

    const SEE_MASK_NOCLOSEPROCESS: u32 = 0x00000040;
    const SW_HIDE: i32 = 0;
    const INFINITE: u32 = 0xFFFFFFFF;
    const ERROR_CANCELLED: u32 = 1223;

    extern "system" {
        fn ShellExecuteExW(pExecInfo: *mut SHELLEXECUTEINFOW) -> i32;
        fn WaitForSingleObject(hHandle: *mut std::ffi::c_void, dwMilliseconds: u32) -> u32;
        fn GetExitCodeProcess(hProcess: *mut std::ffi::c_void, lpExitCode: *mut u32) -> i32;
        fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
        fn GetLastError() -> u32;
    }

    let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(Some(0)).collect();
    let file: Vec<u16> = OsStr::new(cmd).encode_wide().chain(Some(0)).collect();
    let parameters: Vec<u16> = OsStr::new(params).encode_wide().chain(Some(0)).collect();

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: ptr::null_mut(),
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        lpDirectory: ptr::null(),
        nShow: SW_HIDE,
        hInstApp: ptr::null_mut(),
        lpIDList: ptr::null_mut(),
        lpClass: ptr::null(),
        hkeyClass: ptr::null_mut(),
        dwHotKey: 0,
        hIconOrMonitor: ptr::null_mut(),
        hProcess: ptr::null_mut(),
    };

    let res = unsafe { ShellExecuteExW(&mut info) };
    if res == 0 {
        let err = unsafe { GetLastError() };
        if err == ERROR_CANCELLED {
            return Err("Anulowano autoryzację administratora.".to_string());
        }
        return Err(format!("Nie udało się wywołać okna uprawnień administratora (kod błędu: {})", err));
    }

    if !info.hProcess.is_null() {
        unsafe {
            WaitForSingleObject(info.hProcess, INFINITE);
            let mut exit_code: u32 = 0;
            GetExitCodeProcess(info.hProcess, &mut exit_code);
            CloseHandle(info.hProcess);
            if exit_code != 0 {
                return Err(format!("Operacja dodawania reguł zapory zakończyła się kodem błędu {}", exit_code));
            }
        }
    }

    Ok(())
}

pub fn apply_firewall_rules_internal() -> bool {
    #[cfg(windows)]
    {
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "delete", "rule", "name=VoIP Klient"])
            .output();
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "delete", "rule", "name=VoIP Klient mDNS"])
            .output();

        let current_exe = std::env::current_exe().unwrap_or_default();
        let exe_str = current_exe.to_str().unwrap_or("");

        let out_prog = if !exe_str.is_empty() {
            Command::new("netsh")
                .args([
                    "advfirewall", "firewall", "add", "rule",
                    "name=VoIP Klient", "dir=in", "action=allow",
                    &format!("program={}", exe_str),
                    "profile=any", "enable=yes",
                ])
                .output()
        } else {
            Command::new("netsh")
                .args([
                    "advfirewall", "firewall", "add", "rule",
                    "name=VoIP Klient", "dir=in", "action=allow",
                    "protocol=UDP", "profile=any", "enable=yes",
                ])
                .output()
        };

        let _ = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=VoIP Klient mDNS", "dir=in", "action=allow",
                "protocol=UDP", "localport=5353", "profile=any", "enable=yes",
            ])
            .output();

        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue",
            ])
            .output();

        out_prog.map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[tauri::command]
pub fn add_firewall_rule() -> Result<String, String> {
    #[cfg(windows)]
    {
        if is_elevated() {
            if apply_firewall_rules_internal() {
                Ok("Dodano trwałe wyjątki do Zapory Windows dla aplikacji klienta!".to_string())
            } else {
                Err("Nie udało się dodać reguł do zapory.".to_string())
            }
        } else {
            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Błąd lokalizacji pliku programu: {}", e))?;

            run_elevated_windows(current_exe.to_str().unwrap(), "--configure-firewall")?;
            Ok("Pomyślnie dodano wyjątki do Zapory Windows z uprawnieniami administratora!".to_string())
        }
    }
    #[cfg(not(windows))]
    {
        Ok("Konfiguracja zapory nie jest wymagana na tym systemie.".to_string())
    }
}

#[tauri::command]
pub fn set_username(name: String, state: State<'_, SharedClientState>) {
    if !licensing::is_activated() {
        return;
    }
    let mut st = state.lock().unwrap();
    st.username = name;
}

#[tauri::command]
pub fn join_lesson(name: String, state: State<'_, SharedClientState>) {
    if !licensing::is_activated() {
        return;
    }
    let mut st = state.lock().unwrap();
    st.username = name.trim().to_string();
    st.is_joined = true;
}

#[tauri::command]
pub fn raise_hand(state: State<'_, SharedClientState>) {
    if !licensing::is_activated() {
        return;
    }
    let mut st = state.lock().unwrap();
    st.hand_raised = true;
    if let Some(ip) = &st.server_ip {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let _ = socket.send_to(b"VOIP_HAND", format!("{}:{}", ip, PORT_DISCOVERY));
        }
    }
}

#[tauri::command]
pub fn toggle_raise_hand(state: State<'_, SharedClientState>) -> bool {
    if !licensing::is_activated() {
        return false;
    }
    let mut st = state.lock().unwrap();
    st.hand_raised = !st.hand_raised;
    let is_raised = st.hand_raised;
    if let Some(ip) = &st.server_ip {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let packet: &[u8] = if is_raised { b"VOIP_HAND" } else { b"VOIP_HAND_DOWN" };
            let _ = socket.send_to(packet, format!("{}:{}", ip, PORT_DISCOVERY));
        }
    }
    is_raised
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
    let is_mic_testing = st.mic_test_phase != "idle";
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
            mic_test_phase: st.mic_test_phase.clone(),
            mic_test_countdown: st.mic_test_countdown,
            room_members: vec![],
            is_joined: false,
            hand_raised: false,
            agc_enabled: st.agc_enabled,
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
            mic_test_phase: st.mic_test_phase.clone(),
            mic_test_countdown: st.mic_test_countdown,
            room_members: st.room_members.clone(),
            is_joined: st.is_joined,
            hand_raised: st.hand_raised,
            agc_enabled: st.agc_enabled,
        }
    }
}

#[tauri::command]
pub fn set_agc_enabled(enabled: bool, state: State<'_, SharedClientState>) {
    let mut st = state.lock().unwrap();
    st.agc_enabled = enabled;
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
    st.hand_raised = false;

    if let Some(ref server_ip) = st.server_ip {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let target = format!("{}:{}", server_ip, crate::state::PORT_AUDIO);
            let _ = socket.send_to(b"VOIP_LEAVE", &target);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn leave_lesson(state: State<'_, SharedClientState>) -> Result<(), String> {
    let mut st = state.lock().unwrap();
    st.is_joined = false;
    st.group = None;
    st.room_members.clear();
    st.hand_raised = false;

    if let Some(ref server_ip) = st.server_ip {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let target = format!("{}:{}", server_ip, crate::state::PORT_AUDIO);
            let _ = socket.send_to(b"VOIP_DISCONNECT", &target);
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
    eprintln!("[FRONTEND ERROR] {}: {:?}", message, stack);
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
pub fn start_mic_test(
    duration_secs: Option<f64>,
    state: State<'_, SharedClientState>,
    audio_streams: State<'_, SharedAudioStreams>,
) {
    let dur = duration_secs.unwrap_or(5.0).clamp(2.0, 15.0);
    println!("[TEST-MIC] Start procedury testu mikrofonu ({}s)", dur);
    {
        let mut st = state.lock().unwrap();
        st.is_mic_test_active = true;
        st.mic_test_phase = "recording".to_string();
        st.mic_test_until = crate::state::current_time() + dur;
        st.mic_test_countdown = dur;
        st.mic_record_buffer.clear();
    }
    {
        let mut streams = audio_streams.lock().unwrap();
        streams.remove("__mic_test__");
    }

    let state_clone = state.inner().clone();
    let streams_clone = audio_streams.inner().clone();

    // Wątek sterujący: 5s nagrywania głosu ucznia -> natychmiastowy czysty odsłuch w słuchawkach
    std::thread::spawn(move || {
        let start_time = crate::state::current_time();
        let record_end = start_time + dur;

        // Faza 1: Nagrywanie mowy (dokładnie `dur` sekund)
        while crate::state::current_time() < record_end {
            std::thread::sleep(Duration::from_millis(50));
            let mut st = state_clone.lock().unwrap();
            if st.mic_test_phase != "recording" {
                println!("[TEST-MIC] Przerwano nagrywanie ręcznie.");
                return;
            }
            let remaining = (record_end - crate::state::current_time()).max(0.0);
            st.mic_test_countdown = remaining;
        }

        // Pobranie zarejestrowanych próbek z bufora
        let mut recorded = {
            let mut st = state_clone.lock().unwrap();
            if st.mic_test_phase != "recording" {
                return;
            }
            std::mem::take(&mut st.mic_record_buffer)
        };

        println!("[TEST-MIC] Nagrywanie zakończone. Zarejestrowano próbek: {}", recorded.len());

        if recorded.is_empty() {
            eprintln!("[TEST-MIC BŁĄD] Bufor nagrania jest pusty (brak danych ze strumienia mikrofonu).");
            let mut st = state_clone.lock().unwrap();
            st.mic_test_phase = "idle".to_string();
            st.is_mic_test_active = false;
            st.mic_test_countdown = 0.0;
            return;
        }

        // Wygładzenie początku i końca (fade-in / fade-out 10ms = 480 próbek),
        // zapobiega to jakimkolwiek klikom na brzegach odtwarzanego bufora
        let fade_len = 480.min(recorded.len() / 2);
        for i in 0..fade_len {
            let factor = i as f32 / fade_len as f32;
            recorded[i] *= factor;
            let end_idx = recorded.len() - 1 - i;
            recorded[end_idx] *= factor;
        }

        let play_duration = recorded.len() as f64 / crate::state::SAMPLE_RATE as f64;
        println!("[TEST-MIC] Odsłuch nagrania w słuchawkach przez {:.1}s...", play_duration);

        // Faza 2: Czysty odsłuch nagrania w słuchawkach
        {
            let mut streams = streams_clone.lock().unwrap();
            streams.insert("__mic_test__".to_string(), VecDeque::from(recorded));
        }

        let play_start = crate::state::current_time();
        let play_end = play_start + play_duration;

        {
            let mut st = state_clone.lock().unwrap();
            st.mic_test_phase = "playing".to_string();
            st.mic_test_countdown = play_duration;
        }

        while crate::state::current_time() < play_end {
            std::thread::sleep(Duration::from_millis(50));
            let mut st = state_clone.lock().unwrap();
            if st.mic_test_phase != "playing" {
                println!("[TEST-MIC] Odsłuch przerwany ręcznie.");
                let mut streams = streams_clone.lock().unwrap();
                streams.remove("__mic_test__");
                return;
            }
            let remaining = (play_end - crate::state::current_time()).max(0.0);
            st.mic_test_countdown = remaining;
        }

        println!("[TEST-MIC] Procedura testu mikrofonu ukończona sukcesem.");

        // Zakończenie testu - powrót do stanu gotowości
        {
            let mut st = state_clone.lock().unwrap();
            if st.mic_test_phase == "playing" {
                st.mic_test_phase = "idle".to_string();
                st.is_mic_test_active = false;
                st.mic_test_countdown = 0.0;
            }
        }
        {
            let mut streams = streams_clone.lock().unwrap();
            streams.remove("__mic_test__");
        }
    });
}

#[tauri::command]
pub fn stop_mic_test(
    state: State<'_, SharedClientState>,
    audio_streams: State<'_, SharedAudioStreams>,
) {
    println!("[TEST-MIC] Wywołano stop_mic_test.");
    let mut st = state.lock().unwrap();
    st.is_mic_test_active = false;
    st.mic_test_phase = "idle".to_string();
    st.mic_test_countdown = 0.0;
    st.mic_record_buffer.clear();
    let mut streams = audio_streams.lock().unwrap();
    streams.remove("__mic_test__");
}


