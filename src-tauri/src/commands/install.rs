use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[tauri::command]
pub fn adb_install(
    app: AppHandle,
    apk_path: String,
    force: bool,
    pkg_name: Option<String>,
    device_serial: Option<String>,
) -> Result<String, AdbError> {
    let serial = device_serial.as_deref();

    if force {
        if let Some(pkg) = &pkg_name {
            let uninstall_output =
                adb::run_adb(&app, &["uninstall", pkg], serial)?;
            let uninstall_stdout = String::from_utf8_lossy(&uninstall_output.stdout);
            if !uninstall_stdout.contains("Success") && !uninstall_stdout.contains("成功") {
                // Uninstall may fail if package not installed, continue anyway
            }
        }
    }

    let mut args = vec!["install"];
    if !force {
        args.push("-r"); // replace existing
    }
    args.push(&apk_path);

    let output = adb::run_adb(&app, &args, serial)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.contains("Success") {
        Ok("安装成功".to_string())
    } else if stdout.contains("INSTALL_FAILED_ALREADY_EXISTS") {
        Err(AdbError::CommandFailed(
            "安装失败: 应用已存在，请勾选强制安装".to_string(),
        ))
    } else {
        let msg = if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        Err(AdbError::CommandFailed(format!("安装失败: {}", msg)))
    }
}
