use rust_i18n::t;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::File;
#[cfg(target_os = "windows")]
use std::io::Write;
use std::io::{BufRead, Read};
#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[cfg(target_os = "windows")]
const SCRCPY_RELEASE_API: &str = "https://api.github.com/repos/Genymobile/scrcpy/releases/latest";
const RESOURCE_TYPE_STRING_POOL: u16 = 0x0001;
const RESOURCE_TYPE_TABLE: u16 = 0x0002;
const RESOURCE_TYPE_TABLE_PACKAGE: u16 = 0x0200;
const RESOURCE_TYPE_TABLE_TYPE: u16 = 0x0201;
const RESOURCE_TYPE_XML_RESOURCE_MAP: u16 = 0x0180;
const RESOURCE_TYPE_XML_START_ELEMENT: u16 = 0x0102;
const VALUE_TYPE_REFERENCE: u8 = 0x01;
const VALUE_TYPE_STRING: u8 = 0x03;
const VALUE_TYPE_INT_DEC: u8 = 0x10;
const VALUE_TYPE_INT_HEX: u8 = 0x11;
const NO_ENTRY: u32 = 0xffff_ffff;
const MAX_ICON_BYTES: u64 = 512 * 1024;
const ICON_CACHE_VERSION: u8 = 2;
const ICON_CACHE_VERIFY_AFTER_SECS: i64 = 24 * 60 * 60;
const ICON_CACHE_REBUILD_AFTER_SECS: i64 = 7 * 24 * 60 * 60;
const MAX_ICON_XML_DEPTH: usize = 4;

struct InstallGuard<'a>(&'a Mutex<bool>);
static APP_ICON_CACHE: OnceLock<Mutex<HashMap<String, CachedLaunchableAppAsset>>> = OnceLock::new();

#[derive(Serialize)]
pub struct ScreenMirrorState {
    running: bool,
    device_serial: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct LaunchableApp {
    package_name: String,
    activity_name: String,
    component_name: String,
    label: String,
    icon_data_url: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct LaunchableAppAsset {
    package_name: String,
    activity_name: String,
    label: Option<String>,
    icon_data_url: Option<String>,
    cache_stale: bool,
}

#[derive(Debug, Clone)]
struct CachedLaunchableAppAsset {
    label: Option<String>,
    icon_data_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersistentLaunchableAppIconCacheEntry {
    version: u8,
    remote_path: String,
    label: Option<String>,
    icon_data_url: Option<String>,
    cached_at_unix: i64,
    verified_at_unix: i64,
    failed: bool,
}

#[derive(Debug, Clone)]
struct PersistentLaunchableAppIconCacheHit {
    entry: PersistentLaunchableAppIconCacheEntry,
    cache_stale: bool,
}

#[derive(Debug, Clone, Default)]
struct ManifestLaunchMetadata {
    app_label: Option<ManifestValue>,
    app_icon: Option<u32>,
    app_round_icon: Option<u32>,
    activities: HashMap<String, ManifestActivityMetadata>,
}

#[derive(Debug, Clone, Default)]
struct ManifestActivityMetadata {
    label: Option<ManifestValue>,
    icon: Option<u32>,
    round_icon: Option<u32>,
}

#[derive(Debug, Clone)]
enum ManifestValue {
    Text(String),
    Resource(u32),
}

#[derive(Debug, Clone)]
struct ResourceTable {
    values: HashMap<u32, Vec<ResourceValue>>,
}

#[derive(Debug, Clone)]
struct ResourceValue {
    data_type: u8,
    data: u32,
    text: Option<String>,
}

#[derive(Debug)]
struct ZipIconCandidate {
    path: String,
    score: i32,
    size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct IconXmlResourceRef {
    resource_id: u32,
    priority: i32,
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut installing) = self.0.lock() {
            *installing = false;
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command(async)]
pub fn check_scrcpy_available(app: AppHandle) -> Result<bool, AdbError> {
    Ok(get_scrcpy_path(&app).is_some())
}

#[tauri::command(async)]
pub fn get_screen_mirror_state(state: State<'_, AppState>) -> Result<ScreenMirrorState, AdbError> {
    current_screen_mirror_state(&state)
}

#[tauri::command]
pub async fn install_scrcpy(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AdbError> {
    let _guard = acquire_install_lock(&state.scrcpy_installing)?;

    if get_scrcpy_path(&app).is_some() {
        emit_install_progress(&app, &t!("mirror.scrcpy_installed"));
        return Ok(t!("mirror.scrcpy_installed").to_string());
    }

    emit_install_progress(&app, &t!("mirror.preparing_install"));

    #[cfg(target_os = "macos")]
    {
        install_scrcpy_macos(&app)?;
    }

    #[cfg(target_os = "windows")]
    {
        install_scrcpy_windows(&app).await?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Err(AdbError::CommandFailed(
            t!("mirror.os_not_supported").into_owned(),
        ));
    }

    if get_scrcpy_path(&app).is_some() {
        emit_install_progress(&app, &t!("mirror.install_success"));
        Ok(t!("mirror.install_success").to_string())
    } else {
        Err(AdbError::CommandFailed(
            t!("mirror.not_found_after_install").into_owned(),
        ))
    }
}

#[tauri::command(async)]
pub fn start_screen_mirror(
    app: AppHandle,
    state: State<'_, AppState>,
    device_serial: Option<String>,
    audio_enabled: Option<bool>,
) -> Result<String, AdbError> {
    let device_serial = device_serial
        .map(|serial| serial.trim().to_string())
        .filter(|serial| !serial.is_empty())
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.select_device").into_owned()))?;

    verify_device_online(&app, &device_serial)?;

    {
        let mut process = state
            .scrcpy_process
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?;
        if let Some(child) = process.as_mut() {
            if child.try_wait()?.is_none() {
                return Ok(t!("mirror.already_running").to_string());
            }
            *process = None;
            if let Ok(mut active_device) = state.scrcpy_device.lock() {
                *active_device = None;
            }
        }
    }

    let scrcpy_path = get_scrcpy_path(&app)
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.scrcpy_not_found").into_owned()))?;
    let adb_path = adb::get_adb_path(&app)?;

    let mut command = Command::new(&scrcpy_path);
    command.args(["-s", &device_serial]);
    if !audio_enabled.unwrap_or(false) {
        command.arg("--no-audio");
    }
    command
        .arg("--window-title")
        .arg("ADB Manager - Screen Mirror")
        .env("ADB", &adb_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // If using bundled scrcpy, point it to the bundled scrcpy-server
    if let Some(server_path) = get_bundled_scrcpy_server_path(&app) {
        command.env("SCRCPY_SERVER_PATH", server_path);
    }

    if let Some(path_env) = scrcpy_path_env(&adb_path) {
        command.env("PATH", path_env);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn()?;
    let output = capture_process_output(&mut child);
    if let Some(status) = wait_for_early_exit(&mut child, Duration::from_millis(900))? {
        return Err(scrcpy_exit_error(status, &output));
    }

    {
        let mut process = state
            .scrcpy_process
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?;
        *process = Some(child);
    }
    {
        let mut active_device = state
            .scrcpy_device
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?;
        *active_device = Some(device_serial);
    }

    Ok(t!("mirror.opened").to_string())
}

#[tauri::command(async)]
pub fn stop_screen_mirror(state: State<'_, AppState>) -> Result<String, AdbError> {
    let mut process = state
        .scrcpy_process
        .lock()
        .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?;

    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(mut active_device) = state.scrcpy_device.lock() {
            *active_device = None;
        }
        Ok(t!("mirror.closed").to_string())
    } else {
        Ok(t!("mirror.not_running").to_string())
    }
}

#[tauri::command(async)]
pub fn send_navigation_key(
    app: AppHandle,
    device_serial: Option<String>,
    key: String,
) -> Result<String, AdbError> {
    let device_serial = required_device_serial(device_serial)?;

    let (keycode, label) = match key.as_str() {
        "back" => ("KEYCODE_BACK", t!("mirror.back").to_string()),
        "home" => ("KEYCODE_HOME", "Home".to_string()),
        _ => {
            return Err(AdbError::CommandFailed(
                t!("mirror.unsupported_key").into_owned(),
            ));
        }
    };

    let output = adb::run_adb_with_timeout(
        &app,
        &["shell", "input", "keyevent", keycode],
        Some(&device_serial),
        Duration::from_secs(4),
    )?;
    adb::ensure_success(&output, &t!("mirror.send_key_failed"))?;
    Ok(t!("mirror.key_sent", label = label).to_string())
}

#[tauri::command(async)]
pub fn adb_list_launchable_apps(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<LaunchableApp>, AdbError> {
    let device_serial = required_device_serial(device_serial)?;
    let args = [
        "shell",
        "cmd",
        "package",
        "query-activities",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
    ];
    let output =
        adb::run_adb_with_timeout(&app, &args, Some(&device_serial), Duration::from_secs(15))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let apps = parse_launchable_apps(&stdout);
        if !apps.is_empty() {
            return Ok(apps);
        }
    }

    let fallback_args = [
        "shell",
        "cmd",
        "package",
        "query-activities",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
    ];
    let fallback = adb::run_adb_with_timeout(
        &app,
        &fallback_args,
        Some(&device_serial),
        Duration::from_secs(15),
    )?;
    adb::ensure_success(&fallback, &t!("mirror.list_apps_failed"))?;

    let stdout = String::from_utf8_lossy(&fallback.stdout);
    Ok(parse_launchable_apps(&stdout))
}

#[tauri::command(async)]
pub fn adb_launch_app(
    app: AppHandle,
    device_serial: Option<String>,
    component_name: String,
) -> Result<String, AdbError> {
    let device_serial = required_device_serial(device_serial)?;
    let launchable_app = normalize_launchable_component(&component_name)
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.invalid_app_component").into_owned()))?;

    let output = adb::run_adb_with_timeout(
        &app,
        &["shell", "am", "start", "-n", &launchable_app.component_name],
        Some(&device_serial),
        Duration::from_secs(10),
    )?;
    adb::ensure_success(&output, &t!("mirror.launch_app_failed"))?;

    let combined_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if combined_output
        .lines()
        .any(|line| line.trim_start().starts_with("Error:") || line.contains("Exception"))
    {
        return Err(AdbError::CommandFailed(
            t!(
                "mirror.launch_app_failed_detail",
                "message" => combined_output.trim()
            )
            .into_owned(),
        ));
    }

    Ok(t!("mirror.app_launched", "label" => launchable_app.label).to_string())
}

#[tauri::command(async)]
pub fn adb_load_launchable_app_icon(
    app: AppHandle,
    device_serial: Option<String>,
    package_name: String,
    activity_name: String,
    force_refresh: Option<bool>,
) -> Result<LaunchableAppAsset, AdbError> {
    let device_serial = required_device_serial(device_serial)?;
    let package_name = package_name.trim().to_string();
    let force_refresh = force_refresh.unwrap_or(false);
    if !valid_package_name(&package_name) {
        return Err(AdbError::CommandFailed(
            t!("mirror.invalid_app_component").into_owned(),
        ));
    }
    let activity_name = normalize_activity_name(&package_name, &activity_name)
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.invalid_app_component").into_owned()))?;
    let component_name = format!("{}/{}", package_name, activity_name);
    let persistent_cache_id =
        persistent_icon_cache_id(&device_serial, &package_name, &activity_name);

    if !force_refresh {
        if let Some(cache_hit) = read_persistent_launchable_app_asset(&app, &persistent_cache_id) {
            return Ok(LaunchableAppAsset {
                package_name,
                activity_name,
                label: cache_hit.entry.label,
                icon_data_url: cache_hit.entry.icon_data_url,
                cache_stale: cache_hit.cache_stale,
            });
        }
    }

    let existing_cache = read_persistent_launchable_app_asset(&app, &persistent_cache_id);
    let remote_path = match query_package_apk_path(&app, &device_serial, &package_name) {
        Ok(path) => path,
        Err(error) => {
            if let Some(cache_hit) = existing_cache {
                return Ok(LaunchableAppAsset {
                    package_name,
                    activity_name,
                    label: cache_hit.entry.label,
                    icon_data_url: cache_hit.entry.icon_data_url,
                    cache_stale: false,
                });
            }
            return Err(error);
        }
    };
    let cache_key = app_icon_cache_key(&device_serial, &component_name, &remote_path);

    if !force_refresh {
        if let Some(asset) = cached_launchable_app_asset(&cache_key) {
            return Ok(LaunchableAppAsset {
                package_name,
                activity_name,
                label: asset.label,
                icon_data_url: asset.icon_data_url,
                cache_stale: false,
            });
        }
    }

    if let Some(cache_hit) = existing_cache.as_ref() {
        if !should_rebuild_persistent_icon_cache(&cache_hit.entry, &remote_path) {
            let mut entry = cache_hit.entry.clone();
            entry.verified_at_unix = now_unix_seconds();
            let _ = write_persistent_launchable_app_asset(&app, &persistent_cache_id, &entry);
            let asset = CachedLaunchableAppAsset {
                label: entry.label.clone(),
                icon_data_url: entry.icon_data_url.clone(),
            };
            cache_launchable_app_asset(cache_key, asset.clone());
            return Ok(LaunchableAppAsset {
                package_name,
                activity_name,
                label: asset.label,
                icon_data_url: asset.icon_data_url,
                cache_stale: false,
            });
        }
    }

    if let Some(asset) = cached_launchable_app_asset(&cache_key) {
        let entry = persistent_cache_entry(&remote_path, &asset);
        let _ = write_persistent_launchable_app_asset(&app, &persistent_cache_id, &entry);
        return Ok(LaunchableAppAsset {
            package_name,
            activity_name,
            label: asset.label,
            icon_data_url: asset.icon_data_url,
            cache_stale: false,
        });
    }

    let temp_dir = std::env::temp_dir().join(format!(
        "adb-manager-app-icon-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    std::fs::create_dir_all(&temp_dir)?;
    let local_path = temp_dir.join(format!("{}.apk", safe_icon_cache_filename(&package_name)));

    let asset = if pull_package_apk(&app, &device_serial, &remote_path, &local_path).is_ok() {
        extract_launchable_app_asset_from_apk(&local_path, &package_name, &activity_name).unwrap_or(
            CachedLaunchableAppAsset {
                label: None,
                icon_data_url: None,
            },
        )
    } else {
        CachedLaunchableAppAsset {
            label: None,
            icon_data_url: None,
        }
    };
    let _ = std::fs::remove_dir_all(temp_dir);
    cache_launchable_app_asset(cache_key, asset.clone());
    let entry = persistent_cache_entry(&remote_path, &asset);
    let _ = write_persistent_launchable_app_asset(&app, &persistent_cache_id, &entry);

    Ok(LaunchableAppAsset {
        package_name,
        activity_name,
        label: asset.label,
        icon_data_url: asset.icon_data_url,
        cache_stale: false,
    })
}

fn current_screen_mirror_state(state: &State<'_, AppState>) -> Result<ScreenMirrorState, AdbError> {
    let mut process = state
        .scrcpy_process
        .lock()
        .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?;

    if let Some(child) = process.as_mut() {
        if child.try_wait()?.is_none() {
            let device_serial = state
                .scrcpy_device
                .lock()
                .map_err(|_| AdbError::CommandFailed(t!("mirror.state_error").into_owned()))?
                .clone();
            return Ok(ScreenMirrorState {
                running: true,
                device_serial,
            });
        }
        *process = None;
    }

    if let Ok(mut active_device) = state.scrcpy_device.lock() {
        *active_device = None;
    }
    Ok(ScreenMirrorState {
        running: false,
        device_serial: None,
    })
}

fn get_bundled_scrcpy_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;

    let relative = if cfg!(target_os = "windows") {
        "resources/scrcpy/windows/scrcpy.exe"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "x86_64") {
            "resources/scrcpy/macos-x86_64/scrcpy"
        } else if cfg!(target_arch = "aarch64") {
            "resources/scrcpy/macos-aarch64/scrcpy"
        } else {
            return None;
        }
    } else {
        return None;
    };

    let path = resource_dir.join(relative);
    path.exists().then_some(path)
}

fn get_bundled_scrcpy_server_path(app: &AppHandle) -> Option<PathBuf> {
    get_bundled_scrcpy_path(app)?
        .parent()?
        .join("scrcpy-server")
        .canonicalize()
        .ok()
}

fn get_scrcpy_path(app: &AppHandle) -> Option<PathBuf> {
    // Prefer bundled scrcpy (shipped inside the app)
    if let Some(bundled) = get_bundled_scrcpy_path(app) {
        return Some(bundled);
    }

    // Fall back to system-installed scrcpy
    if let Ok(path) = which::which("scrcpy") {
        return Some(path);
    }

    let candidates = if cfg!(target_os = "windows") {
        vec![
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(PathBuf::from)
                .map(|path| path.join("ADB Manager").join("scrcpy").join("scrcpy.exe")),
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(PathBuf::from)
                .map(|path| path.join("scrcpy").join("scrcpy.exe")),
            std::env::var("ProgramFiles")
                .ok()
                .map(PathBuf::from)
                .map(|path| path.join("scrcpy").join("scrcpy.exe")),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            Some(PathBuf::from("/opt/homebrew/bin/scrcpy")),
            Some(PathBuf::from("/usr/local/bin/scrcpy")),
        ]
    } else {
        vec![Some(PathBuf::from("/usr/bin/scrcpy"))]
    };

    candidates.into_iter().flatten().find(|path| path.exists())
}

fn verify_device_online(app: &AppHandle, device_serial: &str) -> Result<(), AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &["get-state"],
        Some(device_serial),
        Duration::from_secs(4),
    )?;
    adb::ensure_success(&output, &t!("mirror.check_device_failed"))?;

    let state = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if state == "device" {
        Ok(())
    } else {
        Err(AdbError::CommandFailed(
            t!("mirror.device_not_ready", "state" => if state.is_empty() { "unknown" } else { &state }).into_owned(),
        ))
    }
}

fn required_device_serial(device_serial: Option<String>) -> Result<String, AdbError> {
    device_serial
        .map(|serial| serial.trim().to_string())
        .filter(|serial| !serial.is_empty())
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.select_device").into_owned()))
}

fn parse_launchable_apps(output: &str) -> Vec<LaunchableApp> {
    let mut apps = Vec::new();
    let mut seen = HashSet::new();
    let mut pending_package: Option<String> = None;
    let mut pending_activity: Option<String> = None;

    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(app) = extract_component_from_line(line) {
            push_launchable_app(&mut apps, &mut seen, app);
            continue;
        }

        if let Some(package_name) = line.strip_prefix("packageName=") {
            pending_package = Some(clean_value_token(package_name));
        } else if let Some(activity_name) = line.strip_prefix("name=") {
            pending_activity = Some(clean_value_token(activity_name));
        }

        if let (Some(package_name), Some(activity_name)) =
            (pending_package.as_deref(), pending_activity.as_deref())
        {
            let component_name = if activity_name.starts_with('.') {
                format!("{}/{}{}", package_name, package_name, activity_name)
            } else {
                format!("{}/{}", package_name, activity_name)
            };
            if let Some(app) = normalize_launchable_component(&component_name) {
                push_launchable_app(&mut apps, &mut seen, app);
            }
            pending_package = None;
            pending_activity = None;
        }
    }

    apps.sort_by(|a, b| {
        a.label
            .cmp(&b.label)
            .then_with(|| a.package_name.cmp(&b.package_name))
            .then_with(|| a.activity_name.cmp(&b.activity_name))
    });
    apps
}

fn extract_component_from_line(line: &str) -> Option<LaunchableApp> {
    line.split_whitespace()
        .filter_map(normalize_launchable_component)
        .next()
}

fn push_launchable_app(
    apps: &mut Vec<LaunchableApp>,
    seen: &mut HashSet<String>,
    app: LaunchableApp,
) {
    if seen.insert(app.component_name.clone()) {
        apps.push(app);
    }
}

fn normalize_launchable_component(value: &str) -> Option<LaunchableApp> {
    let cleaned = clean_component_token(value)?;
    let (package_name, activity_name) = cleaned.split_once('/')?;
    if !valid_package_name(package_name) {
        return None;
    }
    let activity_name = normalize_activity_name(package_name, activity_name)?;
    let component_name = format!("{}/{}", package_name, activity_name);
    Some(LaunchableApp {
        package_name: package_name.to_string(),
        activity_name,
        component_name,
        label: readable_label_from_package(package_name),
        icon_data_url: None,
    })
}

fn clean_component_token(value: &str) -> Option<&str> {
    let mut token = value.trim();
    if let Some(value) = token.strip_prefix("cmp=") {
        token = value;
    }
    if let Some(value) = token.strip_prefix("ComponentInfo{") {
        token = value;
    }
    token = token.trim_matches(|c| {
        matches!(
            c,
            ',' | ';' | '"' | '\'' | '[' | ']' | '(' | ')' | '{' | '}'
        )
    });
    (!token.is_empty()).then_some(token)
}

fn clean_value_token(value: &str) -> String {
    value
        .split_whitespace()
        .next()
        .unwrap_or(value)
        .trim_matches(|c| {
            matches!(
                c,
                ',' | ';' | '"' | '\'' | '[' | ']' | '(' | ')' | '{' | '}'
            )
        })
        .to_string()
}

fn normalize_activity_name(package_name: &str, activity_name: &str) -> Option<String> {
    let activity_name = activity_name.trim();
    let full_name = if activity_name.starts_with('.') {
        format!("{}{}", package_name, activity_name)
    } else {
        activity_name.to_string()
    };
    if full_name.is_empty()
        || !full_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '$'))
    {
        return None;
    }
    Some(full_name)
}

fn valid_package_name(package_name: &str) -> bool {
    let mut parts = package_name.split('.');
    let has_multiple_parts = parts.clone().count() >= 2;
    has_multiple_parts
        && parts.all(|part| {
            !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

fn readable_label_from_package(package_name: &str) -> String {
    let segment = package_name
        .split('.')
        .rev()
        .find(|segment| {
            !matches!(
                segment.to_ascii_lowercase().as_str(),
                "app" | "apps" | "android" | "launcher" | "mobile"
            )
        })
        .unwrap_or(package_name);
    readable_segment(segment)
}

fn readable_segment(segment: &str) -> String {
    segment
        .split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn persistent_icon_cache_id(
    device_serial: &str,
    package_name: &str,
    activity_name: &str,
) -> String {
    let identity = format!("{}|{}|{}", device_serial, package_name, activity_name);
    format!(
        "{}-{}-{}-{}",
        safe_icon_cache_filename(device_serial),
        safe_icon_cache_filename(package_name),
        safe_icon_cache_filename(activity_name),
        stable_hash_hex(&identity)
    )
}

fn stable_hash_hex(value: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn read_persistent_launchable_app_asset(
    app: &AppHandle,
    cache_id: &str,
) -> Option<PersistentLaunchableAppIconCacheHit> {
    let path = persistent_icon_cache_entry_path(app, cache_id).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let entry: PersistentLaunchableAppIconCacheEntry = serde_json::from_str(&text).ok()?;
    if entry.version != ICON_CACHE_VERSION {
        return None;
    }
    Some(PersistentLaunchableAppIconCacheHit {
        cache_stale: persistent_icon_cache_stale(&entry),
        entry,
    })
}

fn write_persistent_launchable_app_asset(
    app: &AppHandle,
    cache_id: &str,
    entry: &PersistentLaunchableAppIconCacheEntry,
) -> Result<(), AdbError> {
    let dir = persistent_icon_cache_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.json", safe_icon_cache_filename(cache_id)));
    let data = serde_json::to_vec(entry).map_err(|error| {
        AdbError::CommandFailed(
            t!("mirror.icon_cache_write_failed", "message" => error).into_owned(),
        )
    })?;
    std::fs::write(path, data)?;
    Ok(())
}

fn persistent_icon_cache_dir(app: &AppHandle) -> Result<PathBuf, AdbError> {
    let base = app.path().app_cache_dir().map_err(|error| {
        AdbError::CommandFailed(
            t!("mirror.icon_cache_write_failed", "message" => error).into_owned(),
        )
    })?;
    Ok(base.join("app-icons"))
}

fn persistent_icon_cache_entry_path(app: &AppHandle, cache_id: &str) -> Result<PathBuf, AdbError> {
    Ok(
        persistent_icon_cache_dir(app)?
            .join(format!("{}.json", safe_icon_cache_filename(cache_id))),
    )
}

fn persistent_icon_cache_stale(entry: &PersistentLaunchableAppIconCacheEntry) -> bool {
    let now = now_unix_seconds();
    now.saturating_sub(entry.verified_at_unix) >= ICON_CACHE_VERIFY_AFTER_SECS
}

fn should_rebuild_persistent_icon_cache(
    entry: &PersistentLaunchableAppIconCacheEntry,
    remote_path: &str,
) -> bool {
    let now = now_unix_seconds();
    entry.remote_path != remote_path
        || now.saturating_sub(entry.cached_at_unix) >= ICON_CACHE_REBUILD_AFTER_SECS
        || (entry.failed
            && now.saturating_sub(entry.cached_at_unix) >= ICON_CACHE_VERIFY_AFTER_SECS)
}

fn persistent_cache_entry(
    remote_path: &str,
    asset: &CachedLaunchableAppAsset,
) -> PersistentLaunchableAppIconCacheEntry {
    let now = now_unix_seconds();
    PersistentLaunchableAppIconCacheEntry {
        version: ICON_CACHE_VERSION,
        remote_path: remote_path.to_string(),
        label: asset.label.clone(),
        icon_data_url: asset.icon_data_url.clone(),
        cached_at_unix: now,
        verified_at_unix: now,
        failed: asset.label.is_none() && asset.icon_data_url.is_none(),
    }
}

fn now_unix_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

fn app_icon_cache_key(device_serial: &str, component_name: &str, remote_path: &str) -> String {
    format!("{}|{}|{}", device_serial, component_name, remote_path)
}

fn cached_launchable_app_asset(cache_key: &str) -> Option<CachedLaunchableAppAsset> {
    let cache = APP_ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    cache.lock().ok()?.get(cache_key).cloned()
}

fn cache_launchable_app_asset(cache_key: String, asset: CachedLaunchableAppAsset) {
    let cache = APP_ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(cache_key, asset);
    }
}

fn query_package_apk_path(
    app: &AppHandle,
    device_serial: &str,
    package_name: &str,
) -> Result<String, AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &["shell", "pm", "path", package_name],
        Some(device_serial),
        Duration::from_secs(8),
    )?;
    adb::ensure_success(&output, &t!("mirror.pull_app_icon_failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let paths = parse_pm_package_paths(&stdout);
    paths
        .iter()
        .find(|path| path.ends_with("/base.apk"))
        .cloned()
        .or_else(|| paths.into_iter().next())
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.pull_app_icon_failed").into_owned()))
}

fn parse_pm_package_paths(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| line.strip_prefix("package:"))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn pull_package_apk(
    app: &AppHandle,
    device_serial: &str,
    remote_path: &str,
    local_path: &PathBuf,
) -> Result<(), AdbError> {
    let local_path = local_path.to_string_lossy().to_string();
    let output = adb::run_adb_with_timeout(
        app,
        &["pull", remote_path, &local_path],
        Some(device_serial),
        Duration::from_secs(45),
    )?;
    adb::ensure_success(&output, &t!("mirror.pull_app_icon_failed"))
}

fn safe_icon_cache_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn extract_launchable_app_asset_from_apk(
    apk_path: &PathBuf,
    package_name: &str,
    activity_name: &str,
) -> Option<CachedLaunchableAppAsset> {
    let file = File::open(apk_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let manifest_data = read_zip_entry(&mut archive, "AndroidManifest.xml")?;
    let manifest = parse_manifest_launch_metadata(&manifest_data, package_name);
    let resources = read_zip_entry(&mut archive, "resources.arsc")
        .as_deref()
        .and_then(parse_resource_table);

    let activity = manifest.activities.get(activity_name);
    let label = activity
        .and_then(|activity| activity.label.as_ref())
        .or(manifest.app_label.as_ref())
        .and_then(|value| resolve_manifest_label(value, resources.as_ref()));

    let preferred_icon_stem = activity
        .and_then(|activity| activity.icon.or(activity.round_icon))
        .or(manifest.app_icon)
        .or(manifest.app_round_icon)
        .and_then(|resource_id| {
            resources
                .as_ref()
                .and_then(|resources| resolve_resource_image_path(resources, resource_id))
                .and_then(|path| file_stem_from_resource_path(&path))
        });
    let icon_data_url = activity
        .and_then(|activity| activity.icon)
        .or_else(|| activity.and_then(|activity| activity.round_icon))
        .or(manifest.app_icon)
        .or(manifest.app_round_icon)
        .and_then(|resource_id| {
            resources.as_ref().and_then(|resources| {
                resolve_resource_icon_data_url(&mut archive, resources, resource_id, 0)
            })
        })
        .or_else(|| find_best_icon_data_url(&mut archive, preferred_icon_stem.as_deref()));

    Some(CachedLaunchableAppAsset {
        label,
        icon_data_url,
    })
}

fn read_zip_entry(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<Vec<u8>> {
    let mut file = archive.by_name(name).ok()?;
    let mut data = Vec::with_capacity(file.size().min(1024 * 1024) as usize);
    file.read_to_end(&mut data).ok()?;
    Some(data)
}

fn data_url_from_zip_entry(archive: &mut zip::ZipArchive<File>, path: &str) -> Option<String> {
    let mut file = archive.by_name(path).ok()?;
    if file.size() == 0 || file.size() > MAX_ICON_BYTES {
        return None;
    }
    let mime = icon_mime_type(path)?;
    let mut data = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut data).ok()?;
    Some(format!(
        "data:{};base64,{}",
        mime,
        BASE64_STANDARD.encode(data)
    ))
}

fn resolve_resource_icon_data_url(
    archive: &mut zip::ZipArchive<File>,
    resources: &ResourceTable,
    resource_id: u32,
    depth: usize,
) -> Option<String> {
    if depth >= MAX_ICON_XML_DEPTH {
        return None;
    }

    let paths = resolve_resource_file_paths(resources, resource_id);
    if let Some(path) = best_icon_image_path(&paths) {
        if let Some(data_url) = data_url_from_zip_entry(archive, &path) {
            return Some(data_url);
        }
    }

    for path in ranked_icon_xml_paths(&paths) {
        if let Some(data_url) = icon_data_url_from_xml_resource(archive, resources, &path, depth) {
            return Some(data_url);
        }
    }

    None
}

fn icon_data_url_from_xml_resource(
    archive: &mut zip::ZipArchive<File>,
    resources: &ResourceTable,
    path: &str,
    depth: usize,
) -> Option<String> {
    if depth + 1 >= MAX_ICON_XML_DEPTH {
        return None;
    }
    let data = read_zip_entry(archive, path)?;
    let elements = parse_binary_xml_start_elements(&data);
    let references = icon_xml_resource_references_from_elements(&elements);
    let mut seen = HashSet::new();
    for reference in references {
        if !seen.insert(reference.resource_id) {
            continue;
        }
        if let Some(data_url) =
            resolve_resource_icon_data_url(archive, resources, reference.resource_id, depth + 1)
        {
            return Some(data_url);
        }
    }

    None
}

fn icon_xml_resource_references_from_elements(
    elements: &[BinaryXmlElement],
) -> Vec<IconXmlResourceRef> {
    let mut references = Vec::new();
    for element in elements {
        match element.name.as_str() {
            "foreground" => {
                push_icon_resource_reference(&mut references, element, "drawable", 1000);
                push_icon_resource_reference(&mut references, element, "src", 980);
            }
            "bitmap" => {
                push_icon_resource_reference(&mut references, element, "src", 930);
                push_icon_resource_reference(&mut references, element, "drawable", 900);
            }
            "item" => {
                push_icon_resource_reference(&mut references, element, "drawable", 520);
                push_icon_resource_reference(&mut references, element, "src", 500);
            }
            "monochrome" => {
                push_icon_resource_reference(&mut references, element, "drawable", 120);
                push_icon_resource_reference(&mut references, element, "src", 100);
            }
            "background" => {}
            _ => {
                push_icon_resource_reference(&mut references, element, "drawable", 320);
                push_icon_resource_reference(&mut references, element, "src", 300);
            }
        }
    }
    references.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.resource_id.cmp(&right.resource_id))
    });
    references
}

fn push_icon_resource_reference(
    references: &mut Vec<IconXmlResourceRef>,
    element: &BinaryXmlElement,
    attr_name: &str,
    priority: i32,
) {
    if let Some(resource_id) = element.attribute(attr_name).and_then(attr_resource_id) {
        references.push(IconXmlResourceRef {
            resource_id,
            priority,
        });
    }
}

fn find_best_icon_data_url(
    archive: &mut zip::ZipArchive<File>,
    preferred_stem: Option<&str>,
) -> Option<String> {
    let mut best: Option<ZipIconCandidate> = None;
    for index in 0..archive.len() {
        let candidate = {
            let Ok(file) = archive.by_index(index) else {
                continue;
            };
            let path = file.name().to_string();
            let size = file.size();
            if size == 0 || size > MAX_ICON_BYTES || !is_supported_icon_image_path(&path) {
                None
            } else {
                icon_candidate_score(&path, preferred_stem).map(|score| ZipIconCandidate {
                    path,
                    score,
                    size,
                })
            }
        };

        let Some(candidate) = candidate else {
            continue;
        };
        let should_replace = best.as_ref().is_none_or(|current| {
            candidate.score > current.score
                || (candidate.score == current.score && candidate.size > current.size)
        });
        if should_replace {
            best = Some(candidate);
        }
    }

    best.and_then(|candidate| data_url_from_zip_entry(archive, &candidate.path))
}

fn is_supported_icon_image_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("res/") && (lower.ends_with(".png") || lower.ends_with(".webp"))
}

fn is_icon_xml_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("res/") && lower.ends_with(".xml")
}

fn icon_mime_type(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else {
        None
    }
}

fn icon_candidate_score(path: &str, preferred_stem: Option<&str>) -> Option<i32> {
    let lower = path.to_ascii_lowercase();
    if !is_supported_icon_image_path(&lower) {
        return None;
    }

    let file_name = lower.rsplit('/').next().unwrap_or(&lower);
    let stem = file_name
        .strip_suffix(".png")
        .or_else(|| file_name.strip_suffix(".webp"))
        .unwrap_or(file_name);

    let preferred_stem = preferred_stem.map(|stem| stem.to_ascii_lowercase());
    let preferred_match = preferred_stem.as_ref().is_some_and(|preferred| {
        stem == preferred || stem.starts_with(preferred) || stem.contains(preferred)
    });
    let likely_icon = preferred_match
        || lower.contains("ic_launcher")
        || lower.contains("launcher")
        || lower.contains("icon");
    if !likely_icon {
        return None;
    }

    let mut score = 0;
    if let Some(preferred) = preferred_stem.as_ref() {
        if stem == preferred {
            score += 1200;
        } else if stem.starts_with(preferred) {
            score += 1000;
        } else if stem.contains(preferred) {
            score += 800;
        }
    }
    if lower.contains("ic_launcher") {
        score += 500;
    }
    if lower.contains("/mipmap") {
        score += 260;
    }
    if lower.contains("launcher") {
        score += 180;
    }
    if lower.contains("icon") {
        score += 120;
    }
    if lower.contains("xxxhdpi") {
        score += 80;
    } else if lower.contains("xxhdpi") {
        score += 70;
    } else if lower.contains("xhdpi") {
        score += 60;
    } else if lower.contains("hdpi") {
        score += 40;
    } else if lower.contains("mdpi") {
        score += 20;
    }
    if lower.contains("round") {
        score -= 30;
    }
    if lower.contains("foreground") {
        score -= 50;
    }
    if lower.contains("background") {
        score -= 120;
    }
    if lower.contains("monochrome") || lower.contains("notification") {
        score -= 400;
    }
    if lower.contains("banner") || lower.contains("splash") {
        score -= 250;
    }

    Some(score)
}

fn best_icon_image_path(paths: &[String]) -> Option<String> {
    paths
        .iter()
        .filter(|path| is_supported_icon_image_path(path))
        .max_by_key(|path| icon_resource_path_score(path))
        .cloned()
}

fn ranked_icon_xml_paths(paths: &[String]) -> Vec<String> {
    let mut paths = paths
        .iter()
        .filter(|path| is_icon_xml_path(path))
        .cloned()
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| std::cmp::Reverse(icon_resource_path_score(path)));
    paths
}

fn icon_resource_path_score(path: &str) -> i32 {
    let lower = path.to_ascii_lowercase();
    let mut score = 0;
    if lower.contains("/mipmap") {
        score += 260;
    }
    if lower.contains("ic_launcher") {
        score += 220;
    } else if lower.contains("launcher") {
        score += 160;
    } else if lower.contains("icon") {
        score += 100;
    }
    if lower.contains("xxxhdpi") {
        score += 80;
    } else if lower.contains("xxhdpi") {
        score += 70;
    } else if lower.contains("xhdpi") {
        score += 60;
    } else if lower.contains("hdpi") {
        score += 40;
    } else if lower.contains("mdpi") {
        score += 20;
    }
    if lower.ends_with(".webp") {
        score += 12;
    } else if lower.ends_with(".png") {
        score += 10;
    }
    if lower.contains("foreground") {
        score += 8;
    }
    if lower.contains("round") {
        score -= 30;
    }
    if lower.contains("background") {
        score -= 120;
    }
    if lower.contains("monochrome") || lower.contains("notification") {
        score -= 400;
    }
    if lower.contains("banner") || lower.contains("splash") {
        score -= 250;
    }
    score
}

fn file_stem_from_resource_path(path: &str) -> Option<String> {
    let name = path.rsplit('/').next()?;
    let stem = name
        .strip_suffix(".xml")
        .or_else(|| name.strip_suffix(".png"))
        .or_else(|| name.strip_suffix(".webp"))
        .unwrap_or(name);
    (!stem.trim().is_empty()).then(|| stem.to_string())
}

fn parse_manifest_launch_metadata(data: &[u8], package_name: &str) -> ManifestLaunchMetadata {
    let mut metadata = ManifestLaunchMetadata::default();
    for element in parse_binary_xml_start_elements(data) {
        match element.name.as_str() {
            "application" => {
                metadata.app_label = element
                    .attribute("label")
                    .and_then(|attr| attr_manifest_value(attr));
                metadata.app_icon = element.attribute("icon").and_then(attr_resource_id);
                metadata.app_round_icon = element.attribute("roundIcon").and_then(attr_resource_id);
            }
            "activity" | "activity-alias" => {
                let Some(name) = element
                    .attribute("name")
                    .and_then(attr_text_value)
                    .and_then(|name| normalize_activity_name(package_name, &name))
                else {
                    continue;
                };
                metadata.activities.insert(
                    name,
                    ManifestActivityMetadata {
                        label: element
                            .attribute("label")
                            .and_then(|attr| attr_manifest_value(attr)),
                        icon: element.attribute("icon").and_then(attr_resource_id),
                        round_icon: element.attribute("roundIcon").and_then(attr_resource_id),
                    },
                );
            }
            _ => {}
        }
    }
    metadata
}

#[derive(Debug)]
struct BinaryXmlElement {
    name: String,
    attributes: Vec<BinaryXmlAttribute>,
}

impl BinaryXmlElement {
    fn attribute(&self, name: &str) -> Option<&BinaryXmlAttribute> {
        self.attributes.iter().find(|attr| attr.name == name)
    }
}

#[derive(Debug)]
struct BinaryXmlAttribute {
    name: String,
    raw_value: Option<String>,
    data_type: u8,
    data: u32,
}

fn parse_binary_xml_start_elements(data: &[u8]) -> Vec<BinaryXmlElement> {
    let Some((mut offset, end)) = binary_xml_child_range(data) else {
        return Vec::new();
    };
    let mut strings = Vec::new();
    let mut resource_map = Vec::new();
    let mut elements = Vec::new();

    while offset + 8 <= end && offset + 8 <= data.len() {
        let Some(chunk_type) = read_u16_le(data, offset) else {
            break;
        };
        let Some(header_size) = read_u16_le(data, offset + 2).map(usize::from) else {
            break;
        };
        let Some(chunk_size) = read_u32_le(data, offset + 4).map(|size| size as usize) else {
            break;
        };
        if chunk_size == 0 || offset + chunk_size > data.len() {
            break;
        }

        if chunk_type == RESOURCE_TYPE_STRING_POOL {
            if let Some((pool, _)) = parse_string_pool(data, offset) {
                strings = pool;
            }
        } else if chunk_type == RESOURCE_TYPE_XML_RESOURCE_MAP {
            resource_map = parse_xml_resource_map(data, offset).unwrap_or_default();
        } else if chunk_type == RESOURCE_TYPE_XML_START_ELEMENT {
            if let Some(element) =
                parse_binary_xml_start_element(data, offset, &strings, &resource_map)
            {
                elements.push(element);
            }
        }

        offset += chunk_size.max(header_size);
    }

    elements
}

fn binary_xml_child_range(data: &[u8]) -> Option<(usize, usize)> {
    let chunk_type = read_u16_le(data, 0)?;
    let header_size = read_u16_le(data, 2)? as usize;
    let chunk_size = read_u32_le(data, 4)? as usize;
    if chunk_type == 0x0003 {
        Some((header_size, chunk_size.min(data.len())))
    } else {
        Some((0, data.len()))
    }
}

fn parse_xml_resource_map(data: &[u8], offset: usize) -> Option<Vec<u32>> {
    let header_size = read_u16_le(data, offset + 2)? as usize;
    let chunk_size = read_u32_le(data, offset + 4)? as usize;
    if chunk_size < header_size || offset + chunk_size > data.len() {
        return None;
    }
    let mut resource_ids = Vec::new();
    let mut cursor = offset + header_size;
    let end = offset + chunk_size;
    while cursor + 4 <= end {
        resource_ids.push(read_u32_le(data, cursor)?);
        cursor += 4;
    }
    Some(resource_ids)
}

fn parse_binary_xml_start_element(
    data: &[u8],
    offset: usize,
    strings: &[String],
    resource_map: &[u32],
) -> Option<BinaryXmlElement> {
    let name_idx = read_u32_le(data, offset + 20)? as usize;
    let name = strings.get(name_idx)?.clone();
    let attr_start = read_u16_le(data, offset + 24)? as usize;
    let attr_size = read_u16_le(data, offset + 26)? as usize;
    let attr_count = read_u16_le(data, offset + 28)? as usize;
    let attrs_offset = offset + 16 + attr_start;
    let mut attributes = Vec::new();

    for index in 0..attr_count {
        let attr_offset = attrs_offset + index * attr_size;
        if attr_offset + 20 > data.len() {
            continue;
        }
        let Some(attr_name_idx) = read_u32_le(data, attr_offset + 4).map(|index| index as usize)
        else {
            continue;
        };
        let Some(attr_name) = xml_attribute_name(attr_name_idx, strings, resource_map) else {
            continue;
        };
        let raw_idx = read_u32_le(data, attr_offset + 8)?;
        let data_type = *data.get(attr_offset + 15)?;
        let data_value = read_u32_le(data, attr_offset + 16)?;
        let raw_value = if raw_idx != NO_ENTRY {
            strings.get(raw_idx as usize).cloned()
        } else if data_type == VALUE_TYPE_STRING {
            strings.get(data_value as usize).cloned()
        } else {
            None
        };
        attributes.push(BinaryXmlAttribute {
            name: attr_name,
            raw_value,
            data_type,
            data: data_value,
        });
    }

    Some(BinaryXmlElement { name, attributes })
}

fn xml_attribute_name(
    attr_name_idx: usize,
    strings: &[String],
    resource_map: &[u32],
) -> Option<String> {
    strings
        .get(attr_name_idx)
        .cloned()
        .or_else(|| resource_map.get(attr_name_idx).and_then(android_attr_name))
}

fn android_attr_name(resource_id: &u32) -> Option<String> {
    match *resource_id {
        0x0101_0000 => Some("theme"),
        0x0101_0001 => Some("label"),
        0x0101_0002 => Some("icon"),
        0x0101_0003 => Some("name"),
        0x0101_052c => Some("roundIcon"),
        _ => None,
    }
    .map(str::to_string)
}

fn attr_manifest_value(attr: &BinaryXmlAttribute) -> Option<ManifestValue> {
    if attr.data_type == VALUE_TYPE_REFERENCE && attr.data != 0 {
        return Some(ManifestValue::Resource(attr.data));
    }
    if let Some(raw_value) = attr.raw_value.as_deref() {
        if let Some(resource_id) = parse_raw_resource_reference(raw_value) {
            return Some(ManifestValue::Resource(resource_id));
        }
        return Some(ManifestValue::Text(raw_value.to_string()));
    }
    if attr.data_type == VALUE_TYPE_STRING {
        return None;
    }
    if matches!(attr.data_type, VALUE_TYPE_INT_DEC | VALUE_TYPE_INT_HEX) {
        return Some(ManifestValue::Text(attr.data.to_string()));
    }
    None
}

fn attr_text_value(attr: &BinaryXmlAttribute) -> Option<String> {
    attr.raw_value.clone()
}

fn attr_resource_id(attr: &BinaryXmlAttribute) -> Option<u32> {
    if attr.data_type == VALUE_TYPE_REFERENCE && attr.data != 0 {
        return Some(attr.data);
    }
    attr.raw_value
        .as_deref()
        .and_then(parse_raw_resource_reference)
}

fn parse_raw_resource_reference(value: &str) -> Option<u32> {
    let value = value.trim().trim_start_matches('@').trim_start_matches('+');
    let value = value.strip_prefix("0x").unwrap_or(value);
    u32::from_str_radix(value, 16).ok()
}

fn parse_resource_table(data: &[u8]) -> Option<ResourceTable> {
    if read_u16_le(data, 0)? != RESOURCE_TYPE_TABLE {
        return None;
    }
    let header_size = read_u16_le(data, 2)? as usize;
    let table_size = read_u32_le(data, 4)? as usize;
    let table_end = table_size.min(data.len());
    let mut offset = header_size;
    let mut strings = Vec::new();
    let mut values = HashMap::new();

    while offset + 8 <= table_end {
        let chunk_type = read_u16_le(data, offset)?;
        let header_size = read_u16_le(data, offset + 2)? as usize;
        let chunk_size = read_u32_le(data, offset + 4)? as usize;
        if chunk_size == 0 || offset + chunk_size > data.len() {
            break;
        }

        match chunk_type {
            RESOURCE_TYPE_STRING_POOL => {
                if let Some((pool, _)) = parse_string_pool(data, offset) {
                    strings = pool;
                }
            }
            RESOURCE_TYPE_TABLE_PACKAGE => {
                parse_resource_package(data, offset, &strings, &mut values);
            }
            _ => {}
        }

        offset += chunk_size.max(header_size);
    }

    Some(ResourceTable { values })
}

fn parse_resource_package(
    data: &[u8],
    package_offset: usize,
    strings: &[String],
    values: &mut HashMap<u32, Vec<ResourceValue>>,
) -> Option<()> {
    let package_id = read_u32_le(data, package_offset + 8)?;
    let header_size = read_u16_le(data, package_offset + 2)? as usize;
    let package_size = read_u32_le(data, package_offset + 4)? as usize;
    let package_end = package_offset + package_size;
    let mut offset = package_offset + header_size;

    while offset + 8 <= package_end && offset + 8 <= data.len() {
        let chunk_type = read_u16_le(data, offset)?;
        let chunk_header_size = read_u16_le(data, offset + 2)? as usize;
        let chunk_size = read_u32_le(data, offset + 4)? as usize;
        if chunk_size == 0 || offset + chunk_size > data.len() {
            break;
        }

        if chunk_type == RESOURCE_TYPE_TABLE_TYPE {
            parse_resource_type_chunk(data, offset, package_id, strings, values);
        }

        offset += chunk_size.max(chunk_header_size);
    }

    Some(())
}

fn parse_resource_type_chunk(
    data: &[u8],
    chunk_offset: usize,
    package_id: u32,
    strings: &[String],
    values: &mut HashMap<u32, Vec<ResourceValue>>,
) -> Option<()> {
    let type_id = *data.get(chunk_offset + 8)? as u32;
    let header_size = read_u16_le(data, chunk_offset + 2)? as usize;
    let entry_count = read_u32_le(data, chunk_offset + 12)? as usize;
    let entries_start = read_u32_le(data, chunk_offset + 16)? as usize;
    let offsets_start = chunk_offset + header_size;

    for index in 0..entry_count {
        let entry_offset = read_u32_le(data, offsets_start + index * 4)?;
        if entry_offset == NO_ENTRY {
            continue;
        }
        let entry_absolute = chunk_offset + entries_start + entry_offset as usize;
        if entry_absolute + 8 > data.len() {
            continue;
        }
        let entry_size = read_u16_le(data, entry_absolute)? as usize;
        let flags = read_u16_le(data, entry_absolute + 2)?;
        if flags & 0x0001 != 0 {
            continue;
        }
        let value_offset = entry_absolute + entry_size;
        if value_offset + 8 > data.len() {
            continue;
        }
        let data_type = *data.get(value_offset + 3)?;
        let data_value = read_u32_le(data, value_offset + 4)?;
        let text = if data_type == VALUE_TYPE_STRING {
            strings.get(data_value as usize).cloned()
        } else {
            None
        };
        let resource_id = (package_id << 24) | (type_id << 16) | index as u32;
        values.entry(resource_id).or_default().push(ResourceValue {
            data_type,
            data: data_value,
            text,
        });
    }

    Some(())
}

fn resolve_manifest_label(
    value: &ManifestValue,
    resources: Option<&ResourceTable>,
) -> Option<String> {
    match value {
        ManifestValue::Text(label) => Some(label.clone()),
        ManifestValue::Resource(resource_id) => resources.and_then(|resources| {
            resolve_resource_values(resources, *resource_id, 0)
                .into_iter()
                .find_map(|value| {
                    value.text.filter(|text| {
                        !text.trim().is_empty()
                            && !text.starts_with("res/")
                            && !text.starts_with('@')
                    })
                })
        }),
    }
}

fn resolve_resource_image_path(resources: &ResourceTable, resource_id: u32) -> Option<String> {
    let paths = resolve_resource_file_paths(resources, resource_id);
    best_icon_image_path(&paths).or_else(|| ranked_icon_xml_paths(&paths).into_iter().next())
}

fn resolve_resource_file_paths(resources: &ResourceTable, resource_id: u32) -> Vec<String> {
    let mut seen = HashSet::new();
    resolve_resource_values(resources, resource_id, 0)
        .into_iter()
        .filter_map(|value| value.text)
        .filter(|path| path.starts_with("res/"))
        .filter(|path| {
            if seen.contains(path) {
                false
            } else {
                seen.insert(path.clone())
            }
        })
        .collect()
}

fn resolve_resource_values(
    resources: &ResourceTable,
    resource_id: u32,
    depth: usize,
) -> Vec<ResourceValue> {
    if depth >= 8 {
        return Vec::new();
    }
    let Some(values) = resources.values.get(&resource_id) else {
        return Vec::new();
    };
    let mut resolved = Vec::new();
    for value in values {
        if value.data_type == VALUE_TYPE_REFERENCE && value.data != 0 {
            resolved.extend(resolve_resource_values(resources, value.data, depth + 1));
        } else {
            resolved.push(value.clone());
        }
    }
    resolved
}

fn parse_string_pool(data: &[u8], offset: usize) -> Option<(Vec<String>, usize)> {
    let header_size = read_u16_le(data, offset + 2)? as usize;
    let chunk_size = read_u32_le(data, offset + 4)? as usize;
    let string_count = read_u32_le(data, offset + 8)? as usize;
    let flags = read_u32_le(data, offset + 16)?;
    let strings_start = read_u32_le(data, offset + 20)? as usize;
    let is_utf8 = flags & 0x0000_0100 != 0;
    let offsets_start = offset + header_size;
    let strings_base = offset + strings_start;
    let mut strings = Vec::with_capacity(string_count);

    for index in 0..string_count {
        let string_offset = read_u32_le(data, offsets_start + index * 4)? as usize;
        let absolute = strings_base + string_offset;
        let value = if is_utf8 {
            read_utf8_pool_string(data, absolute)
        } else {
            read_utf16_pool_string(data, absolute)
        }
        .unwrap_or_default();
        strings.push(value);
    }

    Some((strings, chunk_size))
}

fn read_utf8_pool_string(data: &[u8], offset: usize) -> Option<String> {
    let (_, after_utf16_len) = read_length8(data, offset)?;
    let (byte_len, string_offset) = read_length8(data, after_utf16_len)?;
    let end = string_offset + byte_len;
    if end > data.len() {
        return None;
    }
    Some(String::from_utf8_lossy(&data[string_offset..end]).into_owned())
}

fn read_utf16_pool_string(data: &[u8], offset: usize) -> Option<String> {
    let (char_len, string_offset) = read_length16(data, offset)?;
    let byte_len = char_len * 2;
    if string_offset + byte_len > data.len() {
        return None;
    }
    let chars = data[string_offset..string_offset + byte_len]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    Some(String::from_utf16_lossy(&chars))
}

fn read_length8(data: &[u8], offset: usize) -> Option<(usize, usize)> {
    let first = *data.get(offset)? as usize;
    if first & 0x80 == 0 {
        Some((first, offset + 1))
    } else {
        let second = *data.get(offset + 1)? as usize;
        Some((((first & 0x7f) << 8) | second, offset + 2))
    }
}

fn read_length16(data: &[u8], offset: usize) -> Option<(usize, usize)> {
    let first = read_u16_le(data, offset)? as usize;
    if first & 0x8000 == 0 {
        Some((first, offset + 2))
    } else {
        let second = read_u16_le(data, offset + 2)? as usize;
        Some((((first & 0x7fff) << 16) | second, offset + 4))
    }
}

fn read_u16_le(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32_le(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn scrcpy_path_env(adb_path: &std::path::Path) -> Option<OsString> {
    let mut entries = Vec::new();
    if let Some(parent) = adb_path.parent() {
        entries.push(parent.to_path_buf());
    }
    if let Some(existing) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(entries).ok()
}

fn capture_process_output(child: &mut std::process::Child) -> Arc<Mutex<Vec<String>>> {
    let output = Arc::new(Mutex::new(Vec::new()));
    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader("stdout", stdout, Arc::clone(&output));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader("stderr", stderr, Arc::clone(&output));
    }
    output
}

fn spawn_output_reader<R>(label: &'static str, reader: R, output: Arc<Mutex<Vec<String>>>)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(mut lines) = output.lock() {
                if lines.len() >= 20 {
                    lines.remove(0);
                }
                lines.push(format!("{}: {}", label, line));
            }
        }
    });
}

fn wait_for_early_exit(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Result<Option<ExitStatus>, AdbError> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            std::thread::sleep(Duration::from_millis(100));
            return Ok(Some(status));
        }
        if started.elapsed() >= timeout {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn scrcpy_exit_error(status: ExitStatus, output: &Arc<Mutex<Vec<String>>>) -> AdbError {
    let detail = output
        .lock()
        .ok()
        .map(|lines| lines.join("; "))
        .filter(|lines| !lines.trim().is_empty())
        .unwrap_or_else(|| t!("mirror.scrcpy_no_output").to_string());
    let code = status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    AdbError::CommandFailed(t!("mirror.scrcpy_exit", code = code, "detail" => detail).into_owned())
}

fn acquire_install_lock(lock: &Mutex<bool>) -> Result<InstallGuard<'_>, AdbError> {
    let mut installing = lock
        .lock()
        .map_err(|_| AdbError::CommandFailed(t!("mirror.install_state_error").into_owned()))?;
    if *installing {
        return Err(AdbError::CommandFailed(
            t!("mirror.scrcpy_installing").into_owned(),
        ));
    }
    *installing = true;
    drop(installing);
    Ok(InstallGuard(lock))
}

#[cfg(target_os = "macos")]
fn install_scrcpy_macos(app: &AppHandle) -> Result<(), AdbError> {
    let brew_path = match get_brew_path() {
        Some(path) => path,
        None => {
            emit_install_progress(app, &t!("mirror.homebrew_not_found"));
            let mut command = Command::new("/bin/bash");
            command.arg("-c").arg(
                "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
            );
            run_command_with_progress(app, command, &t!("mirror.homebrew_install_failed"))?;
            get_brew_path().ok_or_else(|| {
                AdbError::CommandFailed(t!("mirror.homebrew_not_found_after").into_owned())
            })?
        }
    };

    emit_install_progress(app, &t!("mirror.brew_install_start"));
    let mut command = Command::new(brew_path);
    command.args(["install", "scrcpy"]);
    run_command_with_progress(app, command, &t!("mirror.brew_install_failed"))
}

#[cfg(target_os = "macos")]
fn get_brew_path() -> Option<PathBuf> {
    if let Ok(path) = which::which("brew") {
        return Some(path);
    }
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
}

#[cfg(target_os = "windows")]
async fn install_scrcpy_windows(app: &AppHandle) -> Result<(), AdbError> {
    let install_dir = windows_scrcpy_install_dir()?;
    let base_dir = install_dir
        .parent()
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.creating_dir_failed").into_owned()))?
        .to_path_buf();
    let extract_dir = base_dir.join("scrcpy-download");
    let zip_path = base_dir.join("scrcpy.zip");

    std::fs::create_dir_all(&base_dir)?;
    let asset = fetch_windows_release_asset(app).await?;
    download_with_progress(app, &asset.browser_download_url, &zip_path, "scrcpy").await?;

    emit_install_progress(app, &t!("mirror.extract_start"));
    if extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&extract_dir);
    }
    std::fs::create_dir_all(&extract_dir)?;

    let file = std::fs::File::open(&zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AdbError::CommandFailed(t!("mirror.extract_failed", "message" => e).into_owned())
    })?;
    archive.extract(&extract_dir).map_err(|e| {
        AdbError::CommandFailed(t!("mirror.extract_failed", "message" => e).into_owned())
    })?;

    let scrcpy_exe = find_file_named(&extract_dir, "scrcpy.exe")
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.exe_not_found").into_owned()))?;
    let scrcpy_root = scrcpy_exe
        .parent()
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.invalid_package").into_owned()))?;

    if install_dir.exists() {
        let _ = std::fs::remove_dir_all(&install_dir);
    }
    copy_dir_all(scrcpy_root, &install_dir)?;

    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&extract_dir);
    emit_install_progress(app, &t!("mirror.installed_locally"));
    Ok(())
}

#[cfg(target_os = "windows")]
async fn fetch_windows_release_asset(app: &AppHandle) -> Result<GithubAsset, AdbError> {
    emit_install_progress(app, &t!("mirror.querying_package"));
    let client = reqwest::Client::new();
    let release = client
        .get(SCRCPY_RELEASE_API)
        .header("User-Agent", "ADB-Manager")
        .send()
        .await
        .map_err(|e| {
            AdbError::CommandFailed(t!("mirror.query_failed", "message" => e).into_owned())
        })?
        .error_for_status()
        .map_err(|e| {
            AdbError::CommandFailed(t!("mirror.query_failed", "message" => e).into_owned())
        })?
        .json::<GithubRelease>()
        .await
        .map_err(|e| {
            AdbError::CommandFailed(t!("mirror.parse_failed", "message" => e).into_owned())
        })?;

    release
        .assets
        .into_iter()
        .find(|asset| {
            let name = asset.name.to_lowercase();
            name.ends_with(".zip") && name.contains("win64")
        })
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.package_not_found").into_owned()))
}

#[cfg(target_os = "windows")]
fn windows_scrcpy_install_dir() -> Result<PathBuf, AdbError> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("USERPROFILE").map(|home| format!("{}\\AppData\\Local", home)))
        .map_err(|_| {
            AdbError::CommandFailed(t!("settings.local_app_dir_not_found").into_owned())
        })?;
    Ok(PathBuf::from(local_app_data)
        .join("ADB Manager")
        .join("scrcpy"))
}

#[cfg(target_os = "windows")]
fn find_file_named(root: &Path, file_name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(file_name))
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), AdbError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    zip_path: &PathBuf,
    label: &str,
) -> Result<(), AdbError> {
    emit_install_progress(app, &t!("mirror.connecting_server"));
    let client = reqwest::Client::new();
    let mut response = client
        .get(url)
        .header("User-Agent", "ADB-Manager")
        .send()
        .await
        .map_err(|e| {
            AdbError::CommandFailed(t!("mirror.download_failed", "message" => e).into_owned())
        })?
        .error_for_status()
        .map_err(|e| {
            AdbError::CommandFailed(t!("mirror.download_failed", "message" => e).into_owned())
        })?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut last_percent = 0u64;
    let mut file = std::fs::File::create(zip_path)?;

    while let Some(chunk) = response.chunk().await.map_err(|e| {
        AdbError::CommandFailed(t!("mirror.download_failed", "message" => e).into_owned())
    })? {
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let percent = downloaded.saturating_mul(100) / total;
            if percent >= last_percent + 5 || percent == 100 {
                last_percent = percent;
                emit_install_progress(app, &t!("mirror.downloading_percent", percent = percent));
            }
        } else {
            emit_install_progress(
                app,
                &t!("mirror.downloading_size", "size" => downloaded / 1024),
            );
        }
    }

    file.flush()?;
    Ok(())
}

fn run_command_with_progress(
    app: &AppHandle,
    mut command: Command,
    failure_context: &str,
) -> Result<(), AdbError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_handle = stdout.map(|out| {
        let app = app.clone();
        std::thread::spawn(move || emit_reader_lines(&app, out))
    });
    let stderr_handle = stderr.map(|err| {
        let app = app.clone();
        std::thread::spawn(move || emit_reader_lines(&app, err))
    });

    let status = child.wait()?;
    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }

    if status.success() {
        Ok(())
    } else {
        Err(AdbError::CommandFailed(
            t!("mirror.exit_with_code", "context" => failure_context, code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string())).into_owned(),
        ))
    }
}

fn emit_reader_lines<R: std::io::Read>(app: &AppHandle, reader: R) {
    let reader = std::io::BufReader::new(reader);
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if !line.is_empty() {
            emit_install_progress(app, line);
        }
    }
}

fn emit_install_progress(app: &AppHandle, message: &str) {
    let _ = app.emit("scrcpy-install-progress", message.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_brief_launchable_activity_output() {
        let output = r#"
priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
com.android.settings/.Settings
com.example.viewer/com.example.viewer.MainActivity
com.android.settings/.Settings
"#;

        let apps = parse_launchable_apps(output);

        assert_eq!(apps.len(), 2);
        assert!(apps.iter().any(|app| {
            app.package_name == "com.android.settings"
                && app.activity_name == "com.android.settings.Settings"
                && app.component_name == "com.android.settings/com.android.settings.Settings"
        }));
        assert!(apps.iter().any(|app| {
            app.package_name == "com.example.viewer"
                && app.activity_name == "com.example.viewer.MainActivity"
        }));
    }

    #[test]
    fn parses_full_launchable_activity_output() {
        let output = r#"
ActivityInfo:
  name=.HomeActivity
  packageName=com.example.home
ActivityInfo:
  packageName=com.example.player
  name=com.example.player.PlayerActivity
"#;

        let apps = parse_launchable_apps(output);

        assert_eq!(apps.len(), 2);
        assert!(apps
            .iter()
            .any(|app| { app.component_name == "com.example.home/com.example.home.HomeActivity" }));
        assert!(apps.iter().any(|app| {
            app.component_name == "com.example.player/com.example.player.PlayerActivity"
        }));
    }

    #[test]
    fn rejects_invalid_launchable_component_payloads() {
        assert!(normalize_launchable_component("com.example/.Main;rm").is_none());
        assert!(normalize_launchable_component("com.example/.Main && reboot").is_none());
        assert!(normalize_launchable_component("plain.package.name").is_none());
    }

    #[test]
    fn parses_package_apk_paths_from_pm_output() {
        let output = r#"
package:/data/app/~~abc/split_config.en.apk
package:/data/app/~~abc/base.apk
invalid
"#;

        let paths = parse_pm_package_paths(output);

        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], "/data/app/~~abc/split_config.en.apk");
        assert_eq!(paths[1], "/data/app/~~abc/base.apk");
    }

    #[test]
    fn scores_launcher_icons_above_unrelated_images() {
        let launcher =
            icon_candidate_score("res/mipmap-xxxhdpi-v4/ic_launcher.png", Some("ic_launcher"))
                .unwrap();
        let round = icon_candidate_score(
            "res/mipmap-xxxhdpi-v4/ic_launcher_round.png",
            Some("ic_launcher"),
        )
        .unwrap();
        let notification = icon_candidate_score("res/drawable-xxhdpi/ic_notification.png", None);
        let unrelated = icon_candidate_score("res/drawable-xxhdpi/button_background.png", None);

        assert!(launcher > round);
        assert!(notification.is_none());
        assert!(unrelated.is_none());
    }

    #[test]
    fn resolves_icon_resource_bitmap_before_adaptive_xml() {
        let resource_id = 0x7f0f0062;
        let resources = ResourceTable {
            values: HashMap::from([(
                resource_id,
                vec![
                    ResourceValue {
                        data_type: VALUE_TYPE_STRING,
                        data: 0,
                        text: Some("res/BW.xml".to_string()),
                    },
                    ResourceValue {
                        data_type: VALUE_TYPE_STRING,
                        data: 1,
                        text: Some("res/mipmap-mdpi-v4/d2.webp".to_string()),
                    },
                    ResourceValue {
                        data_type: VALUE_TYPE_STRING,
                        data: 2,
                        text: Some("res/mipmap-xxxhdpi-v4/sK.webp".to_string()),
                    },
                ],
            )]),
        };

        assert_eq!(
            resolve_resource_image_path(&resources, resource_id),
            Some("res/mipmap-xxxhdpi-v4/sK.webp".to_string())
        );
    }

    #[test]
    fn adaptive_icon_xml_references_prefer_foreground_and_bitmap() {
        let elements = vec![
            BinaryXmlElement {
                name: "adaptive-icon".to_string(),
                attributes: Vec::new(),
            },
            BinaryXmlElement {
                name: "background".to_string(),
                attributes: vec![resource_attr("drawable", 0x7f060111)],
            },
            BinaryXmlElement {
                name: "foreground".to_string(),
                attributes: vec![resource_attr("drawable", 0x7f080222)],
            },
            BinaryXmlElement {
                name: "bitmap".to_string(),
                attributes: vec![resource_attr("src", 0x7f110333)],
            },
            BinaryXmlElement {
                name: "monochrome".to_string(),
                attributes: vec![resource_attr("drawable", 0x7f080444)],
            },
        ];

        let references = icon_xml_resource_references_from_elements(&elements);
        let resource_ids = references
            .into_iter()
            .map(|reference| reference.resource_id)
            .collect::<Vec<_>>();

        assert_eq!(resource_ids, vec![0x7f080222, 0x7f110333, 0x7f080444]);
    }

    #[test]
    fn binary_xml_start_element_reads_attributes_from_attr_extension_offset() {
        let mut data = vec![0u8; 56];
        data[20..24].copy_from_slice(&0u32.to_le_bytes());
        data[24..26].copy_from_slice(&20u16.to_le_bytes());
        data[26..28].copy_from_slice(&20u16.to_le_bytes());
        data[28..30].copy_from_slice(&1u16.to_le_bytes());

        let attr_offset = 36;
        data[attr_offset..attr_offset + 4].copy_from_slice(&NO_ENTRY.to_le_bytes());
        data[attr_offset + 4..attr_offset + 8].copy_from_slice(&1u32.to_le_bytes());
        data[attr_offset + 8..attr_offset + 12].copy_from_slice(&NO_ENTRY.to_le_bytes());
        data[attr_offset + 15] = VALUE_TYPE_REFERENCE;
        data[attr_offset + 16..attr_offset + 20].copy_from_slice(&0x7f0f0062u32.to_le_bytes());

        let element = parse_binary_xml_start_element(
            &data,
            0,
            &["application".to_string(), "icon".to_string()],
            &[],
        )
        .unwrap();

        assert_eq!(element.name, "application");
        assert_eq!(
            element.attribute("icon").and_then(attr_resource_id),
            Some(0x7f0f0062)
        );
    }

    #[test]
    fn utf8_string_pool_reader_tolerates_invalid_strings() {
        let data = [1, 1, 0xff];

        assert_eq!(
            read_utf8_pool_string(&data, 0),
            Some("\u{fffd}".to_string())
        );
    }

    #[test]
    fn parses_raw_hex_resource_references() {
        assert_eq!(
            parse_raw_resource_reference("@0x7f080123"),
            Some(0x7f080123)
        );
        assert_eq!(
            parse_raw_resource_reference("@+0x7f080124"),
            Some(0x7f080124)
        );
        assert_eq!(parse_raw_resource_reference("@mipmap/ic_launcher"), None);
    }

    fn resource_attr(name: &str, data: u32) -> BinaryXmlAttribute {
        BinaryXmlAttribute {
            name: name.to_string(),
            raw_value: None,
            data_type: VALUE_TYPE_REFERENCE,
            data,
        }
    }

    #[test]
    fn icon_cache_identity_is_stable_and_activity_sensitive() {
        let first = persistent_icon_cache_id(
            "192.168.110.1:12345",
            "com.example.app",
            "com.example.app.MainActivity",
        );
        let second = persistent_icon_cache_id(
            "192.168.110.1:12345",
            "com.example.app",
            "com.example.app.MainActivity",
        );
        let other_activity = persistent_icon_cache_id(
            "192.168.110.1:12345",
            "com.example.app",
            "com.example.app.SettingsActivity",
        );

        assert_eq!(first, second);
        assert_ne!(first, other_activity);
        assert!(first.contains("com.example.app"));
    }

    #[test]
    fn icon_cache_stale_and_rebuild_rules_are_bounded() {
        let now = now_unix_seconds();
        let fresh = PersistentLaunchableAppIconCacheEntry {
            version: ICON_CACHE_VERSION,
            remote_path: "/data/app/base.apk".to_string(),
            label: Some("Example".to_string()),
            icon_data_url: Some("data:image/png;base64,abc".to_string()),
            cached_at_unix: now,
            verified_at_unix: now,
            failed: false,
        };
        let stale = PersistentLaunchableAppIconCacheEntry {
            verified_at_unix: now - ICON_CACHE_VERIFY_AFTER_SECS - 1,
            ..fresh.clone()
        };
        let old = PersistentLaunchableAppIconCacheEntry {
            cached_at_unix: now - ICON_CACHE_REBUILD_AFTER_SECS - 1,
            ..fresh.clone()
        };

        assert!(!persistent_icon_cache_stale(&fresh));
        assert!(persistent_icon_cache_stale(&stale));
        assert!(!should_rebuild_persistent_icon_cache(
            &fresh,
            "/data/app/base.apk"
        ));
        assert!(should_rebuild_persistent_icon_cache(
            &fresh,
            "/data/app/updated/base.apk"
        ));
        assert!(should_rebuild_persistent_icon_cache(
            &old,
            "/data/app/base.apk"
        ));
    }
}
