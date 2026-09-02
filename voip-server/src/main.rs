#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod licensing;
mod network;
mod state;
mod updater;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use state::{ServerState, SharedServerState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedServerState = Arc::new(Mutex::new(ServerState::default()));
    let state_clone = state.clone();

    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::check_admin,
            commands::check_firewall_rule,
            commands::add_firewall_rule,
            commands::assign_client_room,
            commands::set_broadcast,
            commands::set_listen_room,
            commands::clear_hand,
            commands::get_hardware_id,
            commands::check_activation,
            commands::activate_license,
            commands::get_app_version,
            commands::check_for_updates,
            commands::install_update
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let teacher_audio: audio::TeacherAudioBuffer = Arc::new(Mutex::new(HashMap::new()));

            let state_disc = state_clone.clone();
            std::thread::spawn(move || network::run_discovery_server(state_disc));
            std::thread::spawn(move || network::run_mdns_server());

            let state_udp = state_clone.clone();
            let teacher_buf = teacher_audio.clone();
            std::thread::spawn(move || network::run_udp_server(state_udp, teacher_buf));

            let state_dash = state_clone.clone();
            std::thread::spawn(move || network::run_dashboard_updater(app_handle, state_dash));

            let state_mic = state_clone.clone();
            std::thread::spawn(move || audio::capture_and_broadcast(state_mic));
            std::thread::spawn(move || audio::play_teacher_audio(teacher_audio));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Błąd serwera");
}

fn main() {
    run();
}