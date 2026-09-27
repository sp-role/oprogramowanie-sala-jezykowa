#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static CACHED_HW_ID: OnceLock<String> = OnceLock::new();
static CACHED_LEGACY_HW_ID: OnceLock<String> = OnceLock::new();

/// Zwraca zdekodowaną w pamięci sól kryptograficzną (zamaskowaną przed statyczną analizą binarki).
fn get_secret_salt() -> String {
    const MASKED: &[u8] = &[
        0x09, 0x0a, 0x05, 0x08, 0x15, 0x16, 0x1f, 0x05, 0x18, 0x1b, 0x08, 0x0e, 0x15, 0x09, 0x00,
        0x05, 0x17, 0x13, 0x1b, 0x00, 0x1f, 0x11, 0x05, 0x0c, 0x15, 0x13, 0x0a, 0x05, 0x68, 0x6a,
        0x68, 0x6c, 0x05, 0x09, 0x1f, 0x19, 0x0f, 0x08, 0x1f, 0x05, 0x11, 0x1f, 0x03,
    ];
    let decoded: Vec<u8> = MASKED.iter().map(|&b| b ^ 0x5A).collect();
    String::from_utf8(decoded).unwrap_or_default()
}

/// Zwraca zamaskowaną sól sprzętową.
fn get_hw_salt() -> Vec<u8> {
    const HW_MASKED: &[u8] = &[
        0x05, 0x09, 0x0a, 0x05, 0x08, 0x15, 0x16, 0x1f, 0x05, 0x12, 0x0d, 0x05, 0x09, 0x1b, 0x16, 0x0e,
    ];
    HW_MASKED.iter().map(|&b| b ^ 0x5A).collect()
}

/// Pobiera wzmocniony identyfikator sprzętowy (odporny na klonowanie obrazu dysku i maszyn wirtualnych).
pub fn get_hardware_id() -> String {
    CACHED_HW_ID.get_or_init(compute_hardware_id).clone()
}

/// Pobiera pierwotny HWID (bazujący wyłącznie na MachineGuid) na potrzeby bezpiecznej, automatycznej migracji.
pub fn get_legacy_hardware_id() -> String {
    CACHED_LEGACY_HW_ID.get_or_init(compute_legacy_hardware_id).clone()
}

fn compute_hardware_id() -> String {
    #[cfg(windows)]
    {
        // 1. Odczyt MachineGuid z rejestru Windows
        let mut machine_guid = String::new();
        let mut reg_cmd = std::process::Command::new("reg");
        reg_cmd.args(["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
        reg_cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = reg_cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains("MachineGuid") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        machine_guid = parts.last().unwrap_or(&"").to_string();
                    }
                }
            }
        }

        // 2. Odczyt fizycznego ComputerHardwareId z rejestru Windows (generowanego przez Windows PnP na podstawie SMBIOS)
        let mut computer_hw_id = String::new();
        let mut reg_hw_cmd = std::process::Command::new("reg");
        reg_hw_cmd.args(["query", "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\SystemInformation", "/v", "ComputerHardwareId"]);
        reg_hw_cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = reg_hw_cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains("ComputerHardwareId") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        computer_hw_id = parts.last().unwrap_or(&"").to_string();
                    }
                }
            }
        }

        // 3. Odczyt fizycznego UUID płyty głównej (SMBIOS / BIOS UUID)
        let mut bios_uuid = String::new();
        let mut ps_cmd = std::process::Command::new("powershell");
        ps_cmd.args(["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"]);
        ps_cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = ps_cmd.output() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() && s.len() > 10 {
                bios_uuid = s;
            }
        }

        if !machine_guid.is_empty() || !computer_hw_id.is_empty() || !bios_uuid.is_empty() {
            let combined = format!("{}:{}:{}", machine_guid, computer_hw_id, bios_uuid);
            return format_hardware_id(&combined);
        }
    }

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "DEFAULT_HOST".to_string());
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "DEFAULT_USER".to_string());
    format_hardware_id(&format!("{}-{}", hostname, username))
}

fn compute_legacy_hardware_id() -> String {
    #[cfg(windows)]
    {
        let mut reg_cmd = std::process::Command::new("reg");
        reg_cmd.args(["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
        reg_cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = reg_cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains("MachineGuid") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let guid = parts.last().unwrap_or(&"");
                        return format_hardware_id(guid);
                    }
                }
            }
        }
    }

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "DEFAULT_HOST".to_string());
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "DEFAULT_USER".to_string());
    format_hardware_id(&format!("{}-{}", hostname, username))
}

fn format_hardware_id(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hasher.update(&get_hw_salt());
    let result = hasher.finalize();
    let hex_str = format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        result[0], result[1], result[2], result[3], result[4], result[5]
    );
    format!("SPR-{}-{}", &hex_str[0..4], &hex_str[4..8])
}

pub fn generate_license_token(code: &str, hardware_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code.trim().to_uppercase().as_bytes());
    hasher.update(b":");
    hasher.update(hardware_id.trim().to_uppercase().as_bytes());
    hasher.update(b":");
    hasher.update(get_secret_salt().as_bytes());
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02X}", b)).collect()
}

pub fn generate_activation_code(hardware_id: &str) -> String {
    let clean_id = hardware_id.trim().to_uppercase();
    let mut hasher = Sha256::new();
    hasher.update(clean_id.as_bytes());
    hasher.update(get_secret_salt().as_bytes());
    let result = hasher.finalize();
    let hex_str = format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        result[0], result[1], result[2], result[3], result[4], result[5]
    );
    format!("ROLE-{}-{}", &hex_str[0..4], &hex_str[4..8])
}

pub const VERIFY_API_URL: &str = "https://www.szkola-role.pl/api/language-lab/verify";

pub fn verify_activation_code(hardware_id: &str, code: &str) -> bool {
    let clean_code = code.trim().to_uppercase();
    if clean_code.is_empty() {
        return false;
    }
    let expected_role = generate_activation_code(hardware_id);
    if clean_code == expected_role {
        return true;
    }
    let act_format = format!("ACT-{}", &expected_role[5..]);
    if clean_code == act_format {
        return true;
    }

    false
}

pub fn verify_online_or_offline(hardware_id: &str, code: &str, app_type: &str) -> Result<bool, String> {
    let clean_code = code.trim().to_uppercase();
    if clean_code.is_empty() {
        return Err("Wpisz kod aktywacyjny.".to_string());
    }

    let temp_dir = std::env::temp_dir().join("SPRoleVoIP_Updates");
    let _ = fs::create_dir_all(&temp_dir);
    let res_file = temp_dir.join(format!("verify_{}_response.json", app_type));
    let _ = fs::remove_file(&res_file);

    let post_data = format!(
        r#"{{"code":"{}","hardware_id":"{}","app_type":"{}","school":"Szkoła Podstawowa w Rolach"}}"#,
        clean_code, hardware_id, app_type
    );

    // Próba weryfikacji online na oficjalnym serwerze szkoły (z ukrytym oknem na Windows)
    let mut curl_cmd = std::process::Command::new("curl.exe");
    curl_cmd.args([
        "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", &post_data,
        "-L", "-s",
        "-o", res_file.to_str().unwrap(),
        VERIFY_API_URL,
    ]);
    #[cfg(windows)]
    curl_cmd.creation_flags(CREATE_NO_WINDOW);

    let curl_res = curl_cmd.output();

    if let Ok(o) = curl_res {
        if o.status.success() && res_file.exists() {
            if let Ok(body) = fs::read_to_string(&res_file) {
                let lower = body.to_lowercase();
                if lower.contains("\"status\":\"success\"") 
                    || lower.contains("\"status\": \"success\"") 
                    || lower.contains("\"valid\":true") 
                    || lower.contains("\"valid\": true") 
                    || lower.contains("\"active\":true") {
                    return Ok(true);
                } else if lower.contains("\"status\":\"error\"") || lower.contains("\"error\"") {
                    return Err("Serwer szkoły (szkola-role.pl) odrzucił podany kod aktywacyjny!".to_string());
                }
            }
        }
    }

    // Fallback: Weryfikacja algorytmiczna offline (tylko kod powiązany z danym HWID)
    if verify_activation_code(hardware_id, &clean_code) {
        Ok(true)
    } else {
        Err("Wprowadzony kod aktywacyjny jest nieprawidłowy dla tego komputera!".to_string())
    }
}

fn get_license_file_path() -> PathBuf {
    let base_dir = get_app_dir();
    base_dir.join("sp_role_voip_client.lic")
}

fn get_app_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = PathBuf::from(appdata).join("SPRoleVoIP");
        let _ = fs::create_dir_all(&p);
        p
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }
}

pub fn save_license(hardware_id: &str, code: &str) -> Result<(), String> {
    verify_online_or_offline(hardware_id, code, "client")?;
    let token = generate_license_token(code, hardware_id);
    let path = get_license_file_path();
    let content = format!(
        "{}:{}:{}",
        hardware_id.trim().to_uppercase(),
        code.trim().to_uppercase(),
        token
    );
    fs::write(&path, content).map_err(|e| format!("Błąd zapisu licencji: {}", e))?;
    Ok(())
}

pub fn is_activated() -> bool {
    let current_hw_id = get_hardware_id();
    let path = get_license_file_path();
    if let Ok(content) = fs::read_to_string(&path) {
        let parts: Vec<&str> = content.trim().split(':').collect();
        if parts.len() == 3 {
            let saved_hw_id = parts[0].trim();
            let saved_code = parts[1].trim();
            let saved_token = parts[2].trim();

            // 1. Weryfikacja z bieżącym, fizycznym identyfikatorem sprzętu
            if saved_hw_id.eq_ignore_ascii_case(&current_hw_id) {
                let expected = generate_license_token(saved_code, &current_hw_id);
                if saved_token.eq_ignore_ascii_case(&expected) {
                    return true;
                }
            }

            // 2. Automatyczna i bezpieczna migracja dla dotychczasowej licencji na tej samej maszynie
            let legacy_hw_id = get_legacy_hardware_id();
            if saved_hw_id.eq_ignore_ascii_case(&legacy_hw_id) {
                let expected = generate_license_token(saved_code, &legacy_hw_id);
                if saved_token.eq_ignore_ascii_case(&expected) {
                    let new_token = generate_license_token(saved_code, &current_hw_id);
                    let migrated_content = format!(
                        "{}:{}:{}",
                        current_hw_id.trim().to_uppercase(),
                        saved_code.trim().to_uppercase(),
                        new_token
                    );
                    let _ = fs::write(&path, migrated_content);
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hwid_generation() {
        let hw_id = get_hardware_id();
        assert!(hw_id.starts_with("SPR-"));
        assert_eq!(hw_id.len(), 13); // SPR-XXXX-XXXX
    }

    #[test]
    fn test_master_keys_rejected() {
        let hw_id = get_hardware_id();
        assert!(!verify_activation_code(&hw_id, "SP-ROLE-2026-MIAZEK"));
        assert!(!verify_activation_code(&hw_id, "SPROLE-SZKOLA-2026"));
        assert!(!verify_activation_code(&hw_id, "VOIP-ROLE-CLIENT-2026"));
    }

    #[test]
    fn test_valid_algorithmic_code_accepted() {
        let hw_id = get_hardware_id();
        let valid_code = generate_activation_code(&hw_id);
        assert!(verify_activation_code(&hw_id, &valid_code));
    }

    #[test]
    fn test_is_activated() {
        let act = is_activated();
        println!("is_activated: {}", act);
        println!("current_hw_id: {}", get_hardware_id());
        println!("legacy_hw_id: {}", get_legacy_hardware_id());
        assert!(act);
    }
}
