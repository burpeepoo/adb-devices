use std::path::PathBuf;
use thiserror::Error;
use tauri::{AppHandle, Manager};

#[derive(Debug, Error)]
pub enum AdbError {
    #[error("ADB 未安装，请点击一键安装")]
    AdbNotInstalled,
    #[error("ADB 命令执行失败: {0}")]
    CommandFailed(String),
    #[error("未找到设备")]
    NoDevice,
    #[error("正在录屏中")]
    AlreadyRecording,
    #[error("没有正在进行的录屏")]
    NotRecording,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
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
    let relative = if cfg!(target_os = "windows") {
        "platform-tools\\win\\adb.exe"
    } else {
        "platform-tools/mac/adb"
    };
    let path = resource_dir.join(relative);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn get_system_adb_path() -> Option<PathBuf> {
    which::which("adb").ok()
}

fn get_sdk_adb_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    if cfg!(target_os = "macos") {
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
        let path = PathBuf::from(home)
            .join("AppData")
            .join("Local")
            .join("Android")
            .join("sdk")
            .join("platform-tools")
            .join("adb.exe");
        if path.exists() {
            return Some(path);
        }
    }
    None
}

pub fn get_adb_path(app: &AppHandle) -> Result<PathBuf, AdbError> {
    if let Some(path) = get_bundled_adb_path(app) {
        ensure_executable(&path)?;
        return Ok(path);
    }
    if let Some(path) = get_system_adb_path() {
        return Ok(path);
    }
    if let Some(path) = get_sdk_adb_path() {
        return Ok(path);
    }
    Err(AdbError::AdbNotInstalled)
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
    let adb = get_adb_path(app)?;
    let mut cmd = std::process::Command::new(&adb);
    if let Some(serial) = device_serial {
        cmd.args(["-s", serial]);
    }
    cmd.args(args);
    let output = cmd.output()?;
    Ok(output)
}

pub fn run_adb_with_stdin(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    stdin_data: &[u8],
) -> Result<std::process::Output, AdbError> {
    let adb = get_adb_path(app)?;
    let mut cmd = std::process::Command::new(&adb);
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
