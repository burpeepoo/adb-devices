use chrono::Local;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[tauri::command]
pub fn adb_start_recording(
    app: AppHandle,
    device_serial: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, AdbError> {
    // Check if already recording
    {
        let rec = state.recording_process.lock().unwrap();
        if rec.is_some() {
            return Err(AdbError::AlreadyRecording);
        }
    }

    let adb_path = adb::get_adb_path(&app)?;
    let mut cmd = std::process::Command::new(&adb_path);
    if let Some(serial) = &device_serial {
        cmd.args(["-s", serial]);
    }
    cmd.args(["shell", "screenrecord", "/sdcard/recording.mp4"]);

    let child = cmd.spawn()?;

    {
        let mut rec = state.recording_process.lock().unwrap();
        *rec = Some(child);
    }
    {
        let mut rec_dev = state.recording_device.lock().unwrap();
        *rec_dev = device_serial;
    }

    Ok("录屏已开始".to_string())
}

#[tauri::command]
pub fn adb_stop_recording(
    app: AppHandle,
    save_dir: String,
    device_serial: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, AdbError> {
    let serial = {
        let rec_dev = state.recording_device.lock().unwrap();
        rec_dev.clone().or(device_serial)
    };

    // Kill the recording process
    {
        let mut rec = state.recording_process.lock().unwrap();
        if let Some(mut child) = rec.take() {
            let _ = child.kill();
            let _ = child.wait();
        } else {
            return Err(AdbError::NotRecording);
        }
    }
    {
        let mut rec_dev = state.recording_device.lock().unwrap();
        *rec_dev = None;
    }

    // Give the device a moment to finalize the file
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Generate filename and pull
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("recording_{}.mp4", timestamp);
    let local_path = PathBuf::from(&save_dir).join(&filename);
    let local_path_str = local_path.to_string_lossy().to_string();

    let serial_ref = serial.as_deref();
    let output = adb::run_adb(
        &app,
        &["pull", "/sdcard/recording.mp4", &local_path_str],
        serial_ref,
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AdbError::CommandFailed(format!("拉取录屏失败: {}", stderr.trim())));
    }

    // Cleanup device temp file
    let _ = adb::run_adb(&app, &["shell", "rm", "/sdcard/recording.mp4"], serial_ref);

    Ok(local_path_str)
}
