use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::io::Cursor;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use crate::state::{current_time, PORT_AUDIO, SAMPLE_RATE, SharedClientState};

pub type SharedAudioStreams = Arc<Mutex<HashMap<String, VecDeque<f32>>>>;

pub fn list_audio_devices() -> (Vec<String>, Vec<String>) {
    let host = cpal::default_host();
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();

    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                inputs.push(name);
            }
        }
    }

    if let Ok(devices) = host.output_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                outputs.push(name);
            }
        }
    }

    (inputs, outputs)
}

pub fn play_test_chime(streams: &SharedAudioStreams) {
    let sample_rate = SAMPLE_RATE as f32;
    let notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (przyjemny akord C-dur)
    let note_duration = 0.16;
    let decay_duration = 0.45;
    let total_duration = notes.len() as f32 * note_duration + decay_duration;
    let total_samples = (total_duration * sample_rate) as usize;
    let mut buffer = vec![0.0f32; total_samples];

    for (i, &freq) in notes.iter().enumerate() {
        let start_sample = (i as f32 * note_duration * sample_rate) as usize;
        let note_samples = ((note_duration + decay_duration) * sample_rate) as usize;

        for n in 0..note_samples {
            let idx = start_sample + n;
            if idx >= total_samples { break; }
            let t = n as f32 / sample_rate;
            let env = (-5.0 * t).exp();
            let wave = (2.0 * std::f32::consts::PI * freq * t).sin()
                     + 0.25 * (4.0 * std::f32::consts::PI * freq * t).sin();
            buffer[idx] += 0.3 * wave * env;
        }
    }

    let mut streams_lock = streams.lock().unwrap();
    let buf = streams_lock.entry("__TEST_CHIME__".to_string()).or_insert_with(VecDeque::new);
    buf.clear();
    buf.extend(buffer);
}

pub fn capture_and_send_pcm(state: SharedClientState, socket: UdpSocket, audio_streams: SharedAudioStreams) {
    // Dedykowany wątek keepalive/heartbeat działający niezależnie od dostępności czy stanu mikrofonu
    let hb_state = state.clone();
    let hb_socket = socket.try_clone().expect("Błąd klonowania gniazda heartbeat");
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            if !crate::licensing::is_activated() {
                continue;
            }
            let (target, packet) = {
                let mut st = hb_state.lock().unwrap();
                if let Some(ip) = st.server_ip.clone() {
                    st.seq_num += 1;
                    let username = if st.username.trim().is_empty() {
                        "Uczeń".to_string()
                    } else {
                        st.username.clone()
                    };
                    let name_bytes = username.as_bytes();
                    let name_len = (name_bytes.len().min(64)) as u8;
                    let now = current_time();

                    let mut pkt = Vec::with_capacity(13 + name_len as usize);
                    let _ = pkt.write_u32::<BigEndian>(st.seq_num);
                    let _ = pkt.write_f64::<BigEndian>(now);
                    pkt.push(name_len);
                    pkt.extend_from_slice(&name_bytes[..name_len as usize]);

                    (format!("{}:{}", ip, PORT_AUDIO), pkt)
                } else {
                    continue;
                }
            };
            let _ = hb_socket.send_to(&packet, &target);
        }
    });

    // Pętla przechwytywania mowy
    loop {
        let host = cpal::default_host();
        let target_dev_name = state.lock().unwrap().selected_input_device.clone();
        let device = if let Some(ref target_name) = target_dev_name {
            host.input_devices()
                .ok()
                .and_then(|mut devs| devs.find(|d| d.name().map(|n| n == *target_name).unwrap_or(false)))
                .or_else(|| host.default_input_device())
        } else {
            host.default_input_device()
        };

        let device = match device {
            Some(d) => d,
            None => {
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
        };

        let supported_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[AUDIO-MIC] Błąd default_input_config dla urządzenia: {}", e);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let in_channels = supported_config.channels() as usize;
        let in_sample_rate = supported_config.sample_rate().0;
        let sample_format = supported_config.sample_format();
        let in_config = supported_config.config();

        let mut last_speech = Instant::now() - Duration::from_secs(10);
        let audio_state = state.clone();
        let audio_socket = match socket.try_clone() {
            Ok(s) => s,
            Err(_) => {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let loopback_streams = audio_streams.clone();
        let stream_error = Arc::new(AtomicBool::new(false));
        let stream_error_cb = stream_error.clone();

        let err_fn = move |err| {
            eprintln!("[AUDIO-MIC BŁĄD] CPAL zgłosił błąd mikrofonu: {}", err);
            stream_error_cb.store(true, Ordering::SeqCst);
        };

        let mut on_mono_samples = move |mono_samples: &[f32]| {
            let max_amp = mono_samples.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
            let now = current_time();

            let (target_addr, packet, is_loopback, loopback_samples) = {
                let mut st = audio_state.lock().unwrap();
                let vad_threshold = st.vad_threshold;
                let is_speech = max_amp >= vad_threshold;
                if is_speech {
                    last_speech = Instant::now();
                }

                let speech_active = last_speech.elapsed() < Duration::from_millis(350);
                let is_teacher_talking = (now - st.last_teacher_broadcast) < 0.6;
                st.is_muted_by_teacher = is_teacher_talking;
                st.is_speaking = speech_active && !is_teacher_talking;

                let is_loopback = st.is_mic_test_active && now < st.mic_test_until;
                if !is_loopback && st.is_mic_test_active {
                    st.is_mic_test_active = false;
                }

                // Płynny wskaźnik mic_level z decay
                let instant_level = (max_amp * 4.0).min(1.0);
                st.mic_level = if instant_level > st.mic_level {
                    instant_level
                } else {
                    st.mic_level * 0.86
                };

                let is_self_muted = st.is_self_muted;
                if is_self_muted {
                    st.is_speaking = false;
                }

                if !(speech_active || is_loopback) || (is_teacher_talking && !is_loopback) || (is_self_muted && !is_loopback) || !crate::licensing::is_activated() {
                    (None, None, is_loopback, Vec::new())
                } else {
                    // Resampling do 48000 Hz jeśli urządzenie pracuje z inną częstotliwością
                    let samples_48k: Vec<f32> = if in_sample_rate != SAMPLE_RATE && in_sample_rate > 0 {
                        let ratio = in_sample_rate as f64 / SAMPLE_RATE as f64;
                        let out_len = ((mono_samples.len() as f64) / ratio).round() as usize;
                        let mut out = Vec::with_capacity(out_len);
                        for i in 0..out_len {
                            let pos = i as f64 * ratio;
                            let idx0 = pos.floor() as usize;
                            let idx1 = (idx0 + 1).min(mono_samples.len().saturating_sub(1));
                            let frac = (pos - idx0 as f64) as f32;
                            let s0 = mono_samples.get(idx0).copied().unwrap_or(0.0);
                            let s1 = mono_samples.get(idx1).copied().unwrap_or(0.0);
                            out.push(s0 * (1.0 - frac) + s1 * frac);
                        }
                        out
                    } else {
                        mono_samples.to_vec()
                    };

                    if st.server_ip.is_none() {
                        (None, None, is_loopback, samples_48k)
                    } else {
                        let server_ip = st.server_ip.as_ref().unwrap();
                        let target_addr = format!("{}:{}", server_ip, PORT_AUDIO);
                        st.seq_num += 1;
                        let username = if st.username.trim().is_empty() {
                            "Uczeń".to_string()
                        } else {
                            st.username.clone()
                        };
                        let name_bytes = username.as_bytes();
                        let name_len = (name_bytes.len().min(64)) as u8;

                        let mut pkt = Vec::with_capacity(13 + (name_len as usize) + (samples_48k.len() * 2));
                        let _ = pkt.write_u32::<BigEndian>(st.seq_num);
                        let _ = pkt.write_f64::<BigEndian>(now);
                        pkt.push(name_len);
                        pkt.extend_from_slice(&name_bytes[..name_len as usize]);

                        for &sample in &samples_48k {
                            let clamped = sample.clamp(-1.0, 1.0);
                            let _ = pkt.write_i16::<BigEndian>((clamped * 32767.0) as i16);
                        }

                        (Some(target_addr), Some(pkt), is_loopback, samples_48k)
                    }
                }
            };

            // Odsłuch testowy mikrofonu (Loopback) w słuchawkach
            if is_loopback && !loopback_samples.is_empty() {
                if let Ok(mut streams) = loopback_streams.try_lock() {
                    let buf = streams.entry("__mic_test__".to_string()).or_default();
                    if buf.len() > 4800 {
                        buf.clear();
                    }
                    buf.extend(loopback_samples);
                }
            }

            // Wysłanie pakietu audio do serwera
            if let (Some(addr), Some(pkt)) = (target_addr, packet) {
                let _ = audio_socket.send_to(&pkt, addr);
            }
        };

        let stream_res = match sample_format {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &in_config,
                    move |data: &[f32], _| {
                        let mono: Vec<f32> = if in_channels > 1 {
                            data.chunks(in_channels).map(|ch| ch.iter().sum::<f32>() / in_channels as f32).collect()
                        } else {
                            data.to_vec()
                        };
                        on_mono_samples(&mono);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                device.build_input_stream(
                    &in_config,
                    move |data: &[i16], _| {
                        let mono: Vec<f32> = if in_channels > 1 {
                            data.chunks(in_channels)
                                .map(|ch| (ch.iter().map(|&s| s as f32).sum::<f32>() / in_channels as f32) / 32768.0)
                                .collect()
                        } else {
                            data.iter().map(|&s| (s as f32) / 32768.0).collect()
                        };
                        on_mono_samples(&mono);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                device.build_input_stream(
                    &in_config,
                    move |data: &[u16], _| {
                        let mono: Vec<f32> = if in_channels > 1 {
                            data.chunks(in_channels)
                                .map(|ch| ((ch.iter().map(|&s| s as f32).sum::<f32>() / in_channels as f32) - 32768.0) / 32768.0)
                                .collect()
                        } else {
                            data.iter().map(|&s| ((s as f32) - 32768.0) / 32768.0).collect()
                        };
                        on_mono_samples(&mono);
                    },
                    err_fn,
                    None,
                )
            }
            f => {
                eprintln!("[AUDIO-MIC] Nieobsługiwany format próbek urządzenia: {:?}", f);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        if let Ok(s) = stream_res {
            let _ = s.play();
            let chosen_input = state.lock().unwrap().selected_input_device.clone();
            while !stream_error.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(250));
                let desired_input = state.lock().unwrap().selected_input_device.clone();
                if desired_input != chosen_input {
                    println!("[AUDIO-MIC] Zmiana mikrofonu na: {:?}", desired_input);
                    break;
                }
            }
        } else if let Err(e) = stream_res {
            eprintln!("[AUDIO-MIC] Błąd inicjalizacji strumienia wejściowego: {}", e);
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}

pub fn receive_and_play_pcm(state: SharedClientState, socket: UdpSocket, audio_streams: SharedAudioStreams) {
    let playback_state = state.clone();
    let playback_streams = audio_streams.clone();

    // Dedykowany wątek odtwarzacza CPAL odporny na odłączenie słuchawek (hotplug)
    std::thread::spawn(move || {
        loop {
            let host = cpal::default_host();
            let target_dev_name = playback_state.lock().unwrap().selected_output_device.clone();
            let device = if let Some(ref target_name) = target_dev_name {
                host.output_devices()
                    .ok()
                    .and_then(|mut devs| devs.find(|d| d.name().map(|n| n == *target_name).unwrap_or(false)))
                    .or_else(|| host.default_output_device())
            } else {
                host.default_output_device()
            };

            let device = match device {
                Some(d) => d,
                None => {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            let supported_out_config = match device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[AUDIO-OUT] Błąd default_output_config: {}", e);
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            let out_channels = supported_out_config.channels() as usize;
            let out_config = supported_out_config.config();

            let streams_playback = playback_streams.clone();
            let state_playback = playback_state.clone();
            let stream_error = Arc::new(AtomicBool::new(false));
            let stream_error_cb = stream_error.clone();

            let stream = device.build_output_stream(
                &out_config,
                move |out_data: &mut [f32], _| {
                    let vol = state_playback.lock().unwrap().volume;
                    let mut streams = streams_playback.lock().unwrap();
                    for frame in out_data.chunks_mut(out_channels) {
                        let mut mixed = 0.0f32;
                        for (_, buf) in streams.iter_mut() {
                            if let Some(s) = buf.pop_front() {
                                mixed += s;
                            }
                        }
                        let sample_val = (mixed * vol).clamp(-1.0, 1.0);
                        for ch in frame.iter_mut() {
                            *ch = sample_val;
                        }
                    }
                    streams.retain(|_, buf| !buf.is_empty());
                },
                move |err| {
                    eprintln!("[AUDIO-OUT BŁĄD] CPAL zgłosił błąd słuchawek/głośników: {}", err);
                    stream_error_cb.store(true, Ordering::SeqCst);
                },
                None,
            );

            if let Ok(s) = stream {
                let _ = s.play();
                let chosen_output = playback_state.lock().unwrap().selected_output_device.clone();
                while !stream_error.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(250));
                    let desired_output = playback_state.lock().unwrap().selected_output_device.clone();
                    if desired_output != chosen_output {
                        println!("[AUDIO-OUT] Zmiana słuchawek na: {:?}", desired_output);
                        break;
                    }
                }
            } else if let Err(e) = stream {
                eprintln!("[AUDIO-OUT] Błąd inicjalizacji odtwarzacza: {}", e);
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    });

    let mut recv_buf = [0u8; 8192];
    loop {
        if let Ok((size, addr)) = socket.recv_from(&mut recv_buf) {
                let now = current_time();

                // Dynamiczna synchronizacja pokoju roboczego oraz składu uczestników
                if size >= 10 && (&recv_buf[..10] == b"VOIP_ROOM:" || &recv_buf[..10] == b"VOIP_PONG:") {
                    if let Ok(text) = std::str::from_utf8(&recv_buf[10..size]) {
                        let (room_name, members_json) = match text.split_once('|') {
                            Some((r, m)) => (r.trim(), Some(m.trim())),
                            None => (text.trim(), None),
                        };

                        let mut st = state.lock().unwrap();
                        st.last_server_packet = now;
                        let is_room = room_name != "Brak";
                        st.group = Some(if is_room {
                            room_name.to_string()
                        } else {
                            "Poczekalnia".to_string()
                        });

                        if let Some(m_json) = members_json {
                            #[derive(serde::Deserialize)]
                            struct ServerMember {
                                #[allow(dead_code)]
                                ip: String,
                                name: String,
                                is_speaking: bool,
                                hand_raised: bool,
                            }
                            if let Ok(server_members) = serde_json::from_str::<Vec<ServerMember>>(m_json) {
                                let my_name = st.username.trim().to_string();
                                let mut members = Vec::new();
                                for sm in server_members {
                                    let clean_sm_name = sm.name.trim().to_string();
                                    let is_me = !my_name.is_empty() && (clean_sm_name == my_name || my_name.contains(&clean_sm_name));
                                    members.push(crate::state::RoomMemberInfo {
                                        name: clean_sm_name,
                                        is_speaking: sm.is_speaking,
                                        is_self: is_me,
                                        hand_raised: sm.hand_raised,
                                    });
                                }
                                st.room_members = members;
                            }
                        } else if !is_room {
                            st.room_members.clear();
                        }
                    }
                    continue;
                }

                if size > 13 {
                    {
                        let mut st = state.lock().unwrap();
                        st.last_server_packet = now;
                    }
                    let name_len = recv_buf[12] as usize;
                    let audio_offset = 13 + name_len;

                    // Wykrycie transmisji od nauczyciela / lektora i wyciszenie mikrofonu ucznia
                    if size >= audio_offset {
                        let sender_name = std::str::from_utf8(&recv_buf[13..audio_offset]).unwrap_or("");
                        if sender_name.starts_with("Nauczyciel") || sender_name.starts_with("Lektor") {
                            let mut st = state.lock().unwrap();
                            st.last_teacher_broadcast = current_time();
                            st.is_muted_by_teacher = true;
                        }
                    }

                    if size > audio_offset {
                        let sender_name = std::str::from_utf8(&recv_buf[13..audio_offset]).unwrap_or("").trim();
                        if !sender_name.is_empty() && !sender_name.starts_with("Nauczyciel") && !sender_name.starts_with("Lektor") {
                            let mut st = state.lock().unwrap();
                            let mut found = false;
                            for m in st.room_members.iter_mut() {
                                if m.name == sender_name || m.name.contains(sender_name) {
                                    m.is_speaking = true;
                                    found = true;
                                    break;
                                }
                            }
                            if !found {
                                st.room_members.push(crate::state::RoomMemberInfo {
                                    name: sender_name.to_string(),
                                    is_speaking: true,
                                    is_self: false,
                                    hand_raised: false,
                                });
                            }
                        }

                        let sender_key = addr.to_string();
                        let mut cursor = Cursor::new(&recv_buf[audio_offset..size]);
                        let mut decoded_samples = Vec::new();
                        while let Ok(sample_i16) = cursor.read_i16::<BigEndian>() {
                            decoded_samples.push((sample_i16 as f32) / 32767.0);
                        }

                        let mut streams = audio_streams.lock().unwrap();
                        let buf = streams.entry(sender_key).or_insert_with(VecDeque::new);

                        // Adaptacyjny bufor jittera 150 ms (eliminacja opóźnień)
                        let max_jitter_samples = (SAMPLE_RATE as usize * 150) / 1000; // 7200 próbek = 150 ms
                        let target_jitter_samples = (SAMPLE_RATE as usize * 40) / 1000; // 1920 próbek = 40 ms
                        if buf.len() > max_jitter_samples {
                            let drain_count = buf.len() - target_jitter_samples;
                            buf.drain(..drain_count);
                        }
                        buf.extend(decoded_samples);
                    }
                }
        }
    }
}
