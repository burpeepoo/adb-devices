use rust_i18n::t;
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::io::Write;
use std::io::{BufRead, Read};
#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use serde::Deserialize;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

#[cfg(target_os = "windows")]
const SCRCPY_RELEASE_API: &str = "https://api.github.com/repos/Genymobile/scrcpy/releases/latest";

struct InstallGuard<'a>(&'a Mutex<bool>);

#[derive(Serialize)]
pub struct ScreenMirrorState {
    running: bool,
    device_serial: Option<String>,
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
    let device_serial = device_serial
        .map(|serial| serial.trim().to_string())
        .filter(|serial| !serial.is_empty())
        .ok_or_else(|| AdbError::CommandFailed(t!("mirror.select_device").into_owned()))?;

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
