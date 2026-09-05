use byteorder::{BigEndian, WriteBytesExt};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use crate::state::{current_time, MediaPlaybackStatus, SAMPLE_RATE, SharedMediaPlayer, SharedServerState};

pub type TeacherAudioBuffer = Arc<Mutex<HashMap<String, VecDeque<f32>>>>;

pub fn decode_audio_bytes(bytes: &[u8]) -> Result<(Vec<f32>, f64), String> {
    use rodio::Source;
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let source = rodio::Decoder::new(cursor)
        .map_err(|e| format!("Nie udało się zdekodować pliku audio (obsługiwane formaty: MP3, WAV, FLAC, OGG): {}", e))?;

    let in_sample_rate = source.sample_rate();
    let in_channels = source.channels() as usize;
    let duration = source
        .total_duration()
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    let raw_samples: Vec<f32> = source.convert_samples::<f32>().collect();
    if raw_samples.is_empty() {
        return Err("Plik audio jest pusty lub nie zawiera próbek.".to_string());
    }

    // Miksowanie wielokanałowego dźwięku (stereo) do mono
    let mono_samples: Vec<f32> = if in_channels > 1 {
        raw_samples
            .chunks(in_channels)
            .map(|ch| ch.iter().sum::<f32>() / (ch.len() as f32))
            .collect()
    } else {
        raw_samples
    };

    // Resampling do częstotliwości próbkowania VoIP (48000 Hz)
    let target_rate = SAMPLE_RATE as f64;
    let resampled = if in_sample_rate != SAMPLE_RATE {
        let ratio = in_sample_rate as f64 / target_rate;
        let out_len = (mono_samples.len() as f64 / ratio) as usize;
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
        mono_samples
    };

    let final_duration = if duration > 0.0 {
        duration
    } else {
        resampled.len() as f64 / target_rate
    };

    Ok((resampled, final_duration))
}

pub fn get_media_status(player: &SharedMediaPlayer) -> MediaPlaybackStatus {
    let p = player.lock().unwrap();
    let total_samples = p.samples.len();
    let is_loaded = total_samples > 0;
    let current_time_secs = if is_loaded {
        p.current_sample_idx as f64 / SAMPLE_RATE as f64
    } else {
        0.0
    };
    let total_duration_secs = if is_loaded {
        if p.duration_secs > 0.0 {
            p.duration_secs
        } else {
            total_samples as f64 / SAMPLE_RATE as f64
        }
    } else {
        0.0
    };

    MediaPlaybackStatus {
        is_loaded,
        is_playing: p.is_playing,
        file_name: p.file_name.clone(),
        current_time_secs,
        total_duration_secs,
        volume: p.volume,
        target: p.target.clone(),
    }
}

pub fn run_media_player_streamer(
    state: SharedServerState,
    media_player: SharedMediaPlayer,
    teacher_audio: TeacherAudioBuffer,
) {
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
    let mut seq_num = 0u32;
    let chunk_size = (SAMPLE_RATE as usize * 20) / 1000; // 960 próbek = 20ms przy 48000Hz

    loop {
        std::thread::sleep(Duration::from_millis(20));

        let (samples_to_send, target, file_name) = {
            let mut player = media_player.lock().unwrap();
            if !player.is_playing || player.samples.is_empty() {
                continue;
            }

            let start = player.current_sample_idx;
            if start >= player.samples.len() {
                player.is_playing = false;
                player.current_sample_idx = 0;
                continue;
            }

            let end = (start + chunk_size).min(player.samples.len());
            let mut chunk = player.samples[start..end].to_vec();
            player.current_sample_idx = end;

            let volume = player.volume;
            if (volume - 1.0).abs() > 0.001 {
                for s in &mut chunk {
                    *s *= volume;
                }
            }

            if end >= player.samples.len() {
                player.is_playing = false;
                player.current_sample_idx = 0;
            }

            (chunk, player.target.clone(), player.file_name.clone())
        };

        if samples_to_send.is_empty() {
            continue;
        }

        seq_num = seq_num.wrapping_add(1);
        let name_str = if file_name.is_empty() {
            "Lektor".to_string()
        } else {
            format!("Lektor: {}", file_name)
        };
        let name_bytes = name_str.as_bytes();
        let name_len = (name_bytes.len().min(40)) as u8;

        let mut packet = Vec::with_capacity(13 + name_len as usize + samples_to_send.len() * 2);
        let _ = packet.write_u32::<BigEndian>(seq_num);
        let _ = packet.write_f64::<BigEndian>(current_time());
        packet.push(name_len);
        packet.extend_from_slice(&name_bytes[..name_len as usize]);

        for &sample in &samples_to_send {
            let clamped = sample.clamp(-1.0, 1.0);
            let _ = packet.write_i16::<BigEndian>((clamped * 32767.0) as i16);
        }

        // Wysyłanie do wskazanych uczniów (wszystkich lub wybranego pokoju)
        {
            let st = state.lock().unwrap();
            if target == "all" || target.is_empty() || target == "Wszyscy" {
                for target_addr in st.ip_to_addr.values() {
                    let _ = socket.send_to(&packet, target_addr);
                }
            } else if let Some(members) = st.groups.get(&target) {
                for ip in members {
                    if let Some(target_addr) = st.ip_to_addr.get(ip) {
                        let _ = socket.send_to(&packet, target_addr);
                    }
                }
            }
        }

        // Odsłuch bezpośredni w słuchawkach nauczyciela (miksowanie)
        {
            let mut t_streams = teacher_audio.lock().unwrap();
            let buf = t_streams
                .entry("__media_player__".to_string())
                .or_insert_with(VecDeque::new);

            let max_jitter_samples = (SAMPLE_RATE as usize * 150) / 1000;
            if buf.len() > max_jitter_samples {
                let drain_count = buf.len() - ((SAMPLE_RATE as usize * 40) / 1000);
                buf.drain(..drain_count);
            }
            buf.extend(samples_to_send);
        }
    }
}

pub fn capture_and_broadcast(state: SharedServerState) {
    loop {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let supported_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[SERVER-MIC] Błąd default_input_config: {}", e);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let in_channels = supported_config.channels() as usize;
        let in_sample_rate = supported_config.sample_rate().0;
        let sample_format = supported_config.sample_format();
        let in_config = supported_config.config();

        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[SERVER-MIC] Błąd bind UDP: {}", e);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let stream_error = Arc::new(AtomicBool::new(false));
        let stream_error_cb = stream_error.clone();
        let state_mic = state.clone();
        let mut seq_num = 0u32;

        let err_fn = move |err| {
            eprintln!("[SERVER-MIC] Błąd strumienia: {}", err);
            stream_error_cb.store(true, Ordering::SeqCst);
        };

        let mut on_mono_samples = move |mono_samples: &[f32]| {
            let st = state_mic.lock().unwrap();
            if !st.is_broadcasting {
                return;
            }

            seq_num += 1;
            let name_bytes = b"Nauczyciel";
            let name_len = name_bytes.len() as u8;

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

            let mut packet = Vec::with_capacity(13 + name_len as usize + samples_48k.len() * 2);
            let _ = packet.write_u32::<BigEndian>(seq_num);
            let _ = packet.write_f64::<BigEndian>(current_time());
            packet.push(name_len);
            packet.extend_from_slice(name_bytes);

            for &sample in &samples_48k {
                let clamped = sample.clamp(-1.0, 1.0);
                let _ = packet.write_i16::<BigEndian>((clamped * 32767.0) as i16);
            }

            for target_addr in st.ip_to_addr.values() {
                let _ = socket.send_to(&packet, target_addr);
            }
        };

        let stream_res = match sample_format {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &in_config,
                    move |data: &[f32], _| {
                        let mono: Vec<f32> = if in_channels > 1 {
                            data.chunks(in_channels)
                                .map(|ch| ch.iter().sum::<f32>() / in_channels as f32)
                                .collect()
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
            _ => {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        if let Ok(s) = stream_res {
            let _ = s.play();
            while !stream_error.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(500));
            }
        } else if let Err(e) = stream_res {
            eprintln!("[SERVER-MIC] Błąd inicjalizacji mikrofonu: {}", e);
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}

pub fn play_teacher_audio(audio_streams: TeacherAudioBuffer) {
    loop {
        let host = cpal::default_host();
        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let supported_out_config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[SERVER-AUDIO-OUT] Błąd default_output_config: {}", e);
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let out_channels = supported_out_config.channels() as usize;
        let out_config = supported_out_config.config();
        let streams_playback = audio_streams.clone();
        let stream_error = Arc::new(AtomicBool::new(false));
        let stream_error_cb = stream_error.clone();

        let stream = device.build_output_stream(
            &out_config,
            move |out_data: &mut [f32], _| {
                let mut streams = streams_playback.lock().unwrap();
                for frame in out_data.chunks_mut(out_channels) {
                    let mut mixed = 0.0f32;
                    for (_, buf) in streams.iter_mut() {
                        if let Some(s) = buf.pop_front() {
                            mixed += s;
                        }
                    }
                    let sample_val = mixed.clamp(-1.0, 1.0);
                    for ch in frame.iter_mut() {
                        *ch = sample_val;
                    }
                }
                streams.retain(|_, buf| !buf.is_empty());
            },
            move |err| {
                eprintln!("[SERVER-AUDIO-OUT] Błąd strumienia: {}", err);
                stream_error_cb.store(true, Ordering::SeqCst);
            },
            None,
        );

        if let Ok(s) = stream {
            let _ = s.play();
            while !stream_error.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(500));
            }
        } else if let Err(e) = stream {
            eprintln!("[SERVER-AUDIO-OUT] Błąd inicjalizacji wyjścia audio nauczyciela: {}", e);
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}


