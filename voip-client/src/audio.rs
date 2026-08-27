use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::io::Cursor;
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use crate::state::{PORT_AUDIO, SAMPLE_RATE, VAD_THRESHOLD, SharedClientState};

fn current_time() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

pub fn capture_and_send_pcm(state: SharedClientState, socket: UdpSocket) {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => return,
    };
    let config = cpal::StreamConfig {
        channels: 1,
        sample_rate: cpal::SampleRate(SAMPLE_RATE),
        buffer_size: cpal::BufferSize::Default,
    };

    let mut last_speech = Instant::now() - Duration::from_secs(10);
    let mut last_heartbeat = Instant::now();

    let stream = device.build_input_stream(
        &config,
        move |data: &[f32], _| {
            let max_amp = data.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
            let is_speech = max_amp >= VAD_THRESHOLD;
            if is_speech {
                last_speech = Instant::now();
            }

            let speech_active = last_speech.elapsed() < Duration::from_millis(350);
            let need_heartbeat = last_heartbeat.elapsed() >= Duration::from_secs(2);

            {
                let mut st = state.lock().unwrap();
                st.is_speaking = speech_active;
            }

            // Jeśli nie ma mowy ani nie minął interwał heartbeat, oszczędzamy sieć
            if !speech_active && !need_heartbeat {
                return;
            }

            let mut st = state.lock().unwrap();
            if !st.is_registered() {
                return; // Nie wysyłaj żadnych pakietów do czasu wprowadzenia imienia
            }

            if let Some(ref server_ip) = st.server_ip {
                let target_addr = format!("{}:{}", server_ip, PORT_AUDIO);
                st.seq_num += 1;
                let name_bytes = st.username.as_bytes();
                let name_len = (name_bytes.len().min(64)) as u8;

                let samples_count = if speech_active { data.len() } else { 0 };
                let mut packet = Vec::with_capacity(13 + (name_len as usize) + (samples_count * 2));
                let _ = packet.write_u32::<BigEndian>(st.seq_num);
                let _ = packet.write_f64::<BigEndian>(current_time());
                packet.push(name_len);
                packet.extend_from_slice(&name_bytes[..name_len as usize]);

                if speech_active {
                    for &sample in data {
                        let clamped = sample.clamp(-1.0, 1.0);
                        let _ = packet.write_i16::<BigEndian>((clamped * 32767.0) as i16);
                    }
                } else {
                    last_heartbeat = Instant::now();
                }

                let _ = socket.send_to(&packet, target_addr);
            }
        },
        |_| {},
        None,
    );

    if let Ok(s) = stream {
        let _ = s.play();
        std::thread::park();
    }
}

pub fn receive_and_play_pcm(state: SharedClientState, socket: UdpSocket) {
    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(d) => d,
        None => return,
    };
    let config = cpal::StreamConfig {
        channels: 1,
        sample_rate: cpal::SampleRate(SAMPLE_RATE),
        buffer_size: cpal::BufferSize::Default,
    };

    let audio_streams: Arc<Mutex<HashMap<String, VecDeque<f32>>>> = Arc::new(Mutex::new(HashMap::new()));
    let streams_playback = audio_streams.clone();

    // Równoległy mikser audio dla wielu rozmówców
    let stream = device.build_output_stream(
        &config,
        move |out_data: &mut [f32], _| {
            let mut streams = streams_playback.lock().unwrap();
            for sample in out_data.iter_mut() {
                let mut mixed = 0.0f32;
                for (_, buf) in streams.iter_mut() {
                    if let Some(s) = buf.pop_front() {
                        mixed += s;
                    }
                }
                *sample = mixed.clamp(-1.0, 1.0);
            }
            streams.retain(|_, buf| !buf.is_empty());
        },
        |_| {},
        None,
    );

    if let Ok(s) = stream {
        let _ = s.play();
        let mut recv_buf = [0u8; 8192];
        loop {
            if let Ok((size, addr)) = socket.recv_from(&mut recv_buf) {
                // Dynamiczna synchronizacja pokoju roboczego
                if size >= 10 && &recv_buf[..10] == b"VOIP_ROOM:" {
                    if let Ok(room_name) = std::str::from_utf8(&recv_buf[10..size]) {
                        let mut st = state.lock().unwrap();
                        st.group = Some(if room_name == "Brak" {
                            "Poczekalnia".to_string()
                        } else {
                            room_name.to_string()
                        });
                    }
                    continue;
                }

                if size > 13 {
                    let name_len = recv_buf[12] as usize;
                    let audio_offset = 13 + name_len;
                    if size > audio_offset {
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
}
