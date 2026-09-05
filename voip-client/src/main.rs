mod audio;
mod commands;
mod licensing;
mod network;
mod state;
mod telemetry;
mod updater;

use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use state::{ClientState, SharedClientState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = telemetry::init();

    let state: SharedClientState = Arc::new(Mutex::new(ClientState {
        username: "".to_string(),
        ..Default::default()
    }));
    let state_clone = state.clone();

    let audio_streams: audio::SharedAudioStreams = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let audio_streams_play = audio_streams.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state.clone())
        .manage(audio_streams.clone())
        .invoke_handler(tauri::generate_handler![
            commands::set_username,
            commands::raise_hand,
            commands::get_client_status,
            commands::get_hardware_id,
            commands::check_activation,
            commands::activate_license,
            commands::get_app_version,
            commands::check_for_updates,
            commands::install_update,
            commands::window_start_dragging,
            commands::window_minimize,
            commands::window_close,
            commands::report_frontend_error,
            commands::get_audio_devices,
            commands::set_input_device,
            commands::set_output_device,
            commands::play_test_sound,
            commands::set_server_ip,
            commands::get_server_ip,
            commands::set_vad_threshold,
            commands::set_client_volume,
            commands::start_mic_test,
            commands::stop_mic_test,
            commands::toggle_self_mute,
            commands::leave_room
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // 1. Wyszukiwanie serwera w podsieci przez UDP Broadcast
            let state_disc = state_clone.clone();
            std::thread::spawn(move || network::discover_server(state_disc));

            // 2. Wyszukiwanie serwera przez mDNS / Zeroconf
            let state_mdns = state_clone.clone();
            std::thread::spawn(move || network::discover_server_mdns(state_mdns));

            // 3. Główne gniazdo UDP klienta (współdzielony port losowy)
            let socket = UdpSocket::bind("0.0.0.0:0").expect("Błąd gniazda UDP klienta");
            #[cfg(windows)]
            network::disable_connreset(&socket);

            let socket_send = socket.try_clone().expect("Błąd klonowania gniazda nadawczego");

            // 4. Nadawanie audio oraz wewnętrzny wątek keepalive/heartbeat
            let state_audio = state_clone.clone();
            let audio_streams_mic = audio_streams.clone();
            std::thread::spawn(move || audio::capture_and_send_pcm(state_audio, socket_send, audio_streams_mic));

            // 5. Odbiór ramek audio i odpowiedzi stanu pokoju (VOIP_ROOM / VOIP_PONG)
            let state_play = state_clone.clone();
            std::thread::spawn(move || audio::receive_and_play_pcm(state_play, socket, audio_streams_play));

            // 6. Przekazywanie statusu do frontendu Tauri
            let state_ui = state_clone.clone();
            std::thread::spawn(move || network::run_ui_updater(app_handle, state_ui));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Błąd uruchamiania klienta");
}

fn main() {
    run();
}