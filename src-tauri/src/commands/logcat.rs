use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;

use tauri::{AppHandle, Emitter, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[tauri::command]
pub fn adb_start_logcat(
    app: AppHandle,
    state: State<'_, AppState>,
    device_serial: Option<String>,
) -> Result<String, AdbError> {
    {
        let mut process = state
            .logcat_process
            .lock()
            .map_err(|_| AdbError::CommandFailed("logcat 状态异常".to_string()))?;
        if let Some(child) = process.as_mut() {
            if child.try_wait()?.is_none() {
                return Err(AdbError::CommandFailed("logcat 已在运行".to_string()));
            }
            *process = None;
        }
    }

    let adb_path = adb::get_adb_path(&app)?;
    let mut command = Command::new(adb_path);
    if let Some(serial) = device_serial.as_deref() {
        command.args(["-s", serial]);
    }
    command
        .arg("logcat")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit("adb-logcat-line", line);
            }
        });
    }

    if let Some(err) = stderr {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit("adb-logcat-line", format!("[stderr] {}", line));
            }
        });
    }

    {
        let mut process = state
            .logcat_process
            .lock()
            .map_err(|_| AdbError::CommandFailed("logcat 状态异常".to_string()))?;
        *process = Some(child);
    }
    {
        let mut active_device = state
            .logcat_device
            .lock()
            .map_err(|_| AdbError::CommandFailed("logcat 状态异常".to_string()))?;
        *active_device = device_serial;
    }

    Ok("logcat 已开始".to_string())
}

#[tauri::command]
pub fn adb_stop_logcat(state: State<'_, AppState>) -> Result<String, AdbError> {
    let mut process = state
        .logcat_process
        .lock()
        .map_err(|_| AdbError::CommandFailed("logcat 状态异常".to_string()))?;

    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(mut active_device) = state.logcat_device.lock() {
            *active_device = None;
        }
        Ok("logcat 已关闭".to_string())
    } else {
        Err(AdbError::CommandFailed("logcat 未在运行".to_string()))
    }
}

#[tauri::command]
pub fn export_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, AdbError> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("导出日志")
        .set_file_name(&default_name)
        .blocking_save_file();

    if let Some(path) = path {
        let path_string = path.to_string();
        std::fs::write(&path_string, content)?;
        Ok(Some(path_string))
    } else {
        Ok(None)
    }
}
