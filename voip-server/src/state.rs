use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PORT_AUDIO: u16 = 5005;
pub const PORT_DISCOVERY: u16 = 5006;
pub const SAMPLE_RATE: u32 = 48000;
pub const CLIENT_TIMEOUT_SECS: f64 = 12.0; // Automatyczne rozłączenie po 12 sekundach bez pakietu

pub fn current_time() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

#[derive(Default)]
pub struct ServerState {
    pub groups: HashMap<String, Vec<String>>,
    pub ip_to_group: HashMap<String, String>,
    pub ip_to_name: HashMap<String, String>,
    pub ip_to_addr: HashMap<String, SocketAddr>,
    pub client_stats: HashMap<String, ClientStat>,
    pub total_bytes_sec: usize,
    pub is_broadcasting: bool,
    pub listening_room: Option<String>,
    pub audio_socket: Option<Arc<std::net::UdpSocket>>,
}

pub type SharedServerState = Arc<Mutex<ServerState>>;

#[derive(Clone, Serialize)]
pub struct ClientStat {
    pub last_seq: u32,
    pub packets_recv: u32,
    pub packets_lost: u32,
    pub latencies: Vec<f64>,
    pub last_seen: f64,
    pub hand_raised: bool,
    pub last_spoken: f64,
}

#[derive(Clone, Serialize)]
pub struct DashboardData {
    pub mbps: f64,
    pub avg_latency: f64,
    pub loss_percentage: f64,
    pub active_clients: Vec<ClientDisplayInfo>,
    pub media_status: MediaPlaybackStatus,
}

#[derive(Clone, Serialize, Debug)]
pub struct ClientDisplayInfo {
    pub ip: String,
    pub name: String,
    pub group: String,
    pub hand_raised: bool,
    pub is_speaking: bool,
    pub ping_ms: u32,
    pub loss_pct: f64,
    pub quality: String, // "excellent", "good", "fair", "poor"
}

#[derive(Clone, Serialize, serde::Deserialize, Debug)]
pub struct RoomMemberPayload {
    pub ip: String,
    pub name: String,
    pub is_speaking: bool,
    pub hand_raised: bool,
}

#[derive(Clone, Serialize, Default, Debug)]
pub struct MediaPlaybackStatus {
    pub is_loaded: bool,
    pub is_playing: bool,
    pub file_name: String,
    pub current_time_secs: f64,
    pub total_duration_secs: f64,
    pub volume: f32,
    pub target: String,
}

pub struct MediaPlayerData {
    pub file_name: String,
    pub samples: Vec<f32>,
    pub current_sample_idx: usize,
    pub is_playing: bool,
    pub volume: f32,
    pub target: String,
    pub duration_secs: f64,
}

impl Default for MediaPlayerData {
    fn default() -> Self {
        Self {
            file_name: String::new(),
            samples: Vec::new(),
            current_sample_idx: 0,
            is_playing: false,
            volume: 1.0,
            target: "all".to_string(),
            duration_secs: 0.0,
        }
    }
}

pub type SharedMediaPlayer = Arc<Mutex<MediaPlayerData>>;

