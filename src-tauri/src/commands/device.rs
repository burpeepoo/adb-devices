use serde::Serialize;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[derive(Debug, Serialize, Clone)]
pub struct DeviceInfo {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub connection_type: String,
}

#[tauri::command]
pub fn adb_devices(app: AppHandle) -> Result<Vec<DeviceInfo>, AdbError> {
    let output = adb::run_adb(&app, &["devices", "-l"], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() < 2 {
            continue;
        }
        let serial = parts[0].to_string();
        let rest = parts[1].trim();
        let state = rest
            .split_whitespace()
            .next()
            .unwrap_or("unknown")
            .to_string();

        let mut model = String::new();
        let mut product = String::new();
        for part in rest.split_whitespace() {
            if let Some(val) = part.strip_prefix("model:") {
                model = val.to_string();
            } else if let Some(val) = part.strip_prefix("product:") {
                product = val.to_string();
            }
        }

        devices.push(DeviceInfo {
            connection_type: infer_connection_type(&serial),
            serial,
            state,
            model,
            product,
        });
    }

    Ok(devices)
}

#[tauri::command]
pub fn adb_pair(
    app: AppHandle,
    ip: String,
    port: String,
    code: String,
) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output = adb::run_adb(&app, &["pair", &addr, &code], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.contains("Successful") || stderr.contains("Successful") {
        Ok("配对成功".to_string())
    } else {
        let msg = if stderr.is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(AdbError::CommandFailed(format!("配对失败: {}", msg)))
    }
}

#[tauri::command]
pub fn adb_connect(app: AppHandle, ip: String, port: String) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output = adb::run_adb(&app, &["connect", &addr], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("connected") {
        Ok(format!("已连接到 {}", addr))
    } else if stdout.contains("already connected") {
        Ok(format!("已连接（{} 已在线）", addr))
    } else if stdout.contains("refused") {
        Err(AdbError::CommandFailed(
            "连接被拒绝，请检查IP和端口".to_string(),
        ))
    } else {
        Err(AdbError::CommandFailed(format!(
            "连接失败: {}",
            stdout.trim()
        )))
    }
}

#[tauri::command]
pub fn adb_disconnect(app: AppHandle, ip: String, port: String) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output = adb::run_adb(&app, &["disconnect", &addr], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("disconnected") {
        Ok(format!("已断开 {}", addr))
    } else {
        Ok(format!("断开结果: {}", stdout.trim()))
    }
}

fn infer_connection_type(serial: &str) -> String {
    if serial.contains(':') {
        "wireless".to_string()
    } else if serial.starts_with("adb-") || serial.contains("_adb-tls-connect._tcp") {
        "unknown".to_string()
    } else {
        "usb".to_string()
    }
}
