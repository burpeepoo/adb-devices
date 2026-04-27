use chrono::Local;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[tauri::command]
pub fn adb_screenshot(
    app: AppHandle,
    save_dir: String,
    device_serial: Option<String>,
) -> Result<String, AdbError> {
    let serial = device_serial.as_deref();
    let device_path = "/sdcard/screenshot.png";

    // Step 1: Take screenshot on device
    let output = adb::run_adb(&app, &["shell", "screencap", "-p", device_path], serial)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AdbError::CommandFailed(format!("截图失败: {}", stderr.trim())));
    }

    // Step 2: Generate filename with timestamp
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("screenshot_{}.png", timestamp);
    let local_path = PathBuf::from(&save_dir).join(&filename);

    // Step 3: Pull to local
    let local_path_str = local_path.to_string_lossy().to_string();
    let output = adb::run_adb(&app, &["pull", device_path, &local_path_str], serial)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AdbError::CommandFailed(format!("拉取截图失败: {}", stderr.trim())));
    }

    // Step 4: Cleanup device temp file
    let _ = adb::run_adb(&app, &["shell", "rm", device_path], serial);

    Ok(local_path_str)
}
