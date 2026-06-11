use chrono::Local;
use rust_i18n::t;
use std::path::PathBuf;
use std::sync::MutexGuard;
use tauri::AppHandle;

use crate::adb::{self, AdbError};
use crate::state::{AppState, RecordingState};

fn lock_recording_state<'a>(
    state: &'a tauri::State<'_, AppState>,
) -> Result<MutexGuard<'a, RecordingState>, AdbError> {
    state
        .recording
        .lock()
        .map_err(|_| AdbError::CommandFailed(t!("recording.state_error").into_owned()))
}

#[tauri::command(async)]
pub fn adb_start_recording(
    app: AppHandle,
    device_serial: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, AdbError> {
    let mut recording = lock_recording_state(&state)?;
    if recording.process.is_some() {
        return Err(AdbError::AlreadyRecording);
    }

    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let remote_path = format!("/sdcard/adb_manager_recording_{}.mp4", timestamp);

    let adb_path = adb::get_adb_path(&app)?;
    let mut cmd = std::process::Command::new(&adb_path);
    adb::prepare_adb_command(&mut cmd);
    if let Some(serial) = &device_serial {
        cmd.args(["-s", serial]);
    }
    cmd.args(["shell", "screenrecord", &remote_path]);

    let child = cmd.spawn()?;
    recording.process = Some(child);
    recording.device = device_serial;
    recording.remote_path = Some(remote_path);

    Ok(t!("recording.started").to_string())
}

#[tauri::command(async)]
pub fn adb_stop_recording(
    app: AppHandle,
    save_dir: String,
    device_serial: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, AdbError> {
    let (serial, remote_path) = {
        let mut recording = lock_recording_state(&state)?;
        let serial = recording.device.clone().or(device_serial);
        if let Some(mut child) = recording.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        } else {
            return Err(AdbError::NotRecording);
        }
        recording.device = None;
        let remote_path = recording
            .remote_path
            .take()
            .unwrap_or_else(|| "/sdcard/recording.mp4".to_string());
        (serial, remote_path)
    };

    // Give the device a moment to finalize the file
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Generate filename and pull
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("recording_{}.mp4", timestamp);
    let local_path = PathBuf::from(&save_dir).join(&filename);
    let local_path_str = local_path.to_string_lossy().to_string();

    let serial_ref = serial.as_deref();
    let output = adb::run_adb(&app, &["pull", &remote_path, &local_path_str], serial_ref)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AdbError::CommandFailed(
            t!("recording.pull_failed", "message" => stderr.trim()).into_owned(),
        ));
    }

    // Cleanup device temp file
    let _ = adb::run_adb(&app, &["shell", "rm", &remote_path], serial_ref);

    Ok(local_path_str)
}
