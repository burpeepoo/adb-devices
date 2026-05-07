use rust_i18n::t;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{AppHandle, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct DeviceInfo {
    pub serial: String,
    pub device_sn: String,
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

#[tauri::command(async)]
pub fn adb_devices(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DeviceInfo>, AdbError> {
    let output = adb::run_adb_with_timeout(&app, &["devices", "-l"], None, Duration::from_secs(8))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let devices = parse_devices_output(&stdout);
    Ok(enrich_device_serial_numbers(
        &app,
        &state.device_sn_cache,
        devices,
    ))
}

#[tauri::command(async)]
pub fn adb_mdns_discover(app: AppHandle) -> Result<Vec<MdnsDevice>, AdbError> {
    let output =
        adb::run_adb_with_timeout(&app, &["mdns", "services"], None, Duration::from_secs(8))?;
    adb::ensure_success(&output, &t!("device.scan_failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_mdns_services(&stdout))
}

#[tauri::command(async)]
pub fn adb_auto_connect(app: AppHandle, address: String) -> Result<String, AdbError> {
    let output =
        adb::run_adb_with_timeout(&app, &["connect", &address], None, Duration::from_secs(15))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("connected") || stdout.contains("already connected") {
        Ok(t!("device.connected_to", address = address).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(AdbError::CommandFailed(
            t!("device.connect_failed", "message" => msg).into_owned(),
        ))
    }
}

#[tauri::command(async)]
pub fn adb_mdns_auto_connect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DeviceInfo>, AdbError> {
    let output = adb::run_adb_with_env_timeout(
        &app,
        &["devices", "-l"],
        None,
        &[("ADB_MDNS_AUTO_CONNECT", "adb-tls-connect")],
        Duration::from_secs(12),
    )?;
    adb::ensure_success(&output, &t!("device.auto_connect_failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let devices = parse_devices_output(&stdout);
    Ok(enrich_device_serial_numbers(
        &app,
        &state.device_sn_cache,
        devices,
    ))
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
            device_sn: String::new(),
            state,
            model,
            product,
        });
    }

    devices
}

fn enrich_device_serial_numbers(
    app: &AppHandle,
    device_sn_cache: &Mutex<HashMap<String, String>>,
    devices: Vec<DeviceInfo>,
) -> Vec<DeviceInfo> {
    devices
        .into_iter()
        .map(|mut device| {
            if device.state == "device" {
                device.device_sn = read_device_sn_cached(app, device_sn_cache, &device.serial);
            }
            device
        })
        .collect()
}

fn read_device_sn_cached(
    app: &AppHandle,
    device_sn_cache: &Mutex<HashMap<String, String>>,
    adb_serial: &str,
) -> String {
    if let Some(device_sn) = parse_mdns_adb_serial(adb_serial) {
        return device_sn;
    }

    if let Ok(cache) = device_sn_cache.lock() {
        if let Some(cached) = cache.get(adb_serial).filter(|value| !value.is_empty()) {
            return cached.clone();
        }
    }

    let device_sn = read_device_sn(app, adb_serial);
    if !device_sn.is_empty() {
        if let Ok(mut cache) = device_sn_cache.lock() {
            cache.insert(adb_serial.to_string(), device_sn.clone());
        }
    }
    device_sn
}

fn read_device_sn(app: &AppHandle, adb_serial: &str) -> String {
    let Ok(output) = adb::run_adb_with_timeout(
        app,
        &["shell", "getprop", "ro.serialno"],
        Some(adb_serial),
        Duration::from_secs(3),
    ) else {
        return String::new();
    };

    if !output.status.success() {
        return String::new();
    }

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn parse_mdns_adb_serial(adb_serial: &str) -> Option<String> {
    let serial = adb_serial.strip_prefix("adb-")?;
    let (device_sn, _) = serial.split_once('-')?;
    if device_sn.is_empty() || !adb_serial.contains("._adb-tls-connect._tcp") {
        return None;
    }
    Some(device_sn.to_string())
}

#[tauri::command(async)]
pub fn adb_pair(
    app: AppHandle,
    ip: String,
    port: String,
    code: String,
) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output =
        adb::run_adb_with_timeout(&app, &["pair", &addr, &code], None, Duration::from_secs(25))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.contains("Successful") && !stderr.contains("Successful") {
        let msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(AdbError::CommandFailed(
            t!("device.pair_failed", "message" => msg).into_owned(),
        ));
    }

    // 配对成功后立即尝试 mDNS 自动连接，避免用户手动输入连接端口
    let connect_result = adb::run_adb_with_env_timeout(
        &app,
        &["devices", "-l"],
        None,
        &[("ADB_MDNS_AUTO_CONNECT", "adb-tls-connect")],
        Duration::from_secs(15),
    );

    match connect_result {
        Ok(output) => {
            let connect_stdout = String::from_utf8_lossy(&output.stdout);
            if connect_stdout
                .lines()
                .any(|l| l.contains(&ip) && l.contains("device"))
            {
                Ok(t!("device.pair_success_connected", ip = ip).to_string())
            } else {
                Ok(t!("device.pair_success_pending", ip = ip).to_string())
            }
        }
        Err(_) => Ok(t!("device.pair_success", ip = ip).to_string()),
    }
}

#[tauri::command(async)]
pub fn adb_connect(app: AppHandle, ip: String, port: String) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output =
        adb::run_adb_with_timeout(&app, &["connect", &addr], None, Duration::from_secs(15))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("connected") {
        return Ok(t!("device.connected_to", address = addr).to_string());
    } else if stdout.contains("already connected") {
        return Ok(t!("device.already_connected", address = addr).to_string());
    }

    // 直接连接失败——设备端口可能已变化，回退到 mDNS 自动发现
    let fallback_output = adb::run_adb_with_env_timeout(
        &app,
        &["devices", "-l"],
        None,
        &[("ADB_MDNS_AUTO_CONNECT", "adb-tls-connect")],
        Duration::from_secs(15),
    )?;
    let fallback_stdout = String::from_utf8_lossy(&fallback_output.stdout);

    // 检查 mDNS 自动发现是否成功连接了目标设备
    for line in fallback_stdout.lines().skip(1) {
        let line = line.trim();
        if line.contains(&ip) && line.contains("device") {
            return Ok(t!("device.connected_via_mdns", ip = ip).to_string());
        }
    }

    // 两种方式都失败，返回原始错误
    if stdout.contains("refused") {
        Err(AdbError::CommandFailed(
            t!("device.connect_refused", address = addr).into_owned(),
        ))
    } else {
        Err(AdbError::CommandFailed(
            t!("device.connect_refused_wifi", "message" => stdout.trim()).into_owned(),
        ))
    }
}

#[tauri::command(async)]
pub fn adb_disconnect(app: AppHandle, ip: String, port: String) -> Result<String, AdbError> {
    let addr = format!("{}:{}", ip, port);
    let output =
        adb::run_adb_with_timeout(&app, &["disconnect", &addr], None, Duration::from_secs(8))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("disconnected") {
        Ok(t!("device.disconnected", address = addr).to_string())
    } else {
        Ok(t!("device.disconnect_result", "message" => stdout.trim()).to_string())
    }
}

fn infer_connection_type(serial: &str) -> String {
    if serial.contains(':') {
        "wireless".to_string()
    } else if serial.starts_with("adb-") || serial.contains("_adb-tls-") {
        "wireless".to_string()
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

    #[test]
    fn parses_mdns_adb_serial() {
        assert_eq!(
            parse_mdns_adb_serial("adb-NCRC10008CC-rYbViz._adb-tls-connect._tcp"),
            Some("NCRC10008CC".to_string())
        );
        assert_eq!(parse_mdns_adb_serial("192.168.110.182:45521"), None);
        assert_eq!(
            parse_mdns_adb_serial("adb-NCRC10008CC-rYbViz._adb-tls-pairing._tcp"),
            None
        );
    }
}
