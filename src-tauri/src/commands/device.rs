use rust_i18n::t;
use serde::Serialize;
use std::{
    collections::HashMap,
    net::{TcpStream, ToSocketAddrs},
    process::Command,
    sync::Mutex,
    time::Duration,
};
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

#[derive(Debug, Serialize, Clone, Default)]
pub struct DeviceSummary {
    pub android_version: String,
    pub api_level: String,
    pub build_tags: String,
    pub verified_boot_state: String,
    pub vbmeta_device_state: String,
    pub bootloader_state: String,
    pub battery_level: String,
    pub battery_status: String,
    pub display_size: String,
    pub display_density: String,
    pub display_physical_size_mm: String,
    pub storage: String,
    pub foreground_app: String,
    pub security_patch: String,
    pub selinux: String,
    pub uptime: String,
    pub cpu_abi: String,
    pub build_fingerprint: String,
}

#[tauri::command(async)]
pub fn adb_restart_server(app: AppHandle) -> Result<String, AdbError> {
    restart_adb_server(&app)?;
    Ok(t!("device.adb_restarted").to_string())
}

#[tauri::command(async)]
pub fn get_local_ipv4_addresses() -> Vec<String> {
    local_ipv4_addresses()
}

#[tauri::command(async)]
pub fn tcp_probe_endpoint(ip: String, port: String) -> bool {
    let address = format!("{}:{}", ip.trim(), port.trim());
    let Ok(mut addrs) = address.to_socket_addrs() else {
        return false;
    };
    let Some(socket_addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&socket_addr, Duration::from_secs(2)).is_ok()
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
pub fn adb_device_summary(
    app: AppHandle,
    device_serial: String,
) -> Result<DeviceSummary, AdbError> {
    let props_output = adb_shell_text(
        &app,
        &device_serial,
        "getprop ro.build.version.release; getprop ro.build.version.sdk; getprop ro.build.tags; getprop ro.boot.verifiedbootstate; getprop ro.boot.vbmeta.device_state; getprop ro.boot.flash.locked; getprop ro.build.version.security_patch; getprop ro.product.cpu.abi; getprop ro.build.fingerprint",
        Duration::from_secs(4),
    );
    let props = props_output
        .lines()
        .map(|line| line.trim().to_string())
        .collect::<Vec<_>>();
    let prop = |index: usize| props.get(index).cloned().unwrap_or_default();

    let battery_output = adb_shell_text(
        &app,
        &device_serial,
        "dumpsys battery",
        Duration::from_secs(4),
    );
    let display_size_output =
        adb_shell_text(&app, &device_serial, "wm size", Duration::from_secs(3));
    let display_density_output =
        adb_shell_text(&app, &device_serial, "wm density", Duration::from_secs(3));
    let display_physical_size_output = adb_shell_text(
        &app,
        &device_serial,
        r#"for p in /sys/class/graphics/fb0 /sys/class/drm/card0-*; do if [ -r "$p/width" ] && [ -r "$p/height" ]; then cat "$p/width"; cat "$p/height"; exit; fi; done"#,
        Duration::from_secs(3),
    );
    let storage_output =
        adb_shell_text(&app, &device_serial, "df -h /data", Duration::from_secs(4));
    let foreground_output = adb_shell_text(
        &app,
        &device_serial,
        "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1",
        Duration::from_secs(5),
    );
    let selinux = adb_shell_text(&app, &device_serial, "getenforce", Duration::from_secs(3));
    let uptime_output = adb_shell_text(
        &app,
        &device_serial,
        "cat /proc/uptime",
        Duration::from_secs(3),
    );
    let (battery_level, battery_status) = parse_battery_summary(&battery_output);

    Ok(DeviceSummary {
        android_version: prop(0),
        api_level: prop(1),
        build_tags: prop(2),
        verified_boot_state: prop(3),
        vbmeta_device_state: prop(4),
        bootloader_state: parse_bootloader_state(&prop(5)),
        battery_level,
        battery_status,
        display_size: parse_display_size(&display_size_output),
        display_density: parse_display_density(&display_density_output),
        display_physical_size_mm: parse_physical_size_mm(&display_physical_size_output),
        storage: parse_storage_summary(&storage_output),
        foreground_app: parse_foreground_app(&foreground_output),
        security_patch: prop(6),
        selinux,
        uptime: parse_uptime_summary(&uptime_output),
        cpu_abi: prop(7),
        build_fingerprint: prop(8),
    })
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
    let output = connect_address(&app, &address)?;
    if let Some(message) = connect_success_message(&output, &address, false) {
        return Ok(message);
    }

    start_adb_server(&app)?;
    let retry_output = connect_address(&app, &address)?;
    if let Some(message) = connect_success_message(&retry_output, &address, true) {
        return Ok(message);
    }

    Err(connect_failed_error(&retry_output))
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

fn adb_shell_text(app: &AppHandle, adb_serial: &str, command: &str, timeout: Duration) -> String {
    let Ok(output) = adb::run_adb_with_timeout(app, &["shell", command], Some(adb_serial), timeout)
    else {
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
    let addr = endpoint_address(&ip, &port);
    let output = connect_address(&app, &addr)?;

    if let Some(message) = connect_success_message(&output, &addr, false) {
        return Ok(message);
    }

    let _ = adb::run_adb_with_timeout(&app, &["disconnect", &addr], None, Duration::from_secs(5));
    restart_adb_server(&app)?;
    let retry_output = connect_address(&app, &addr)?;
    if let Some(message) = connect_success_message(&retry_output, &addr, true) {
        return Ok(message);
    }

    if let Some(message) = connect_via_mdns_autoconnect(&app, &ip)? {
        return Ok(message);
    }

    // 两种方式都失败，返回原始错误
    let stdout = String::from_utf8_lossy(&retry_output.stdout);
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
pub fn adb_reconnect_endpoint(
    app: AppHandle,
    ip: String,
    port: String,
    restart_adb: bool,
) -> Result<String, AdbError> {
    let addr = endpoint_address(&ip, &port);
    let _ = adb::run_adb_with_timeout(&app, &["disconnect", &addr], None, Duration::from_secs(5));

    if restart_adb {
        restart_adb_server(&app)?;
    }

    let output = connect_address(&app, &addr)?;
    if let Some(message) = connect_success_message(&output, &addr, restart_adb) {
        return Ok(message);
    }

    if let Some(message) = connect_via_mdns_autoconnect(&app, &ip)? {
        return Ok(message);
    }

    Err(connect_failed_error(&output))
}

fn start_adb_server(app: &AppHandle) -> Result<(), AdbError> {
    let output = adb::run_adb_with_timeout(app, &["start-server"], None, Duration::from_secs(8))?;
    adb::ensure_success(&output, &t!("device.adb_start_failed"))?;
    Ok(())
}

fn restart_adb_server(app: &AppHandle) -> Result<(), AdbError> {
    let _ = adb::run_adb_with_timeout(app, &["kill-server"], None, Duration::from_secs(5));
    start_adb_server(app)
}

fn endpoint_address(ip: &str, port: &str) -> String {
    format!("{}:{}", ip.trim(), port.trim())
}

fn connect_address(app: &AppHandle, address: &str) -> Result<std::process::Output, AdbError> {
    adb::run_adb_with_timeout(app, &["connect", address], None, Duration::from_secs(15))
}

fn connect_via_mdns_autoconnect(app: &AppHandle, ip: &str) -> Result<Option<String>, AdbError> {
    // 直接连接失败时，设备的无线调试连接端口可能已经变化。
    let fallback_output = adb::run_adb_with_env_timeout(
        app,
        &["devices", "-l"],
        None,
        &[("ADB_MDNS_AUTO_CONNECT", "adb-tls-connect")],
        Duration::from_secs(15),
    )?;
    let fallback_stdout = String::from_utf8_lossy(&fallback_output.stdout);

    for line in fallback_stdout.lines().skip(1) {
        let line = line.trim();
        if line.contains(ip) && line.contains("device") {
            return Ok(Some(t!("device.connected_via_mdns", ip = ip).to_string()));
        }
    }

    Ok(None)
}

fn connect_success_message(
    output: &std::process::Output,
    address: &str,
    after_restart: bool,
) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("already connected") {
        return Some(t!("device.already_connected", address = address).to_string());
    }
    if stdout.contains("connected") {
        return Some(if after_restart {
            t!("device.connected_after_adb_restart", address = address).to_string()
        } else {
            t!("device.connected_to", address = address).to_string()
        });
    }
    None
}

fn connect_failed_error(output: &std::process::Output) -> AdbError {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let msg = if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };
    AdbError::CommandFailed(t!("device.connect_failed", "message" => msg).into_owned())
}

#[tauri::command(async)]
pub fn adb_disconnect(app: AppHandle, ip: String, port: String) -> Result<String, AdbError> {
    let addr = endpoint_address(&ip, &port);
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

fn local_ipv4_addresses() -> Vec<String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("ipconfig").output()
    } else {
        Command::new("ifconfig").output()
    };

    let Ok(output) = output else {
        return Vec::new();
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_local_ipv4_addresses(&stdout)
}

fn parse_local_ipv4_addresses(stdout: &str) -> Vec<String> {
    let mut addresses = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        let candidate = if let Some(rest) = line.strip_prefix("inet ") {
            rest.split_whitespace().next()
        } else if line.contains("IPv4") {
            line.rsplit_once(':').map(|(_, value)| value.trim())
        } else {
            None
        };

        let Some(candidate) = candidate else {
            continue;
        };
        let candidate = candidate.trim_start_matches("addr:");
        if is_private_ipv4(candidate) && !addresses.iter().any(|item| item == candidate) {
            addresses.push(candidate.to_string());
        }
    }

    addresses
}

fn is_private_ipv4(value: &str) -> bool {
    let parts = value
        .split('.')
        .filter_map(|part| part.parse::<u8>().ok())
        .collect::<Vec<_>>();
    if parts.len() != 4 {
        return false;
    }
    parts[0] == 10
        || (parts[0] == 172 && (16..=31).contains(&parts[1]))
        || (parts[0] == 192 && parts[1] == 168)
}

fn parse_battery_summary(stdout: &str) -> (String, String) {
    let mut level = String::new();
    let mut status = String::new();

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("level:") {
            let value = value.trim();
            if !value.is_empty() {
                level = format!("{value}%");
            }
        } else if let Some(value) = line.strip_prefix("status:") {
            status = match value.trim() {
                "2" => "Charging",
                "3" => "Discharging",
                "4" => "Not charging",
                "5" => "Full",
                _ => "",
            }
            .to_string();
        }
    }

    (level, status)
}

fn parse_display_size(stdout: &str) -> String {
    parse_prefixed_line(stdout, "Physical size:")
        .or_else(|| parse_prefixed_line(stdout, "Override size:"))
        .unwrap_or_default()
}

fn parse_display_density(stdout: &str) -> String {
    let value = parse_prefixed_line(stdout, "Physical density:")
        .or_else(|| parse_prefixed_line(stdout, "Override density:"))
        .unwrap_or_default();
    if value.is_empty() {
        String::new()
    } else if value.ends_with("dpi") {
        value
    } else {
        format!("{value} dpi")
    }
}

fn parse_prefixed_line(stdout: &str, prefix: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        line.trim()
            .strip_prefix(prefix)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn parse_storage_summary(stdout: &str) -> String {
    for line in stdout.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 6 {
            continue;
        }
        let mounted = parts[parts.len() - 1];
        if mounted != "/data" && !mounted.ends_with("/data") {
            continue;
        }

        return format!("{} free / {} total ({} used)", parts[3], parts[1], parts[4]);
    }

    String::new()
}

fn parse_physical_size_mm(stdout: &str) -> String {
    let values = stdout
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .filter_map(|part| part.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect::<Vec<_>>();

    if values.len() < 2 {
        return String::new();
    }

    let width = values[0];
    let height = values[1];
    let longest_edge = width.max(height);
    if longest_edge > 1500.0 {
        return String::new();
    }

    format!("{:.0}x{:.0} mm", width, height)
}

fn parse_foreground_app(stdout: &str) -> String {
    for line in stdout.lines() {
        let line = line.trim();
        if let Some((_, rest)) = line.split_once(" u0 ") {
            return rest
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_end_matches('}')
                .to_string();
        }
    }

    String::new()
}

fn parse_bootloader_state(stdout: &str) -> String {
    match stdout.trim() {
        "1" | "true" => "locked".to_string(),
        "0" | "false" => "unlocked".to_string(),
        value => value.to_string(),
    }
}

fn parse_uptime_summary(stdout: &str) -> String {
    let Some(first) = stdout.split_whitespace().next() else {
        return String::new();
    };
    let Ok(seconds) = first.parse::<f64>() else {
        return String::new();
    };
    let total_minutes = (seconds as u64) / 60;
    let days = total_minutes / 1440;
    let hours = (total_minutes % 1440) / 60;
    let minutes = total_minutes % 60;

    if days > 0 {
        format!("{days}d {hours}h {minutes}m")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
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

    #[test]
    fn trims_endpoint_address_parts() {
        assert_eq!(
            endpoint_address(" 192.168.110.111 ", " 36887 "),
            "192.168.110.111:36887"
        );
    }

    #[test]
    fn parses_local_ipv4_addresses() {
        let output = "\
en0: flags=8863<UP,BROADCAST,RUNNING> mtu 1500
    inet 192.168.1.19 netmask 0xffffff00 broadcast 192.168.1.255
en1: flags=8863<UP,BROADCAST,RUNNING> mtu 1500
    inet 192.168.110.252 netmask 0xffffff00 broadcast 192.168.110.255
Windows IP Configuration
   IPv4 Address. . . . . . . . . . . : 10.0.0.12
";

        let addresses = parse_local_ipv4_addresses(output);

        assert_eq!(
            addresses,
            vec!["192.168.1.19", "192.168.110.252", "10.0.0.12"]
        );
    }

    #[test]
    fn parses_device_status_summary_fields() {
        let battery = "\
Current Battery Service state:
  AC powered: false
  USB powered: true
  status: 2
  level: 84
";
        let storage = "\
Filesystem      Size  Used Avail Use% Mounted on
/dev/block/dm-6 114G   76G   38G  67% /data
";
        let foreground = "mCurrentFocus=Window{abc u0 com.cozyla.launcher/.MainActivity}";

        assert_eq!(
            parse_battery_summary(battery),
            ("84%".to_string(), "Charging".to_string())
        );
        assert_eq!(parse_display_size("Physical size: 1080x1920"), "1080x1920");
        assert_eq!(parse_display_density("Physical density: 420"), "420 dpi");
        assert_eq!(
            parse_storage_summary(storage),
            "38G free / 114G total (67% used)"
        );
        assert_eq!(
            parse_foreground_app(foreground),
            "com.cozyla.launcher/.MainActivity"
        );
        assert_eq!(parse_physical_size_mm("531\n299"), "531x299 mm");
        assert_eq!(parse_physical_size_mm("1920\n1080"), "");
    }

    #[test]
    fn parses_device_integrity_diagnostics() {
        assert_eq!(parse_bootloader_state("1"), "locked");
        assert_eq!(parse_bootloader_state("0"), "unlocked");
        assert_eq!(parse_bootloader_state(""), "");
        assert_eq!(parse_uptime_summary("93784.52 123456.78"), "1d 2h 3m");
    }
}
