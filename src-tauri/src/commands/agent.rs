use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::adb::{self, AdbError};
use crate::commands::performance::PerformanceSample;

const AGENT_PACKAGE: &str = "com.cozyla.adbmanager.agent";
const AGENT_SERVICE: &str = "com.cozyla.adbmanager.agent/.AgentService";
const AGENT_BOOTSTRAP_ACTIVITY: &str = "com.cozyla.adbmanager.agent/.AgentBootstrapActivity";
const AGENT_APK_RESOURCE: &str = "resources/agent/adb-manager-agent.apk";
const AGENT_SOCKET: &str = "localabstract:adb_manager_agent";
const AGENT_PROTOCOL_VERSION: u32 = 2;
const AGENT_BUNDLED_VERSION_NAME: &str = "0.1.4";

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum AgentStatusKind {
    Missing,
    Installing,
    Starting,
    UpdateAvailable,
    Connected,
    PermissionLimited,
    Failed,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentStatusResponse {
    pub device_serial: String,
    pub package_name: String,
    pub status: AgentStatusKind,
    pub installed: bool,
    pub apk_available: bool,
    pub forwarded_port: Option<u16>,
    pub version_name: Option<String>,
    pub bundled_version_name: Option<String>,
    pub protocol_version: Option<u32>,
    pub update_available: bool,
    pub started_at_ms: Option<u128>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentHealth {
    agent_version: Option<String>,
    protocol_version: Option<u32>,
    started_at_ms: Option<u128>,
    permissions: Option<HashMap<String, bool>>,
    status: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct AgentConnection {
    port: u16,
}

#[tauri::command(async)]
pub fn adb_agent_status(
    app: AppHandle,
    device_serial: String,
) -> Result<AgentStatusResponse, AdbError> {
    agent_status(&app, &device_serial)
}

#[tauri::command(async)]
pub fn adb_agent_install(
    app: AppHandle,
    device_serial: String,
) -> Result<AgentStatusResponse, AdbError> {
    let apk_path = agent_apk_path(&app)?;
    let apk_path_string = apk_path.to_string_lossy().to_string();
    let output = adb::run_adb_with_timeout(
        &app,
        &["install", "-r", &apk_path_string],
        Some(&device_serial),
        Duration::from_secs(90),
    )?;
    if !output.status.success() {
        if agent_install_requires_manual_data_migration(&output) {
            return Ok(agent_failed_status(
                &app,
                &device_serial,
                "Bundled Agent APK cannot update the installed Agent without uninstalling it. App data was preserved; uninstall manually only after backing up or accepting data loss.",
            ));
        }
        adb::ensure_success(&output, "install ADB Manager Agent")?;
    }
    let mut status = agent_status(&app, &device_serial)?;
    status.status = AgentStatusKind::Starting;
    status.update_available = false;
    status.message = Some("Agent installed or updated with app data preserved".to_string());
    Ok(status)
}

#[tauri::command(async)]
pub fn adb_agent_start(
    app: AppHandle,
    device_serial: String,
) -> Result<AgentStatusResponse, AdbError> {
    grant_agent_usage_stats(&app, &device_serial);

    let bootstrap_output = adb::run_adb_with_timeout(
        &app,
        &["shell", "am", "start", "-n", AGENT_BOOTSTRAP_ACTIVITY],
        Some(&device_serial),
        Duration::from_secs(10),
    );

    match bootstrap_output {
        Ok(output) if output.status.success() => {}
        _ => {
            let foreground_output = adb::run_adb_with_timeout(
                &app,
                &[
                    "shell",
                    "am",
                    "start-foreground-service",
                    "-n",
                    AGENT_SERVICE,
                ],
                Some(&device_serial),
                Duration::from_secs(10),
            );

            match foreground_output {
                Ok(output) if output.status.success() => {}
                _ => {
                    let output = adb::run_adb_with_timeout(
                        &app,
                        &["shell", "am", "startservice", "-n", AGENT_SERVICE],
                        Some(&device_serial),
                        Duration::from_secs(10),
                    )?;
                    adb::ensure_success(&output, "start ADB Manager Agent")?;
                }
            }
        }
    }

    let mut status = agent_status(&app, &device_serial)?;
    status.status = AgentStatusKind::Starting;
    status.message = Some("Agent start requested".to_string());
    Ok(status)
}

#[tauri::command(async)]
pub fn adb_agent_connect(
    app: AppHandle,
    device_serial: String,
) -> Result<AgentStatusResponse, AdbError> {
    if let Some(existing) = agent_connection(&device_serial) {
        if let Ok(health) = read_agent_health(existing.port) {
            let installed_version_name = installed_agent_version_name(&app, &device_serial)
                .ok()
                .flatten();
            return Ok(status_from_health(
                &app,
                &device_serial,
                true,
                Some(existing.port),
                installed_version_name,
                health,
            ));
        }
    }

    let output = adb::run_adb_with_timeout(
        &app,
        &["forward", "tcp:0", AGENT_SOCKET],
        Some(&device_serial),
        Duration::from_secs(10),
    )?;
    adb::ensure_success(&output, "forward ADB Manager Agent socket")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let port = parse_forward_port(&stdout).ok_or_else(|| {
        AdbError::CommandFailed(format!(
            "could not parse Agent forward port from adb output: {}",
            stdout.trim()
        ))
    })?;
    set_agent_connection(&device_serial, port);

    match read_agent_health_with_retry(port, Duration::from_secs(3)) {
        Ok(health) => {
            let installed_version_name = installed_agent_version_name(&app, &device_serial)
                .ok()
                .flatten();
            Ok(status_from_health(
                &app,
                &device_serial,
                true,
                Some(port),
                installed_version_name,
                health,
            ))
        }
        Err(error) => {
            let mut status = agent_status(&app, &device_serial)?;
            status.status = AgentStatusKind::Failed;
            status.forwarded_port = Some(port);
            status.message = Some(error);
            Ok(status)
        }
    }
}

#[tauri::command(async)]
pub fn adb_agent_stop(
    app: AppHandle,
    device_serial: String,
) -> Result<AgentStatusResponse, AdbError> {
    if let Some(connection) = remove_agent_connection(&device_serial) {
        let _ = http_request(
            connection.port,
            "POST",
            "/stop",
            Some("{}"),
            Duration::from_secs(1),
        );
        let forward = format!("tcp:{}", connection.port);
        let _ = adb::run_adb_with_timeout(
            &app,
            &["forward", "--remove", &forward],
            Some(&device_serial),
            Duration::from_secs(5),
        );
    }

    let _ = adb::run_adb_with_timeout(
        &app,
        &["shell", "am", "force-stop", AGENT_PACKAGE],
        Some(&device_serial),
        Duration::from_secs(5),
    );

    let mut status = agent_status(&app, &device_serial)?;
    status.message = Some("Agent stopped".to_string());
    Ok(status)
}

#[tauri::command(async)]
pub fn adb_agent_sample(
    app: AppHandle,
    device_serial: String,
    target_package: Option<String>,
    interval_ms: u64,
) -> Result<PerformanceSample, AdbError> {
    if agent_connection(&device_serial).is_none() {
        let status = adb_agent_connect(app.clone(), device_serial.clone())?;
        if !matches!(
            status.status,
            AgentStatusKind::Connected | AgentStatusKind::PermissionLimited
        ) {
            return Err(AdbError::CommandFailed(
                status
                    .message
                    .unwrap_or_else(|| "Agent is not connected".to_string()),
            ));
        }
    }
    let connection = agent_connection(&device_serial)
        .ok_or_else(|| AdbError::CommandFailed("Agent forward is not active".to_string()))?;
    let body = serde_json::json!({
        "target_package": target_package,
        "interval_ms": interval_ms,
    })
    .to_string();
    http_request(
        connection.port,
        "POST",
        "/target",
        Some(&body),
        Duration::from_secs(2),
    )
    .map_err(AdbError::CommandFailed)?;
    let line = read_agent_sample_line(connection.port, Duration::from_secs(3))
        .map_err(AdbError::CommandFailed)?;
    parse_agent_sample(&device_serial, &line).map_err(AdbError::CommandFailed)
}

fn agent_status(app: &AppHandle, device_serial: &str) -> Result<AgentStatusResponse, AdbError> {
    let apk_available = agent_apk_path(app).is_ok();
    let installed = is_agent_installed(app, device_serial)?;
    let installed_version_name = if installed {
        installed_agent_version_name(app, device_serial)
            .ok()
            .flatten()
    } else {
        None
    };
    let forwarded_port = agent_connection(device_serial).map(|connection| connection.port);
    if let Some(port) = forwarded_port {
        if let Ok(health) = read_agent_health(port) {
            return Ok(status_from_health(
                app,
                device_serial,
                installed,
                Some(port),
                installed_version_name,
                health,
            ));
        }
    }

    let update_available = agent_update_available(
        apk_available,
        installed,
        installed_version_name.as_deref(),
        None,
    );

    Ok(AgentStatusResponse {
        device_serial: device_serial.to_string(),
        package_name: AGENT_PACKAGE.to_string(),
        status: if update_available {
            AgentStatusKind::UpdateAvailable
        } else if installed {
            AgentStatusKind::Starting
        } else {
            AgentStatusKind::Missing
        },
        installed,
        apk_available,
        forwarded_port,
        version_name: installed_version_name,
        bundled_version_name: apk_available.then(|| AGENT_BUNDLED_VERSION_NAME.to_string()),
        protocol_version: None,
        update_available,
        started_at_ms: None,
        message: if update_available {
            Some("Bundled Agent APK differs from the installed Agent; enabling Agent will update it with app data preserved.".to_string())
        } else if apk_available {
            None
        } else {
            Some("Agent APK is not bundled with this build".to_string())
        },
    })
}

fn status_from_health(
    app: &AppHandle,
    device_serial: &str,
    installed: bool,
    forwarded_port: Option<u16>,
    installed_version_name: Option<String>,
    health: AgentHealth,
) -> AgentStatusResponse {
    let apk_available = agent_apk_path(app).is_ok();
    let protocol_version = health.protocol_version;
    let version_name = health.agent_version.or(installed_version_name);
    let update_available = agent_update_available(
        apk_available,
        installed,
        version_name.as_deref(),
        protocol_version,
    );
    let status = if update_available {
        AgentStatusKind::UpdateAvailable
    } else if protocol_version != Some(AGENT_PROTOCOL_VERSION) {
        AgentStatusKind::Failed
    } else if health.status.as_deref() == Some("permission_limited")
        || health
            .permissions
            .as_ref()
            .is_some_and(|permissions| permissions.values().any(|allowed| !*allowed))
    {
        AgentStatusKind::PermissionLimited
    } else {
        AgentStatusKind::Connected
    };

    AgentStatusResponse {
        device_serial: device_serial.to_string(),
        package_name: AGENT_PACKAGE.to_string(),
        status,
        installed,
        apk_available,
        forwarded_port,
        version_name,
        bundled_version_name: apk_available.then(|| AGENT_BUNDLED_VERSION_NAME.to_string()),
        protocol_version,
        update_available,
        started_at_ms: health.started_at_ms,
        message: if update_available {
            Some("Bundled Agent APK differs from the running Agent; enabling Agent will update it with app data preserved.".to_string())
        } else {
            health.message
        },
    }
}

fn agent_apk_path(app: &AppHandle) -> Result<PathBuf, AdbError> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        AdbError::CommandFailed(format!("read app resource directory: {error}"))
    })?;
    let resource_path = resource_dir.join(AGENT_APK_RESOURCE);
    if resource_path.exists() {
        return Ok(resource_path);
    }

    #[cfg(debug_assertions)]
    {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(AGENT_APK_RESOURCE);
        if manifest_path.exists() {
            return Ok(manifest_path);
        }
    }

    Err(AdbError::CommandFailed(format!(
        "Agent APK missing at {AGENT_APK_RESOURCE}"
    )))
}

fn is_agent_installed(app: &AppHandle, device_serial: &str) -> Result<bool, AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &["shell", "pm", "path", AGENT_PACKAGE],
        Some(device_serial),
        Duration::from_secs(5),
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(output.status.success() && stdout.contains(AGENT_PACKAGE))
}

fn installed_agent_version_name(
    app: &AppHandle,
    device_serial: &str,
) -> Result<Option<String>, AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &["shell", "dumpsys", "package", AGENT_PACKAGE],
        Some(device_serial),
        Duration::from_secs(5),
    )?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(parse_package_version_name(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_package_version_name(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("versionName=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn agent_update_available(
    apk_available: bool,
    installed: bool,
    installed_version_name: Option<&str>,
    protocol_version: Option<u32>,
) -> bool {
    apk_available
        && installed
        && (installed_version_name != Some(AGENT_BUNDLED_VERSION_NAME)
            || protocol_version.is_some_and(|version| version != AGENT_PROTOCOL_VERSION))
}

fn agent_failed_status(app: &AppHandle, device_serial: &str, message: &str) -> AgentStatusResponse {
    AgentStatusResponse {
        device_serial: device_serial.to_string(),
        package_name: AGENT_PACKAGE.to_string(),
        status: AgentStatusKind::Failed,
        installed: true,
        apk_available: agent_apk_path(app).is_ok(),
        forwarded_port: agent_connection(device_serial).map(|connection| connection.port),
        version_name: None,
        bundled_version_name: Some(AGENT_BUNDLED_VERSION_NAME.to_string()),
        protocol_version: None,
        update_available: true,
        started_at_ms: None,
        message: Some(message.to_string()),
    }
}

fn grant_agent_usage_stats(app: &AppHandle, device_serial: &str) {
    let _ = adb::run_adb_with_timeout(
        app,
        &[
            "shell",
            "appops",
            "set",
            AGENT_PACKAGE,
            "GET_USAGE_STATS",
            "allow",
        ],
        Some(device_serial),
        Duration::from_secs(5),
    );
}

fn agent_install_requires_manual_data_migration(output: &std::process::Output) -> bool {
    agent_install_text_requires_manual_data_migration(&adb_output_text(output))
}

fn agent_install_text_requires_manual_data_migration(output_text: &str) -> bool {
    let text = output_text.to_ascii_lowercase();
    text.contains("install_failed_update_incompatible")
        || text.contains("install_failed_version_downgrade")
        || text.contains("signatures do not match")
        || text.contains("inconsistent_certificates")
        || text.contains("inconsistent certificates")
}

fn adb_output_text(output: &std::process::Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn read_agent_health(port: u16) -> Result<AgentHealth, String> {
    let response = http_request(port, "GET", "/health", None, Duration::from_secs(2))?;
    let (status_code, body) = split_http_response(&response)?;
    if status_code != 200 {
        return Err(format!("Agent health HTTP {status_code}"));
    }
    serde_json::from_str::<AgentHealth>(&body)
        .map_err(|error| format!("Agent health JSON parse failed: {error}"))
}

fn read_agent_health_with_retry(port: u16, timeout: Duration) -> Result<AgentHealth, String> {
    let started = std::time::Instant::now();
    loop {
        match read_agent_health(port) {
            Ok(health) => return Ok(health),
            Err(error) => {
                if started.elapsed() >= timeout {
                    return Err(error);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

fn read_agent_sample_line(port: u16, timeout: Duration) -> Result<String, String> {
    use std::io::BufRead;

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream =
        TcpStream::connect_timeout(&address, timeout).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    let request = format!(
        "GET /samples/stream HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;

    let mut reader = std::io::BufReader::new(stream);
    let mut status = String::new();
    reader
        .read_line(&mut status)
        .map_err(|error| error.to_string())?;
    if !status.contains(" 200 ") {
        return Err(format!("Agent sample HTTP status: {}", status.trim()));
    }
    loop {
        let mut header = String::new();
        reader
            .read_line(&mut header)
            .map_err(|error| error.to_string())?;
        if header == "\r\n" || header.is_empty() {
            break;
        }
    }
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err("Agent sample stream did not return a sample".to_string());
    }
    Ok(trimmed.to_string())
}

fn parse_agent_sample(device_serial: &str, line: &str) -> Result<PerformanceSample, String> {
    let value = serde_json::from_str::<serde_json::Value>(line)
        .map_err(|error| format!("Agent sample JSON parse failed: {error}"))?;
    Ok(PerformanceSample {
        timestamp_ms: value_u128(&value, "timestamp_ms").unwrap_or_else(now_ms),
        device_serial: device_serial.to_string(),
        sample_source: "agent".to_string(),
        agent_status: value_str(&value, "agent_status").or_else(|| Some("connected".to_string())),
        target_package: value_str(&value, "target_package"),
        foreground_package: value_str(&value, "foreground_package"),
        foreground_activity: value_str(&value, "foreground_activity"),
        unavailable: value
            .get("unavailable")
            .and_then(|item| item.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        ..PerformanceSample::default()
    })
}

fn value_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(ToString::to_string)
        .filter(|item| !item.is_empty())
}

fn value_u128(value: &serde_json::Value, key: &str) -> Option<u128> {
    value
        .get(key)
        .and_then(|item| item.as_u64())
        .map(u128::from)
}

fn http_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
) -> Result<String, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream =
        TcpStream::connect_timeout(&address, timeout).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    Ok(response)
}

pub(crate) fn agent_ui_request(
    device_serial: &str,
    path: &str,
    body: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(port) = agent_connection(device_serial).map(|connection| connection.port) else {
        return Ok(None);
    };
    let Ok(response) = http_request(port, "POST", path, body, Duration::from_secs(3)) else {
        return Ok(None);
    };
    let Ok((status_code, body)) = split_http_response(&response) else {
        return Ok(None);
    };
    if status_code != 200 {
        return Ok(None);
    }
    let value = serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|error| format!("Agent UI JSON parse failed: {error}"))?;
    if value.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        return Ok(Some(value));
    }
    let message = value
        .get("error")
        .or_else(|| value.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or("Agent accessibility action was rejected")
        .to_string();
    if message.contains("not enabled") || message.contains("No active accessibility window") {
        return Ok(None);
    }
    Err(message)
}

fn split_http_response(response: &str) -> Result<(u16, String), String> {
    let mut parts = response.splitn(2, "\r\n\r\n");
    let headers = parts.next().unwrap_or_default();
    let body = parts.next().unwrap_or_default().to_string();
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "Agent HTTP response did not include a status code".to_string())?;
    Ok((status_code, body))
}

fn parse_forward_port(stdout: &str) -> Option<u16> {
    stdout
        .split(|ch: char| !ch.is_ascii_digit())
        .find_map(|part| part.parse::<u16>().ok().filter(|port| *port > 0))
}

fn agent_registry() -> &'static Mutex<HashMap<String, AgentConnection>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, AgentConnection>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn agent_connection(device_serial: &str) -> Option<AgentConnection> {
    agent_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.get(device_serial).cloned())
}

fn set_agent_connection(device_serial: &str, port: u16) {
    if let Ok(mut registry) = agent_registry().lock() {
        registry.insert(device_serial.to_string(), AgentConnection { port });
    }
}

fn remove_agent_connection(device_serial: &str) -> Option<AgentConnection> {
    agent_registry()
        .lock()
        .ok()
        .and_then(|mut registry| registry.remove(device_serial))
}

#[allow(dead_code)]
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_allocated_forward_ports() {
        assert_eq!(parse_forward_port("55731\n"), Some(55731));
        assert_eq!(parse_forward_port("tcp:42424\r\n"), Some(42424));
        assert_eq!(parse_forward_port(""), None);
    }

    #[test]
    fn parses_simple_http_responses() {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        let parsed = split_http_response(response).unwrap();

        assert_eq!(parsed.0, 200);
        assert_eq!(parsed.1, "{\"ok\":true}");
    }

    #[test]
    fn detects_agent_install_errors_that_need_manual_data_migration() {
        assert!(agent_install_text_requires_manual_data_migration(
            "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match]"
        ));
        assert!(agent_install_text_requires_manual_data_migration(
            "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"
        ));
        assert!(agent_install_text_requires_manual_data_migration(
            "Failure [INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES]"
        ));
        assert!(!agent_install_text_requires_manual_data_migration(
            "Failure [INSTALL_FAILED_USER_RESTRICTED]"
        ));
    }

    #[test]
    fn detects_agent_update_when_installed_version_or_protocol_differs() {
        assert!(!agent_update_available(
            true,
            true,
            Some(AGENT_BUNDLED_VERSION_NAME),
            Some(AGENT_PROTOCOL_VERSION)
        ));
        assert!(agent_update_available(
            true,
            true,
            Some("0.0.9"),
            Some(AGENT_PROTOCOL_VERSION)
        ));
        assert!(agent_update_available(
            true,
            true,
            Some(AGENT_BUNDLED_VERSION_NAME),
            Some(AGENT_PROTOCOL_VERSION + 1)
        ));
        assert!(!agent_update_available(
            false,
            true,
            Some("0.0.9"),
            Some(AGENT_PROTOCOL_VERSION)
        ));
    }

    #[test]
    fn parses_agent_package_version_name() {
        assert_eq!(
            parse_package_version_name("Packages:\n  versionCode=1\n  versionName=0.1.0\n"),
            Some("0.1.0".to_string())
        );
        assert_eq!(
            parse_package_version_name("Packages:\n  noVersion=true\n"),
            None
        );
    }

    #[test]
    fn bundled_agent_versions_are_aligned() {
        let service = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../agent-android/src/main/java/com/cozyla/adbmanager/agent/AgentService.java"
        ));
        let build_script = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../agent-android/build-agent-apk.sh"
        ));

        assert!(service.contains(&format!(
            "AGENT_VERSION = \"{}\"",
            AGENT_BUNDLED_VERSION_NAME
        )));
        assert!(build_script.contains(&format!("--version-name {}", AGENT_BUNDLED_VERSION_NAME)));
    }

    #[test]
    fn keeps_installing_status_in_the_public_agent_contract() {
        assert_eq!(AgentStatusKind::Installing, AgentStatusKind::Installing);
    }

    #[test]
    fn parses_agent_ndjson_as_context_without_trusting_legacy_metrics() {
        let sample = parse_agent_sample(
            "USB123",
            r#"{"timestamp_ms":1200,"sample_source":"agent","agent_status":"permission_limited","target_package":"com.example.game","foreground_package":"com.example.game","pid":42,"process":{"package_name":"com.example.game","pid":42,"rss_kb":22000,"pss_kb":20000,"thread_count":12,"running":true},"network":{"rx_bytes":100,"tx_bytes":200},"unavailable":["ordinary APK cannot read system GPU counters"]}"#,
        )
        .unwrap();

        assert_eq!(sample.device_serial, "USB123");
        assert_eq!(sample.sample_source, "agent");
        assert_eq!(sample.agent_status.as_deref(), Some("permission_limited"));
        assert_eq!(sample.target_package.as_deref(), Some("com.example.game"));
        assert_eq!(sample.pid, None);
        assert_eq!(sample.process.rss_kb, None);
        assert_eq!(sample.process.pss_kb, None);
        assert_eq!(sample.process.thread_count, None);
        assert_eq!(sample.network.rx_bytes, None);
        assert_eq!(
            sample.unavailable,
            vec!["ordinary APK cannot read system GPU counters".to_string()]
        );
    }
}
