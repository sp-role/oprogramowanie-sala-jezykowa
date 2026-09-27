#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod licensing;
mod network;
mod state;
mod telemetry;
mod updater;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use state::{ServerState, SharedServerState};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = telemetry::init();

    let state: SharedServerState = Arc::new(Mutex::new(ServerState::default()));
    let state_clone = state.clone();

    let media_player: state::SharedMediaPlayer = Arc::new(Mutex::new(state::MediaPlayerData::default()));
    let media_player_clone = media_player.clone();

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
        .manage(media_player.clone())
        .invoke_handler(tauri::generate_handler![
            commands::check_admin,
            commands::check_firewall_rule,
            commands::add_firewall_rule,
            commands::assign_client_room,
            commands::delete_room,
            commands::reset_all_to_pool,
            commands::auto_pair_clients,
            commands::set_broadcast,
            commands::set_listen_room,
            commands::clear_hand,
            commands::get_hardware_id,
            commands::check_activation,
            commands::activate_license,
            commands::get_app_version,
            commands::check_for_updates,
            commands::install_update,
            commands::window_start_dragging,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::report_frontend_error,
            commands::media_load_bytes,
            commands::media_load_path,
            commands::media_play,
            commands::media_pause,
            commands::media_stop,
            commands::media_seek,
            commands::media_set_volume,
            commands::media_set_target,
            commands::media_get_status,
            commands::get_dashboard_data
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_min_size(Some(tauri::LogicalSize {
                    width: 800.0,
                    height: 540.0,
                }));
            }

            let app_handle = app.handle().clone();
            let teacher_audio: audio::TeacherAudioBuffer = Arc::new(Mutex::new(HashMap::new()));

            // 1. Serwer rozgłoszeniowy Discovery (UDP Broadcast / Unicast)
            let state_disc = state_clone.clone();
            std::thread::Builder::new()
                .name("discovery_server".into())
                .spawn(move || network::run_discovery_server(state_disc))
                .expect("Błąd uruchamiania wątku discovery");

            // 2. Usługa rejestracji mDNS / Zeroconf
            std::thread::Builder::new()
                .name("mdns_server".into())
                .spawn(move || network::run_mdns_server())
                .expect("Błąd uruchamiania wątku mDNS");

            // 3. Główny serwer Audio UDP (Port 5005)
            let state_udp = state_clone.clone();
            let teacher_buf = teacher_audio.clone();
            std::thread::Builder::new()
                .name("udp_audio_server".into())
                .spawn(move || network::run_udp_server(state_udp, teacher_buf))
                .expect("Błąd uruchamiania wątku audio UDP");

            // 4. Cykliczny updater stanu dashboardu dla GUI Tauri
            let state_dash = state_clone.clone();
            let media_player_dash = media_player_clone.clone();
            std::thread::Builder::new()
                .name("dashboard_updater".into())
                .spawn(move || network::run_dashboard_updater(app_handle, state_dash, media_player_dash))
                .expect("Błąd uruchamiania aktualizatora dashboardu");

            // 5. Przechwytywanie mikrofonu nauczyciela i rozgłaszanie do uczniów
            let state_mic = state_clone.clone();
            std::thread::Builder::new()
                .name("teacher_broadcast".into())
                .spawn(move || audio::capture_and_broadcast(state_mic))
                .expect("Błąd uruchamiania nadawania nauczyciela");
            
            // 6. Odtwarzacz multimedialny serwera (pliki audio/lekcje)
            let state_media = state_clone.clone();
            let media_stream = media_player_clone.clone();
            let teacher_audio_media = teacher_audio.clone();
            std::thread::Builder::new()
                .name("media_streamer".into())
                .spawn(move || audio::run_media_player_streamer(state_media, media_stream, teacher_audio_media))
                .expect("Błąd uruchamiania streamera mediów");

            // 7. Odtwarzanie podsłuchu z bufora nauczyciela (miksowanie uczniów)
            std::thread::Builder::new()
                .name("teacher_playback".into())
                .spawn(move || audio::play_teacher_audio(teacher_audio))
                .expect("Błąd uruchamiania odtwarzacza nauczyciela");

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("request_close", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("Błąd działania serwera");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--configure-firewall") {
        let ok = commands::apply_firewall_rules_internal();
        std::process::exit(if ok { 0 } else { 1 });
    }
    run();
}