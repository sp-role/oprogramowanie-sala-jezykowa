use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PORT_AUDIO: u16 = 5005;
pub const PORT_DISCOVERY: u16 = 5006;
pub const SAMPLE_RATE: u32 = 48000;
pub const CLIENT_TIMEOUT_SECS: f64 = 4.0; // Automatyczne rozłączenie po 4 sekundach bez pakietu

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
}

#[derive(Clone, Serialize)]
pub struct ClientDisplayInfo {
    pub ip: String,
    pub name: String,
    pub group: String,
    pub hand_raised: bool,
    pub is_speaking: bool,
}
