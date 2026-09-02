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

#[tauri::command]
pub fn add_firewall_rule() -> Result<String, String> {
    #[cfg(windows)]
    {
        if is_elevated() {
            let _ = Command::new("netsh")
                .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP Audio"])
                .output();
            let _ = Command::new("netsh")
                .args(["advfirewall", "firewall", "delete", "rule", "name=Serwer VoIP Discovery"])
                .output();

            let out_audio = Command::new("netsh")
                .args([
                    "advfirewall", "firewall", "add", "rule",
                    "name=Serwer VoIP Audio", "dir=in", "action=allow",
                    "protocol=UDP", &format!("localport={}", PORT_AUDIO),
                    "enable=yes",
                ])
                .output()
                .map_err(|e| format!("Błąd wykonywania netsh: {}", e))?;

            let out_disc = Command::new("netsh")
                .args([
                    "advfirewall", "firewall", "add", "rule",
                    "name=Serwer VoIP Discovery", "dir=in", "action=allow",
                    "protocol=UDP", &format!("localport={}", PORT_DISCOVERY),
                    "enable=yes",
                ])
                .output()
                .map_err(|e| format!("Błąd wykonywania netsh: {}", e))?;

            if out_audio.status.success() && out_disc.status.success() {
                Ok("Dodano trwałe wyjątki portów (5005, 5006 UDP) do Zapory Windows!".to_string())
            } else {
                Err("Nie udało się dodać reguł do zapory.".to_string())
            }
        } else {
            // Brak uprawnień administratora - wywołaj systemowy modal UAC (wpisanie hasła admina / zgoda)
            let params = format!(
                "/c netsh advfirewall firewall delete rule name=\"Serwer VoIP Audio\" & netsh advfirewall firewall delete rule name=\"Serwer VoIP Discovery\" & netsh advfirewall firewall add rule name=\"Serwer VoIP Audio\" dir=in action=allow protocol=UDP localport={} enable=yes & netsh advfirewall firewall add rule name=\"Serwer VoIP Discovery\" dir=in action=allow protocol=UDP localport={} enable=yes",
                PORT_AUDIO, PORT_DISCOVERY
            );

            run_elevated_windows("cmd.exe", &params)?;
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
    for (_, members) in st.groups.iter_mut() {
        members.retain(|x| x != &ip);
    }
    if room != "Brak" {
        st.groups.entry(room.clone()).or_insert_with(Vec::new).push(ip.clone());
    }
    st.ip_to_group.insert(ip.clone(), room.clone());

    if let Some(target_addr) = st.ip_to_addr.get(&ip) {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let msg = format!("VOIP_ROOM:{}", room);
            let _ = socket.send_to(msg.as_bytes(), target_addr);
        }
    }
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
pub fn activate_license(code: String, token: Option<String>) -> Result<String, String> {
    let hw_id = crate::licensing::get_hardware_id();
    if let Some(tok) = token {
        if !tok.trim().is_empty() {
            crate::licensing::save_license_token(&hw_id, &code, &tok)?;
            return Ok("Serwer pracowni został pomyślnie aktywowany!".to_string());
        }
    }
    crate::licensing::save_license(&hw_id, &code)?;
    Ok("Serwer pracowni został pomyślnie aktywowany!".to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    crate::updater::get_current_version()
}

#[tauri::command]
pub fn check_for_updates(update_url: String) -> Result<crate::updater::UpdateInfo, String> {
    crate::updater::fetch_update_manifest(&update_url, "server")
}

#[tauri::command]
pub fn install_update(download_url: String) -> Result<String, String> {
    crate::updater::download_and_install_update(&download_url)
}