use byteorder::{BigEndian, WriteBytesExt};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use crate::state::{current_time, SAMPLE_RATE, SharedServerState};

pub type TeacherAudioBuffer = Arc<Mutex<HashMap<String, VecDeque<f32>>>>;

pub fn capture_and_broadcast(state: SharedServerState) {
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
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
    let mut seq_num = 0u32;

    let stream = device.build_input_stream(
        &config,
        move |data: &[f32], _| {
            let st = state.lock().unwrap();
            if !st.is_broadcasting {
                return;
            }

            seq_num += 1;
            let name_bytes = b"Nauczyciel";
            let name_len = name_bytes.len() as u8;
            let mut packet = Vec::with_capacity(13 + name_len as usize + data.len() * 2);
            let _ = packet.write_u32::<BigEndian>(seq_num);
            let _ = packet.write_f64::<BigEndian>(current_time());
            packet.push(name_len);
            packet.extend_from_slice(name_bytes);

            for &sample in data {
                let clamped = sample.clamp(-1.0, 1.0);
                let _ = packet.write_i16::<BigEndian>((clamped * 32767.0) as i16);
            }

            for target_addr in st.ip_to_addr.values() {
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

pub fn play_teacher_audio(audio_streams: TeacherAudioBuffer) {
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

    let stream = device.build_output_stream(
        &config,
        move |out_data: &mut [f32], _| {
            let mut streams = audio_streams.lock().unwrap();
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
        std::thread::park();
    }
}
