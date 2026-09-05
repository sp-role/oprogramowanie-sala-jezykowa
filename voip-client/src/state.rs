use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PORT_AUDIO: u16 = 5005;
pub const PORT_DISCOVERY: u16 = 5006;
pub const SAMPLE_RATE: u32 = 48000;
pub const VAD_THRESHOLD: f32 = 0.025; // Progowanie głosu (~800 w 16-bit)
pub const SERVER_TIMEOUT_SECS: f64 = 6.0; // Po ilu sekundach braku pakietów uznać serwer za rozłączony

pub fn current_time() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Clone)]
pub struct ClientState {
    pub server_ip: Option<String>,
    pub group: Option<String>,
    pub username: String,
    pub seq_num: u32,
    pub is_speaking: bool,
    pub is_muted_by_teacher: bool,
    pub last_teacher_broadcast: f64,
    pub last_server_packet: f64,
    pub selected_input_device: Option<String>,
    pub selected_output_device: Option<String>,
    pub mic_level: f32,
    pub manual_server_ip: bool,
    pub vad_threshold: f32,
    pub volume: f32,
    pub is_mic_test_active: bool,
    pub mic_test_until: f64,
}

impl Default for ClientState {
    fn default() -> Self {
        Self {
            server_ip: None,
            group: None,
            username: String::new(),
            seq_num: 0,
            is_speaking: false,
            is_muted_by_teacher: false,
            last_teacher_broadcast: 0.0,
            last_server_packet: 0.0,
            selected_input_device: None,
            selected_output_device: None,
            mic_level: 0.0,
            manual_server_ip: false,
            vad_threshold: VAD_THRESHOLD,
            volume: 1.0,
            is_mic_test_active: false,
            mic_test_until: 0.0,
        }
    }
}

impl ClientState {
    #[allow(dead_code)]
    pub fn is_registered(&self) -> bool {
        !self.username.trim().is_empty()
    }

    /// Sprawdza, czy klient ma aktywny kontakt z serwerem
    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        if self.server_ip.is_none() {
            return false;
        }
        (current_time() - self.last_server_packet) < SERVER_TIMEOUT_SECS
    }

    /// Resetuje stan połączenia przy utracie sygnału serwera
    #[allow(dead_code)]
    pub fn handle_disconnect(&mut self) {
        if !self.manual_server_ip {
            self.server_ip = None;
        }
        self.group = None;
        self.is_muted_by_teacher = false;
        self.is_speaking = false;
    }
}

pub type SharedClientState = Arc<Mutex<ClientState>>;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AudioDevicesInfo {
    pub input_devices: Vec<String>,
    pub output_devices: Vec<String>,
    pub selected_input: Option<String>,
    pub selected_output: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct ClientStatusPayload {
    pub connected: bool,
    pub server_ip: String,
    pub group: String,
    pub is_speaking: bool,
    pub is_muted_by_teacher: bool,
    pub mic_level: f32,
    pub vad_threshold: f32,
    pub volume: f32,
    pub is_mic_test_active: bool,
}