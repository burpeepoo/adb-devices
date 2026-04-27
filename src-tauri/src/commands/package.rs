use serde::Serialize;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[derive(Debug, Serialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version_name: String,
    pub version_code: String,
    pub device_serial: String,
    pub build_number: String,
}

#[tauri::command]
pub fn adb_list_packages(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<String>, AdbError> {
    let output = adb::run_adb(&app, &["shell", "pm", "list", "packages"], device_serial.as_deref())?;
    adb::ensure_success(&output, "获取包列表失败")?;
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
    adb::ensure_success(&output, "获取包详情失败")?;
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
    adb::ensure_success(&build_output, "获取 Build Number 失败")?;
    let build_id = String::from_utf8_lossy(&build_output.stdout).trim().to_string();

    // Get serial number
    let serial_output = adb::run_adb(
        &app,
        &["shell", "getprop", "ro.serialno"],
        serial,
    )?;
    adb::ensure_success(&serial_output, "获取 Serial Number 失败")?;
    let serial_no = String::from_utf8_lossy(&serial_output.stdout).trim().to_string();

    Ok(PackageInfo {
        name: package_name,
        version_name,
        version_code,
        device_serial: serial_no,
        build_number: build_id,
    })
}

#[tauri::command]
pub fn adb_list_package_details(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<PackageInfo>, AdbError> {
    let packages = adb_list_packages(app.clone(), device_serial.clone())?;
    let serial = device_serial.as_deref();

    let build_output = adb::run_adb(
        &app,
        &["shell", "getprop", "ro.build.display.id"],
        serial,
    )?;
    adb::ensure_success(&build_output, "获取 Build Number 失败")?;
    let build_number = String::from_utf8_lossy(&build_output.stdout).trim().to_string();

    let serial_output = adb::run_adb(
        &app,
        &["shell", "getprop", "ro.serialno"],
        serial,
    )?;
    adb::ensure_success(&serial_output, "获取 Serial Number 失败")?;
    let device_serial_value = String::from_utf8_lossy(&serial_output.stdout).trim().to_string();

    let mut result = Vec::with_capacity(packages.len());
    for package_name in packages {
        let output = adb::run_adb(
            &app,
            &["shell", "dumpsys", "package", &package_name],
            serial,
        )?;
        if !output.status.success() {
            result.push(PackageInfo {
                name: package_name,
                version_name: String::new(),
                version_code: String::new(),
                device_serial: device_serial_value.clone(),
                build_number: build_number.clone(),
            });
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let (version_name, version_code) = parse_package_versions(&stdout);
        result.push(PackageInfo {
            name: package_name,
            version_name,
            version_code,
            device_serial: device_serial_value.clone(),
            build_number: build_number.clone(),
        });
    }

    Ok(result)
}

fn parse_package_versions(dumpsys_output: &str) -> (String, String) {
    let mut version_name = String::new();
    let mut version_code = String::new();

    for line in dumpsys_output.lines() {
        let line = line.trim();
        if version_name.is_empty() {
            if let Some(val) = line.strip_prefix("versionName=") {
                version_name = val.to_string();
            }
        }
        if version_code.is_empty() {
            if let Some(val) = line.strip_prefix("versionCode=") {
                version_code = val.split_whitespace().next().unwrap_or(val).to_string();
            }
        }
        if !version_name.is_empty() && !version_code.is_empty() {
            break;
        }
    }

    (version_name, version_code)
}
