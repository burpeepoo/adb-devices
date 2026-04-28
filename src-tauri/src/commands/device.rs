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

#[derive(Debug, Serialize, Clone)]
pub struct MdnsDevice {
    pub service_name: String,
    pub service_type: String,
    pub ip: String,
    pub port: String,
    pub address: String,
    pub connectable: bool,
}

#[tauri::command]
pub fn adb_devices(app: AppHandle) -> Result<Vec<DeviceInfo>, AdbError> {
    let output = adb::run_adb(&app, &["devices", "-l"], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_devices_output(&stdout))
}

#[tauri::command]
pub fn adb_mdns_discover(app: AppHandle) -> Result<Vec<MdnsDevice>, AdbError> {
    let output = adb::run_adb(&app, &["mdns", "services"], None)?;
    adb::ensure_success(&output, "扫描局域网 ADB 设备失败")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_mdns_services(&stdout))
}

#[tauri::command]
pub fn adb_auto_connect(app: AppHandle, address: String) -> Result<String, AdbError> {
    let output = adb::run_adb(&app, &["connect", &address], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("connected") || stdout.contains("already connected") {
        Ok(format!("已连接到 {}", address))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(AdbError::CommandFailed(format!("连接失败: {}", msg)))
    }
}

#[tauri::command]
pub fn adb_mdns_auto_connect(app: AppHandle) -> Result<Vec<DeviceInfo>, AdbError> {
    let output = adb::run_adb_with_env(
        &app,
        &["devices", "-l"],
        None,
        &[("ADB_MDNS_AUTO_CONNECT", "adb-tls-connect")],
    )?;
    adb::ensure_success(&output, "自动连接已配对设备失败")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_devices_output(&stdout))
}

fn parse_devices_output(stdout: &str) -> Vec<DeviceInfo> {
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

    devices
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

fn parse_mdns_services(stdout: &str) -> Vec<MdnsDevice> {
    let mut devices = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }

        let address = parts[parts.len() - 1].to_string();
        let service_type = parts[parts.len() - 2].to_string();
        let service_name = parts[..parts.len() - 2].join(" ");
        let Some((ip, port)) = split_address(&address) else {
            continue;
        };

        let connectable = service_type.contains("_adb-tls-connect");
        devices.push(MdnsDevice {
            service_name,
            service_type,
            ip,
            port,
            address,
            connectable,
        });
    }

    devices
}

fn split_address(address: &str) -> Option<(String, String)> {
    let (ip, port) = address.rsplit_once(':')?;
    if ip.is_empty() || port.is_empty() {
        return None;
    }
    Some((ip.trim_matches(['[', ']']).to_string(), port.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mdns_services() {
        let output = "\
List of discovered mdns services
adb-NCRC10008CC-rYbViz  _adb-tls-connect._tcp  192.168.110.182:37081
adb-NCSC10001SC-vD4b53  _adb-tls-pairing._tcp  192.168.110.103:36353
";

        let devices = parse_mdns_services(output);

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].service_name, "adb-NCRC10008CC-rYbViz");
        assert_eq!(devices[0].service_type, "_adb-tls-connect._tcp");
        assert_eq!(devices[0].ip, "192.168.110.182");
        assert_eq!(devices[0].port, "37081");
        assert!(devices[0].connectable);
        assert_eq!(devices[1].service_type, "_adb-tls-pairing._tcp");
        assert!(!devices[1].connectable);
    }
}
