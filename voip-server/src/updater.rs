use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_date: Option<String>,
    pub changelog: Option<String>,
    pub download_url: String,
    pub is_mandatory: bool,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RemoteManifest {
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub release_date: Option<String>,
    pub changelog: Option<String>,
    pub server_url: Option<String>,
    pub client_url: Option<String>,
    pub download_url: Option<String>,
    pub is_mandatory: Option<bool>,
}

pub fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn compare_versions(current: &str, latest: &str) -> bool {
    let parse_v = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };
    let curr_parts = parse_v(current);
    let latest_parts = parse_v(latest);
    for i in 0..std::cmp::max(curr_parts.len(), latest_parts.len()) {
        let c = *curr_parts.get(i).unwrap_or(&0);
        let l = *latest_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        } else if l < c {
            return false;
        }
    }
    false
}

pub fn fetch_update_manifest(url: &str, app_type: &str) -> Result<UpdateInfo, String> {
    let clean_url = url.trim();
    if clean_url.is_empty() {
        return Err("Podaj prawidłowy adres URL serwera FTP/HTTP z plikiem aktualizacji (np. version.json).".to_string());
    }

    let temp_dir = std::env::temp_dir().join("SPRoleVoIP_Updates");
    let _ = fs::create_dir_all(&temp_dir);
    let manifest_file = temp_dir.join("server_version_check.json");
    let _ = fs::remove_file(&manifest_file);

    let curl_res = Command::new("curl.exe")
        .args(["-L", "-f", "-s", "-o", manifest_file.to_str().unwrap(), clean_url])
        .output();

    let mut download_ok = match curl_res {
        Ok(o) => o.status.success() && manifest_file.exists(),
        Err(_) => false,
    };

    if !download_ok {
        let ps_cmd = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; (New-Object System.Net.WebClient).DownloadFile('{}', '{}')",
            clean_url.replace("'", "''"),
            manifest_file.to_string_lossy().replace("'", "''")
        );
        let ps_res = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output();
        download_ok = match ps_res {
            Ok(o) => o.status.success() && manifest_file.exists(),
            Err(_) => false,
        };
    }

    if !download_ok {
        return Err("Nie udało się pobrać informacji o aktualizacji z podanego adresu FTP/HTTP.".to_string());
    }

    let content = fs::read_to_string(&manifest_file)
        .map_err(|e| format!("Błąd odczytu pliku manifestu: {}", e))?;

    let manifest: RemoteManifest = serde_json::from_str(&content)
        .map_err(|e| format!("Nieprawidłowa struktura pliku JSON: {}", e))?;

    let current = get_current_version();
    let latest = manifest
        .latest_version
        .or(manifest.version)
        .unwrap_or_else(|| current.clone());

    let download_url = if app_type == "client" {
        manifest.client_url.or(manifest.download_url).unwrap_or_default()
    } else {
        manifest.server_url.or(manifest.download_url).unwrap_or_default()
    };

    let has_update = compare_versions(&current, &latest);

    Ok(UpdateInfo {
        has_update,
        current_version: current,
        latest_version: latest,
        release_date: manifest.release_date,
        changelog: manifest.changelog,
        download_url,
        is_mandatory: manifest.is_mandatory.unwrap_or(false),
    })
}

pub fn download_and_install_update(download_url: &str) -> Result<String, String> {
    let clean_url = download_url.trim();
    if clean_url.is_empty() {
        return Err("Brak adresu URL do pobrania pliku aktualizacji.".to_string());
    }

    let temp_dir = std::env::temp_dir().join("SPRoleVoIP_Updates");
    let _ = fs::create_dir_all(&temp_dir);

    let is_installer = clean_url.to_lowercase().ends_with("setup.exe")
        || clean_url.to_lowercase().ends_with("installer.exe")
        || clean_url.to_lowercase().ends_with(".msi");

    let downloaded_file = if is_installer {
        temp_dir.join("voip_server_setup.exe")
    } else {
        temp_dir.join("voip_server_new.exe")
    };

    let _ = fs::remove_file(&downloaded_file);

    let curl_res = Command::new("curl.exe")
        .args(["-L", "-f", "-s", "-o", downloaded_file.to_str().unwrap(), clean_url])
        .output();

    let mut ok = match curl_res {
        Ok(o) => o.status.success() && downloaded_file.exists(),
        Err(_) => false,
    };

    if !ok {
        let ps_cmd = format!(
            "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; (New-Object System.Net.WebClient).DownloadFile('{}', '{}')",
            clean_url.replace("'", "''"),
            downloaded_file.to_string_lossy().replace("'", "''")
        );
        let ps_res = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output();
        ok = match ps_res {
            Ok(o) => o.status.success() && downloaded_file.exists(),
            Err(_) => false,
        };
    }

    if !ok {
        return Err("Błąd podczas pobierania nowej wersji z serwera FTP/HTTP.".to_string());
    }

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Błąd lokalizacji pliku programu: {}", e))?;
    let bat_path = temp_dir.join("apply_server_update.bat");

    let bat_content = if is_installer {
        format!(
            "@echo off\r\ntimeout /t 1 /nobreak >nul\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
            downloaded_file.to_string_lossy()
        )
    } else {
        format!(
            "@echo off\r\ntimeout /t 2 /nobreak >nul\r\n:retry\r\nmove /Y \"{}\" \"{}\" >nul 2>&1\r\nif errorlevel 1 (\r\n  timeout /t 1 /nobreak >nul\r\n  goto retry\r\n)\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
            downloaded_file.to_string_lossy(),
            current_exe.to_string_lossy(),
            current_exe.to_string_lossy()
        )
    };

    fs::write(&bat_path, bat_content)
        .map_err(|e| format!("Błąd tworzenia skryptu instalacji: {}", e))?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("cmd.exe")
            .args(["/c", bat_path.to_str().unwrap()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    Ok("Pobrano aktualizację. Aplikacja serwera uruchomi się ponownie w nowej wersji!".to_string())
}