use serde::Serialize;
use std::sync::{Arc, Mutex};

pub const PORT_AUDIO: u16 = 5005;
pub const PORT_DISCOVERY: u16 = 5006;
pub const SAMPLE_RATE: u32 = 48000;
pub const VAD_THRESHOLD: f32 = 0.025; // Progowanie głosu (~800 w 16-bit)

#[derive(Default, Clone)]
pub struct ClientState {
    pub server_ip: Option<String>,
    pub group: Option<String>,
    pub username: String,
    pub seq_num: u32,
    pub is_speaking: bool,
}

impl ClientState {
    pub fn is_registered(&self) -> bool {
        let trimmed = self.username.trim();
        !trimmed.is_empty() && trimmed != "Uczeń"
    }
}

pub type SharedClientState = Arc<Mutex<ClientState>>;

#[derive(Clone, Serialize)]
pub struct ClientStatusPayload {
    pub connected: bool,
    pub server_ip: String,
    pub group: String,
    pub is_speaking: bool,
}
