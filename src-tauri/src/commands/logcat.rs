use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct LogcatEntry {
    pub timestamp: String,
    pub level: String,
    pub pid: String,
    pub tag: String,
    pub message: String,
}

#[tauri::command]
pub fn adb_read_logcat(
    app: AppHandle,
    device_serial: Option<String>,
    logcat_filter: Option<String>,
    line_limit: Option<u16>,
) -> Result<Vec<LogcatEntry>, AdbError> {
    let limit = line_limit.unwrap_or(800).clamp(100, 3000).to_string();
    let mut owned_args = vec![
        "logcat".to_string(),
        "-d".to_string(),
        "-v".to_string(),
        "threadtime".to_string(),
        "-t".to_string(),
        limit,
    ];
    append_filter_args(&mut owned_args, logcat_filter.as_deref());

    let arg_refs = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = adb::run_adb(&app, &arg_refs, device_serial.as_deref())?;
    adb::ensure_success(&output, "读取 logcat 失败")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(parse_logcat_line).collect())
}

#[tauri::command]
pub fn adb_start_logcat(
    app: AppHandle,
    state: State<'_, AppState>,
    device_serial: Option<String>,
    logcat_filter: Option<String>,
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
    command.args(["logcat", "-v", "threadtime"]);
    let mut filter_args = Vec::new();
    append_filter_args(&mut filter_args, logcat_filter.as_deref());
    command.args(filter_args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

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
                let _ = app_handle.emit("adb-logcat-line", parse_logcat_line(&line));
            }
        });
    }

    if let Some(err) = stderr {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit(
                    "adb-logcat-line",
                    LogcatEntry {
                        timestamp: String::new(),
                        level: "E".to_string(),
                        pid: String::new(),
                        tag: "adb".to_string(),
                        message: line,
                    },
                );
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
        Ok("logcat 未在运行".to_string())
    }
}

#[tauri::command]
pub async fn export_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, AdbError> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| AdbError::CommandFailed(format!("导出日志失败: {}", e)))?
}

fn append_filter_args(args: &mut Vec<String>, logcat_filter: Option<&str>) {
    if let Some(filter) = logcat_filter
        .map(str::trim)
        .filter(|filter| !filter.is_empty())
    {
        args.extend(filter.split_whitespace().map(ToString::to_string));
    }
}

fn parse_logcat_line(line: &str) -> LogcatEntry {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() >= 6 {
        let rest = parts[5..].join(" ");
        let (tag, message) = rest
            .split_once(':')
            .map(|(tag, message)| (tag.trim().to_string(), message.trim_start().to_string()))
            .unwrap_or_else(|| (String::new(), rest));
        return LogcatEntry {
            timestamp: format!("{} {}", parts[0], parts[1]),
            pid: parts[2].to_string(),
            level: parts[4].to_string(),
            tag,
            message,
        };
    }

    LogcatEntry {
        timestamp: String::new(),
        level: String::new(),
        pid: String::new(),
        tag: String::new(),
        message: line.to_string(),
    }
}
