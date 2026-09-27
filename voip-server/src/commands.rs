use is_elevated::is_elevated;
use std::process::Command;
use tauri::State;
use crate::state::{PORT_AUDIO, PORT_DISCOVERY, SharedServerState};

#[tauri::command]
pub fn check_admin() -> bool {
    is_elevated()
}

#[tauri::command]
pub fn check_firewall_rule() -> bool {
    #[cfg(windows)]
    {
        let check_audio = Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=Serwer VoIP Audio"])
            .output();

        let check_discovery = Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=Serwer VoIP Discovery"])
            .output();

        let audio_ok = check_audio.map(|out| out.status.success()).unwrap_or(false);
        let disc_ok = check_discovery.map(|out| out.status.success()).unwrap_or(false);

        audio_ok && disc_ok
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
            .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP Audio"])
            .output();
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP Discovery"])
            .output();
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP Ping ICMP"])
            .output();
        let _ = Command::new("netsh")
            .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP mDNS"])
            .output();

        let out_audio = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP Audio", "dir=in", "action=allow",
                "protocol=UDP", &format!("localport={}", PORT_AUDIO),
                "profile=any", "enable=yes",
            ])
            .output();

        let out_disc = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP Discovery", "dir=in", "action=allow",
                "protocol=UDP", &format!("localport={}", PORT_DISCOVERY),
                "profile=any", "enable=yes",
            ])
            .output();

        let _ = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP Ping ICMP", "dir=in", "action=allow",
                "protocol=icmpv4:8,any", "profile=any", "enable=yes",
            ])
            .output();

        let _ = Command::new("netsh")
            .args([
                "advfirewall", "firewall", "add", "rule",
                "name=Serwer VoIP mDNS", "dir=in", "action=allow",
                "protocol=UDP", "localport=5353", "profile=any", "enable=yes",
            ])
            .output();

        // Przełączenie sieci na profil prywatny
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue",
            ])
            .output();

        let audio_ok = out_audio.map(|o| o.status.success()).unwrap_or(false);
        let disc_ok = out_disc.map(|o| o.status.success()).unwrap_or(false);
        audio_ok && disc_ok
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
                Ok("Dodano trwałe wyjątki portów (5005, 5006 UDP) do Zapory Windows!".to_string())
            } else {
                Err("Nie udało się dodać reguł do zapory.".to_string())
            }
        } else {
            // Brak uprawnień administratora - uruchom tę samą aplikację serwera jako administrator z flagą konfiguracyjną (w oknie UAC pojawi się nazwa aplikacji)
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
pub fn assign_client_room(ip: String, room: String, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let mut st = state.lock().unwrap();
    let old_room = st.ip_to_group.get(&ip).cloned().unwrap_or_else(|| "Brak".to_string());

    for (_, members) in st.groups.iter_mut() {
        members.retain(|x| x != &ip);
    }
    if room != "Brak" {
        st.groups.entry(room.clone()).or_insert_with(Vec::new).push(ip.clone());
    }
    st.ip_to_group.insert(ip.clone(), room.clone());
    println!("[SERWER] Przypisano klienta {} do pokoju: '{}'", ip, room);

    let now = crate::state::current_time();
    let new_members = crate::network::get_room_members_payload(&st, &room, now);
    let new_json = serde_json::to_string(&new_members).unwrap_or_default();
    let msg_new = format!("VOIP_ROOM:{}|{}", room, new_json);

    // Wyślij do przypisanego klienta
    if let Some(target_addr) = st.ip_to_addr.get(&ip).cloned() {
        if let Some(ref sock) = st.audio_socket {
            for _ in 0..3 {
                let _ = sock.send_to(msg_new.as_bytes(), target_addr);
            }
        }
    }

    // Wyślij do pozostałych członków nowego pokoju
    if room != "Brak" {
        if let Some(ips) = st.groups.get(&room).cloned() {
            for mem_ip in ips {
                if mem_ip != ip {
                    if let Some(target_addr) = st.ip_to_addr.get(&mem_ip).cloned() {
                        if let Some(ref sock) = st.audio_socket {
                            for _ in 0..2 {
                                let _ = sock.send_to(msg_new.as_bytes(), target_addr);
                            }
                        }
                    }
                }
            }
        }
    } else {
        let other_pool_ips: Vec<String> = st.ip_to_group.iter().filter(|(k, v)| *v == "Brak" && *k != &ip).map(|(k, _)| k.clone()).collect();
        for other_ip in other_pool_ips {
            if let Some(target_addr) = st.ip_to_addr.get(&other_ip).cloned() {
                if let Some(ref sock) = st.audio_socket {
                    let _ = sock.send_to(msg_new.as_bytes(), target_addr);
                }
            }
        }
    }

    // Powiadom stary pokój o odejściu klienta
    if old_room != room {
        let old_members = crate::network::get_room_members_payload(&st, &old_room, now);
        let old_json = serde_json::to_string(&old_members).unwrap_or_default();
        let msg_old = format!("VOIP_ROOM:{}|{}", old_room, old_json);
        let target_ips: Vec<String> = if old_room != "Brak" {
            st.groups.get(&old_room).cloned().unwrap_or_default()
        } else {
            st.ip_to_group.iter().filter(|(k, v)| *v == "Brak" && *k != &ip).map(|(k, _)| k.clone()).collect()
        };
        for mem_ip in target_ips {
            if let Some(target_addr) = st.ip_to_addr.get(&mem_ip).cloned() {
                if let Some(ref sock) = st.audio_socket {
                    for _ in 0..2 {
                        let _ = sock.send_to(msg_old.as_bytes(), target_addr);
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_room(room: String, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let mut st = state.lock().unwrap();

    if st.listening_room.as_deref() == Some(&room) {
        st.listening_room = None;
    }

    if let Some(members) = st.groups.remove(&room) {
        for ip in &members {
            st.ip_to_group.insert(ip.clone(), "Brak".to_string());
        }
        let now = crate::state::current_time();
        let pool_members = crate::network::get_room_members_payload(&st, "Brak", now);
        let pool_json = serde_json::to_string(&pool_members).unwrap_or_default();
        let msg = format!("VOIP_ROOM:Brak|{}", pool_json);
        for ip in st.ip_to_group.iter().filter(|(_, v)| *v == "Brak").map(|(k, _)| k.clone()).collect::<Vec<_>>() {
            if let Some(target_addr) = st.ip_to_addr.get(&ip).cloned() {
                if let Some(ref sock) = st.audio_socket {
                    for _ in 0..2 {
                        let _ = sock.send_to(msg.as_bytes(), target_addr);
                    }
                }
            }
        }
    }

    println!("[SERWER] Usunięto pokój '{}' i zresetowano jego uczestników do Poczekalni", room);
    Ok(())
}

#[tauri::command]
pub fn reset_all_to_pool(state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let mut st = state.lock().unwrap();
    st.groups.clear();
    let ips: Vec<String> = st.client_stats.keys().cloned().collect();
    for ip in &ips {
        st.ip_to_group.insert(ip.clone(), "Brak".to_string());
    }
    let now = crate::state::current_time();
    let pool_members = crate::network::get_room_members_payload(&st, "Brak", now);
    let pool_json = serde_json::to_string(&pool_members).unwrap_or_default();
    let msg = format!("VOIP_ROOM:Brak|{}", pool_json);
    for ip in &ips {
        if let Some(target_addr) = st.ip_to_addr.get(ip).cloned() {
            if let Some(ref sock) = st.audio_socket {
                for _ in 0..2 {
                    let _ = sock.send_to(msg.as_bytes(), target_addr);
                }
            }
        }
    }
    println!("[SERWER] Zresetowano wszystkich uczniów ({}) do Poczekalni", ips.len());
    Ok(())
}

#[tauri::command]
pub fn auto_pair_clients(mut rooms: Vec<String>, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let now = crate::state::current_time();
    let mut st = state.lock().unwrap();

    // Pobierz aktywnych klientów
    let mut active_ips: Vec<String> = st
        .client_stats
        .iter()
        .filter(|(_, data)| now - data.last_seen < crate::state::CLIENT_TIMEOUT_SECS)
        .map(|(ip, _)| ip.clone())
        .collect();

    if active_ips.is_empty() {
        return Err("Brak połączonych uczniów do rozlosowania w pary.".to_string());
    }

    // Losowe przetasowanie metodą Fisher-Yates (prosty generator pseudo-losowy Xorshift)
    let mut rng_state = (crate::state::current_time() * 1_000_000.0) as u64 ^ 0x5DEECE66D;
    let len = active_ips.len();
    for i in (1..len).rev() {
        rng_state ^= rng_state << 13;
        rng_state ^= rng_state >> 7;
        rng_state ^= rng_state << 17;
        let j = (rng_state as usize) % (i + 1);
        active_ips.swap(i, j);
    }

    // Jeśli lista pokoi jest pusta, utwórz odpowiednią liczbę
    if rooms.is_empty() {
        let needed_rooms = (len + 1) / 2;
        for i in 1..=needed_rooms.max(1) {
            rooms.push(format!("Pokój {}", i));
        }
    }

    // Wyczyść dotychczasowe przypisania
    st.groups.clear();

    // Przypisz uczniów parami do kolejnych pokoi
    let num_rooms = rooms.len();
    for (idx, ip) in active_ips.iter().enumerate() {
        let room_idx = (idx / 2).min(num_rooms - 1);
        let room_name = rooms[room_idx].clone();

        st.groups.entry(room_name.clone()).or_insert_with(Vec::new).push(ip.clone());
        st.ip_to_group.insert(ip.clone(), room_name.clone());
    }

    // Wyślij powiadomienia UDP do wszystkich uczniów wraz ze składem ich pokoju
    for ip in &active_ips {
        if let Some(room_name) = st.ip_to_group.get(ip).cloned() {
            let members = crate::network::get_room_members_payload(&st, &room_name, now);
            let members_json = serde_json::to_string(&members).unwrap_or_default();
            let msg = format!("VOIP_ROOM:{}|{}", room_name, members_json);
            if let Some(target_addr) = st.ip_to_addr.get(ip).cloned() {
                if let Some(ref sock) = st.audio_socket {
                    for _ in 0..3 {
                        let _ = sock.send_to(msg.as_bytes(), target_addr);
                    }
                }
            }
        }
    }

    println!("[SERWER] Rozlosowano {} uczniów do {} pokoi", active_ips.len(), num_rooms);
    Ok(())
}


#[tauri::command]
pub fn set_broadcast(active: bool, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    state.lock().unwrap().is_broadcasting = active;
    Ok(())
}

#[tauri::command]
pub fn set_listen_room(room: Option<String>, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    state.lock().unwrap().listening_room = room;
    Ok(())
}

#[tauri::command]
pub fn clear_hand(ip: String, state: State<'_, SharedServerState>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    if let Some(stat) = state.lock().unwrap().client_stats.get_mut(&ip) {
        stat.hand_raised = false;
    }
    Ok(())
}

#[tauri::command]
pub fn get_hardware_id() -> String {
    crate::licensing::get_hardware_id()
}

#[tauri::command]
pub fn check_activation() -> bool {
    crate::licensing::is_activated()
}

#[tauri::command]
pub fn activate_license(code: String) -> Result<String, String> {
    let hw_id = crate::licensing::get_hardware_id();
    crate::licensing::save_license(&hw_id, &code)?;
    Ok("Serwer pracowni został pomyślnie aktywowany!".to_string())
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
pub fn window_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window) {
    let _ = window.destroy();
}

#[tauri::command]
pub fn report_frontend_error(message: String, stack: Option<String>) {
    crate::telemetry::capture_error(&message, stack.as_deref());
}

#[tauri::command]
pub fn media_load_bytes(
    name: String,
    data: Vec<u8>,
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> Result<crate::state::MediaPlaybackStatus, String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let (samples, duration) = crate::audio::decode_audio_bytes(&data)?;
    let mut p = player.lock().unwrap();
    p.file_name = name;
    p.samples = samples;
    p.duration_secs = duration;
    p.current_sample_idx = 0;
    p.is_playing = false;

    Ok(crate::audio::get_media_status(&player.inner().clone()))
}

#[tauri::command]
pub fn media_load_path(
    path: String,
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> Result<crate::state::MediaPlaybackStatus, String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Błąd odczytu pliku {}: {}", path, e))?;
    let path_obj = std::path::Path::new(&path);
    let name = path_obj
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Nagranie")
        .to_string();

    let (samples, duration) = crate::audio::decode_audio_bytes(&bytes)?;
    let mut p = player.lock().unwrap();
    p.file_name = name;
    p.samples = samples;
    p.duration_secs = duration;
    p.current_sample_idx = 0;
    p.is_playing = false;

    Ok(crate::audio::get_media_status(&player.inner().clone()))
}

#[tauri::command]
pub fn media_play(player: State<'_, crate::state::SharedMediaPlayer>) -> Result<(), String> {
    if !crate::licensing::is_activated() {
        return Err("Aplikacja serwera nie została aktywowana!".to_string());
    }
    let mut p = player.lock().unwrap();
    if p.samples.is_empty() {
        return Err("Brak wczytanego pliku audio do odtworzenia.".to_string());
    }
    p.is_playing = true;
    Ok(())
}

#[tauri::command]
pub fn media_pause(player: State<'_, crate::state::SharedMediaPlayer>) -> Result<(), String> {
    let mut p = player.lock().unwrap();
    p.is_playing = false;
    Ok(())
}

#[tauri::command]
pub fn media_stop(player: State<'_, crate::state::SharedMediaPlayer>) -> Result<(), String> {
    let mut p = player.lock().unwrap();
    p.is_playing = false;
    p.current_sample_idx = 0;
    Ok(())
}

#[tauri::command]
pub fn media_seek(
    position_secs: f64,
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> Result<(), String> {
    let mut p = player.lock().unwrap();
    let target_idx = (position_secs * crate::state::SAMPLE_RATE as f64).round() as usize;
    p.current_sample_idx = target_idx.min(p.samples.len());
    Ok(())
}

#[tauri::command]
pub fn media_set_volume(
    volume: f32,
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> Result<(), String> {
    let mut p = player.lock().unwrap();
    p.volume = volume.clamp(0.0, 2.0);
    Ok(())
}

#[tauri::command]
pub fn media_set_target(
    target: String,
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> Result<(), String> {
    let mut p = player.lock().unwrap();
    p.target = target;
    Ok(())
}

#[tauri::command]
pub fn media_get_status(
    player: State<'_, crate::state::SharedMediaPlayer>,
) -> crate::state::MediaPlaybackStatus {
    crate::audio::get_media_status(&player.inner().clone())
}

#[tauri::command]
pub fn get_dashboard_data(
    state: State<'_, crate::state::SharedServerState>,
    media_player: State<'_, crate::state::SharedMediaPlayer>,
) -> crate::state::DashboardData {
    let now = crate::state::current_time();
    let mut st = state.lock().unwrap();

    let active_ips: std::collections::HashSet<String> = st
        .client_stats
        .iter()
        .filter(|(_, data)| now - data.last_seen < crate::state::CLIENT_TIMEOUT_SECS)
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

            active_clients.push(crate::state::ClientDisplayInfo {
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

    let media_status = crate::audio::get_media_status(&media_player.inner().clone());

    crate::state::DashboardData {
        mbps,
        avg_latency,
        loss_percentage,
        active_clients,
        media_status,
    }
}