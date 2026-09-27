use sha2::{Digest, Sha256};
use std::env;
use std::io::{self, Write};

fn get_secret_salt() -> String {
    const MASKED: &[u8] = &[
        0x09, 0x0a, 0x05, 0x08, 0x15, 0x16, 0x1f, 0x05, 0x18, 0x1b, 0x08, 0x0e, 0x15, 0x09, 0x00,
        0x05, 0x17, 0x13, 0x1b, 0x00, 0x1f, 0x11, 0x05, 0x0c, 0x15, 0x13, 0x0a, 0x05, 0x68, 0x6a,
        0x68, 0x6c, 0x05, 0x09, 0x1f, 0x19, 0x0f, 0x08, 0x1f, 0x05, 0x11, 0x1f, 0x03,
    ];
    let decoded: Vec<u8> = MASKED.iter().map(|&b| b ^ 0x5A).collect();
    String::from_utf8(decoded).unwrap_or_default()
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

fn main() {
    println!("=======================================================");
    println!("   GENERATOR KODOW AKTYWACYJNYCH OFFLINE - SP ROLE     ");
    println!("=======================================================\n");

    let args: Vec<String> = env::args().collect();
    let hwid = if args.len() > 1 {
        args[1].clone()
    } else {
        print!("Wprowadz Hardware ID stanowiska (np. SPR-XXXX-XXXX): ");
        let _ = io::stdout().flush();
        let mut input = String::new();
        let _ = io::stdin().read_line(&mut input);
        input.trim().to_string()
    };

    let clean_hwid = hwid.trim().to_uppercase();
    if clean_hwid.is_empty() {
        println!("Blad: Nie podano Hardware ID.");
        return;
    }

    let code = generate_activation_code(&clean_hwid);
    let alt_code = format!("ACT-{}", &code[5..]);

    println!("\n-------------------------------------------------------");
    println!(" Identyfikator komputera : {}", clean_hwid);
    println!(" Glowny kod aktywacyjny  : {}", code);
    println!(" Alternatywny kod        : {}", alt_code);
    println!("-------------------------------------------------------\n");
    println!("Wpisz powyzszy kod w oknie aktywacji na danym komputerze.\n");
}
