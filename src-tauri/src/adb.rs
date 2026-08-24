use rust_i18n::t;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::process;

#[derive(Debug)]
pub enum AdbError {
    AdbNotInstalled,
    CommandFailed(String),
    CommandTimedOut(String),
    CommandCancelled,
    NoDevice,
    AlreadyRecording,
    NotRecording,
    Io(std::io::Error),
}

impl std::fmt::Display for AdbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AdbNotInstalled => write!(f, "{}", t!("errors.adb_not_installed")),
            Self::CommandFailed(msg) => {
                write!(
                    f,
                    "{}",
                    t!("errors.command_failed", "message" => msg.clone())
                )
            }
            Self::CommandTimedOut(msg) => {
                write!(
                    f,
                    "{}",
                    t!("errors.command_timed_out", "message" => msg.clone())
                )
            }
            Self::CommandCancelled => write!(f, "ADB command cancelled"),
            Self::NoDevice => write!(f, "{}", t!("errors.no_device")),
            Self::AlreadyRecording => write!(f, "{}", t!("errors.already_recording")),
            Self::NotRecording => write!(f, "{}", t!("errors.not_recording")),
            Self::Io(e) => write!(f, "{}", t!("errors.io", "message" => e.to_string())),
        }
    }
}

impl std::error::Error for AdbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AdbError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl serde::Serialize for AdbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

fn get_bundled_adb_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &[
            "resources/platform-tools/windows/adb.exe",
            "resources/platform-tools/win/adb.exe",
        ]
    } else if cfg!(target_os = "macos") {
        &[
            "resources/platform-tools/macos/cozyla-adb",
            "resources/platform-tools/macos/adb",
            "resources/platform-tools/mac/adb",
        ]
    } else {
        &[
            "resources/platform-tools/linux/adb",
            "resources/platform-tools/adb",
        ]
    };

    for relative in candidates {
        let path = resource_dir.join(relative);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn get_system_adb_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = which::which("adb") {
        candidates.push(path);
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/adb"));
        candidates.push(PathBuf::from("/usr/local/bin/adb"));
    }

    candidates
        .into_iter()
        .find(|path| path.exists() && path.is_file())
}

fn get_sdk_adb_path() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").ok()?;
        let path = PathBuf::from(home)
            .join("Library")
            .join("Android")
            .join("sdk")
            .join("platform-tools")
            .join("adb");
        if path.exists() {
            return Some(path);
        }
    } else if cfg!(target_os = "windows") {
        let bases = [
            std::env::var("LOCALAPPDATA").ok().map(PathBuf::from),
            std::env::var("USERPROFILE")
                .ok()
                .map(|home| PathBuf::from(home).join("AppData").join("Local")),
        ];
        for base in bases.into_iter().flatten() {
            let path = base
                .join("Android")
                .join("sdk")
                .join("platform-tools")
                .join("adb.exe");
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

pub fn get_adb_path(app: &AppHandle) -> Result<PathBuf, AdbError> {
    let path = select_adb_path(
        get_bundled_adb_path(app),
        get_system_adb_path(),
        get_sdk_adb_path(),
    )
    .ok_or(AdbError::AdbNotInstalled)?;
    ensure_executable(&path)?;
    Ok(path)
}

fn select_adb_path(
    bundled: Option<PathBuf>,
    system: Option<PathBuf>,
    sdk: Option<PathBuf>,
) -> Option<PathBuf> {
    // Keep packaged behavior deterministic across computers. A system or SDK
    // adb is only a fallback for development or an incomplete app bundle.
    bundled.or(system).or(sdk)
}

fn new_adb_command(app: &AppHandle) -> Result<Command, AdbError> {
    let adb = get_adb_path(app)?;
    let mut cmd = process::hidden_command(&adb);
    prepare_adb_command(&mut cmd);
    Ok(cmd)
}

pub fn prepare_adb_command(cmd: &mut Command) {
    process::apply_hidden_process_flags(cmd);

    #[cfg(target_os = "macos")]
    {
        cmd.env(
            "PATH",
            macos_adb_command_path(std::env::var("PATH").ok().as_deref()),
        );
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "C.UTF-8".to_string()),
        );
        if let Some(home) = std::env::var_os("HOME") {
            let home_path = PathBuf::from(home);
            if home_path.is_dir() {
                cmd.current_dir(home_path);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_adb_command_path(existing_path: Option<&str>) -> String {
    let mut paths = Vec::new();
    for path in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/System/Cryptexes/App/usr/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/Library/Apple/usr/bin",
    ] {
        push_unique_path(&mut paths, path);
    }

    if let Some(existing_path) = existing_path {
        for path in existing_path.split(':') {
            push_unique_path(&mut paths, path);
        }
    }

    paths.join(":")
}

#[cfg(target_os = "macos")]
fn push_unique_path(paths: &mut Vec<String>, path: &str) {
    let trimmed = path.trim();
    if trimmed.is_empty() || paths.iter().any(|existing| existing == trimmed) {
        return;
    }
    paths.push(trimmed.to_string());
}

fn ensure_executable(path: &PathBuf) -> Result<(), AdbError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(path)?;
        let mode = metadata.permissions().mode();
        if mode & 0o111 == 0 {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(path, perms)?;
        }
    }
    Ok(())
}

pub fn run_adb(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
) -> Result<std::process::Output, AdbError> {
    let mut cmd = build_adb_command(app, args, device_serial)?;
    let output = cmd.output()?;
    Ok(output)
}

pub fn run_adb_with_timeout(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    timeout: Duration,
) -> Result<Output, AdbError> {
    run_adb_with_timeout_cancelable(app, args, device_serial, timeout, None)
}

pub fn run_adb_with_timeout_cancelable(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    timeout: Duration,
    cancellation: Option<&AtomicBool>,
) -> Result<Output, AdbError> {
    let mut cmd = build_adb_command(app, args, device_serial)?;
    wait_with_timeout(&mut cmd, timeout, cancellation)
}

pub fn spawn_adb_piped(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
) -> Result<Child, AdbError> {
    let mut cmd = build_adb_command(app, args, device_serial)?;
    let child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    Ok(child)
}

pub fn run_adb_with_env(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    envs: &[(&str, &str)],
) -> Result<std::process::Output, AdbError> {
    let mut cmd = new_adb_command(app)?;
    if let Some(serial) = device_serial {
        cmd.args(["-s", serial]);
    }
    for (key, value) in envs {
        cmd.env(key, value);
    }
    cmd.args(args);
    let output = cmd.output()?;
    Ok(output)
}

pub fn run_adb_with_env_timeout(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    envs: &[(&str, &str)],
    timeout: Duration,
) -> Result<Output, AdbError> {
    let mut cmd = build_adb_command(app, args, device_serial)?;
    for (key, value) in envs {
        cmd.env(key, value);
    }
    wait_with_timeout(&mut cmd, timeout, None)
}

fn build_adb_command(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
) -> Result<Command, AdbError> {
    let mut cmd = new_adb_command(app)?;
    if let Some(serial) = device_serial {
        cmd.args(["-s", serial]);
    }
    cmd.args(args);
    Ok(cmd)
}

fn wait_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
    cancellation: Option<&AtomicBool>,
) -> Result<Output, AdbError> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AdbError::CommandFailed("Failed to capture command stdout".to_string()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AdbError::CommandFailed("Failed to capture command stderr".to_string()))?;
    // Drain both pipes while the process runs. Waiting first can deadlock once
    // either pipe reaches its OS capacity (large logcat snapshots hit this).
    let stdout_reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        stdout.read_to_end(&mut output).map(|_| output)
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        stderr.read_to_end(&mut output).map(|_| output)
    });
    let started = Instant::now();

    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }

        if cancellation.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(AdbError::CommandCancelled);
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(AdbError::CommandTimedOut(
                t!("errors.timeout_detail", seconds = timeout.as_secs()).into_owned(),
            ));
        }

        std::thread::sleep(Duration::from_millis(100));
    };

    let stdout = join_output_reader(stdout_reader, "stdout")?;
    let stderr = join_output_reader(stderr_reader, "stderr")?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn join_output_reader(
    reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>,
    stream_name: &str,
) -> Result<Vec<u8>, AdbError> {
    reader
        .join()
        .map_err(|_| AdbError::CommandFailed(format!("Failed to collect command {stream_name}")))?
        .map_err(AdbError::Io)
}

pub fn ensure_success(output: &std::process::Output, context: &str) -> Result<(), AdbError> {
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let msg = if !stderr.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };

    Err(AdbError::CommandFailed(format!("{}: {}", context, msg)))
}

pub fn run_adb_with_stdin(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    stdin_data: &[u8],
) -> Result<std::process::Output, AdbError> {
    let mut cmd = new_adb_command(app)?;
    if let Some(serial) = device_serial {
        cmd.args(["-s", serial]);
    }
    cmd.args(args).stdin(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(stdin_data)?;
    }
    let output = child.wait_with_output()?;
    Ok(output)
}

pub fn check_adb_available(app: &AppHandle) -> bool {
    get_adb_path(app).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_app_prefers_bundled_adb_over_host_and_sdk_adb() {
        let bundled = Some(PathBuf::from("/app/resources/cozyla-adb"));
        let system = Some(PathBuf::from("/opt/homebrew/bin/adb"));
        let sdk = Some(PathBuf::from(
            "/Users/example/Library/Android/sdk/platform-tools/adb",
        ));

        assert_eq!(select_adb_path(bundled.clone(), system, sdk), bundled);
    }

    #[test]
    fn falls_back_to_system_adb_when_bundled_adb_is_missing() {
        let system = Some(PathBuf::from("/usr/local/bin/adb"));
        let sdk = Some(PathBuf::from("/sdk/platform-tools/adb"));

        assert_eq!(select_adb_path(None, system.clone(), sdk), system);
    }

    #[test]
    fn falls_back_to_sdk_adb_when_bundled_and_system_adb_are_missing() {
        let sdk = Some(PathBuf::from("/sdk/platform-tools/adb"));

        assert_eq!(select_adb_path(None, None, sdk.clone()), sdk);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_adb_command_path_restores_shell_search_paths() {
        let path = macos_adb_command_path(Some("/usr/bin:/custom/bin:/opt/homebrew/bin"));
        let parts = path.split(':').collect::<Vec<_>>();

        assert_eq!(parts.first(), Some(&"/opt/homebrew/bin"));
        assert!(parts.contains(&"/usr/local/bin"));
        assert!(parts.contains(&"/custom/bin"));
        assert_eq!(
            parts
                .iter()
                .filter(|part| **part == "/opt/homebrew/bin")
                .count(),
            1
        );
    }

    #[test]
    fn reports_unavailable_when_no_adb_source_exists() {
        assert_eq!(select_adb_path(None, None, None), None);
    }

    #[cfg(unix)]
    #[test]
    fn timeout_runner_drains_output_larger_than_the_os_pipe_capacity() {
        let mut command = process::hidden_command("/bin/sh");
        command.args(["-c", "head -c 1048576 /dev/zero"]);

        let output = wait_with_timeout(&mut command, Duration::from_secs(2), None)
            .expect("large finite output should complete before the timeout");

        assert!(output.status.success());
        assert_eq!(output.stdout.len(), 1_048_576);
        assert!(output.stderr.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn timeout_runner_kills_a_cancelled_child() {
        let mut command = process::hidden_command("/bin/sh");
        command.args(["-c", "sleep 10"]);
        let cancellation = AtomicBool::new(true);

        let result = wait_with_timeout(&mut command, Duration::from_secs(2), Some(&cancellation));

        assert!(matches!(result, Err(AdbError::CommandCancelled)));
    }
}
