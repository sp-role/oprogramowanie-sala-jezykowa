mod audio;
mod commands;
mod licensing;
mod network;
mod state;
mod updater;

use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use state::{ClientState, SharedClientState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedClientState = Arc::new(Mutex::new(ClientState {
        username: "".to_string(),
        ..Default::default()
    }));
    let state_clone = state.clone();

    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::set_username,
            commands::raise_hand,
            commands::get_hardware_id,
            commands::check_activation,
            commands::activate_license,
            commands::get_app_version,
            commands::check_for_updates,
            commands::install_update
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let state_disc = state_clone.clone();
            std::thread::spawn(move || network::discover_server(state_disc));

            let state_mdns = state_clone.clone();
            std::thread::spawn(move || network::discover_server_mdns(state_mdns));

            let socket = UdpSocket::bind("0.0.0.0:0").expect("Błąd gniazda UDP");
            let socket_send = socket.try_clone().expect("Błąd klonowania gniazda");

            let state_audio = state_clone.clone();
            std::thread::spawn(move || audio::capture_and_send_pcm(state_audio, socket_send));
            let state_play = state_clone.clone();
            std::thread::spawn(move || audio::receive_and_play_pcm(state_play, socket));

            let state_ui = state_clone.clone();
            std::thread::spawn(move || network::run_ui_updater(app_handle, state_ui));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Błąd klienta");
}

fn main() {
    run();
}
