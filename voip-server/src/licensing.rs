#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

const SECRET_SALT: &str = "SP_ROLE_BARTOSZ_MIAZEK_VOIP_2026_SECURE_KEY";

pub fn get_hardware_id() -> String {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("reg")
            .args(["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
            .output();

        if let Ok(out) = output {
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
    hasher.update(b"_SP_ROLE_HW_SALT");
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
    hasher.update(SECRET_SALT.as_bytes());
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02X}", b)).collect()
}

pub fn generate_activation_code(hardware_id: &str) -> String {
    let clean_id = hardware_id.trim().to_uppercase();
    let mut hasher = Sha256::new();
    hasher.update(clean_id.as_bytes());
    hasher.update(SECRET_SALT.as_bytes());
    let result = hasher.finalize();
    let hex_str = format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        result[0], result[1], result[2], result[3], result[4], result[5]
    );
    format!("ACT-{}-{}", &hex_str[0..4], &hex_str[4..8])
}

pub fn verify_activation_code(hardware_id: &str, code: &str) -> bool {
    let clean_code = code.trim().to_uppercase();
    let expected = generate_activation_code(hardware_id);
    clean_code == expected
}

fn get_license_file_path() -> PathBuf {
    let base_dir = get_app_dir();
    base_dir.join("sp_role_voip_server.lic")
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

pub fn save_license_token(hardware_id: &str, code: &str, token: &str) -> Result<(), String> {
    let expected_token = generate_license_token(code, hardware_id);
    if token.trim().to_uppercase() != expected_token {
        if !verify_activation_code(hardware_id, code) {
            return Err("Nieprawidłowy token aktywacyjny dla tego komputera!".to_string());
        }
    }
    let path = get_license_file_path();
    let content = format!(
        "{}:{}:{}",
        hardware_id.trim().to_uppercase(),
        code.trim().to_uppercase(),
        expected_token
    );
    fs::write(&path, content).map_err(|e| format!("Błąd zapisu licencji: {}", e))?;
    Ok(())
}

pub fn save_license(hardware_id: &str, code: &str) -> Result<(), String> {
    let token = generate_license_token(code, hardware_id);
    save_license_token(hardware_id, code, &token)
}

pub fn is_activated() -> bool {
    let current_hw_id = get_hardware_id();
    let path = get_license_file_path();
    if let Ok(content) = fs::read_to_string(&path) {
        let parts: Vec<&str> = content.trim().split(':').collect();
        if parts.len() == 3 {
            let saved_hw_id = parts[0];
            let saved_code = parts[1];
            let saved_token = parts[2];
            if saved_hw_id == current_hw_id {
                let expected = generate_license_token(saved_code, &current_hw_id);
                if saved_token == expected {
                    return true;
                }
            }
        } else if parts.len() == 2 {
            let saved_hw_id = parts[0];
            let saved_code = parts[1];
            if saved_hw_id == current_hw_id && verify_activation_code(&current_hw_id, saved_code) {
                return true;
            }
        }
    }
    false
}
