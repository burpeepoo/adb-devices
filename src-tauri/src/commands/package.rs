use serde::Serialize;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[derive(Debug, Serialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version_name: String,
    pub version_code: String,
    pub build_id: String,
}

#[tauri::command]
pub fn adb_list_packages(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<String>, AdbError> {
    let output = adb::run_adb(&app, &["shell", "pm", "list", "packages"], device_serial.as_deref())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut packages = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(name) = line.strip_prefix("package:") {
            packages.push(name.to_string());
        }
    }

    packages.sort();
    Ok(packages)
}

#[tauri::command]
pub fn adb_package_info(
    app: AppHandle,
    package_name: String,
    device_serial: Option<String>,
) -> Result<PackageInfo, AdbError> {
    let serial = device_serial.as_deref();

    // Get package details
    let output = adb::run_adb(
        &app,
        &["shell", "dumpsys", "package", &package_name],
        serial,
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut version_name = String::new();
    let mut version_code = String::new();

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("versionName=") {
            version_name = val.to_string();
        } else if let Some(val) = line.strip_prefix("versionCode=") {
            // versionCode may be followed by a space for additional info
            version_code = val.split_whitespace().next().unwrap_or(val).to_string();
        }
    }

    // Get build ID
    let build_output = adb::run_adb(
        &app,
        &["shell", "getprop", "ro.build.display.id"],
        serial,
    )?;
    let build_id = String::from_utf8_lossy(&build_output.stdout).trim().to_string();

    // Get serial number
    let serial_output = adb::run_adb(
        &app,
        &["shell", "getprop", "ro.serialno"],
        serial,
    )?;
    let serial_no = String::from_utf8_lossy(&serial_output.stdout).trim().to_string();

    Ok(PackageInfo {
        name: package_name,
        version_name,
        version_code,
        build_id: if build_id.is_empty() { serial_no } else { build_id },
    })
}
