use rust_i18n::t;
use serde::Serialize;
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

use crate::adb::{self, AdbError};

#[derive(Debug, Serialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version_name: String,
    pub version_code: String,
    pub device_serial: String,
    pub build_number: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExportedApk {
    pub package_name: String,
    pub output_dir: String,
    pub files: Vec<String>,
}

#[tauri::command(async)]
pub fn adb_list_packages(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<String>, AdbError> {
    let output = adb::run_adb(
        &app,
        &["shell", "pm", "list", "packages"],
        device_serial.as_deref(),
    )?;
    adb::ensure_success(&output, &t!("package.list_failed"))?;
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

#[tauri::command(async)]
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
    adb::ensure_success(&output, &t!("package.detail_failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let (version_name, version_code) = parse_package_versions(&stdout);

    // Get build ID
    let build_output = adb::run_adb(&app, &["shell", "getprop", "ro.build.display.id"], serial)?;
    adb::ensure_success(&build_output, &t!("package.build_number_failed"))?;
    let build_id = String::from_utf8_lossy(&build_output.stdout)
        .trim()
        .to_string();

    // Get serial number
    let serial_output = adb::run_adb(&app, &["shell", "getprop", "ro.serialno"], serial)?;
    adb::ensure_success(&serial_output, &t!("package.serial_number_failed"))?;
    let serial_no = String::from_utf8_lossy(&serial_output.stdout)
        .trim()
        .to_string();

    Ok(PackageInfo {
        name: package_name,
        version_name,
        version_code,
        device_serial: serial_no,
        build_number: build_id,
    })
}

#[tauri::command(async)]
pub fn adb_list_package_details(
    app: AppHandle,
    device_serial: Option<String>,
) -> Result<Vec<PackageInfo>, AdbError> {
    let serial = device_serial.as_deref();
    let build_output = adb::run_adb(&app, &["shell", "getprop", "ro.build.display.id"], serial)?;
    adb::ensure_success(&build_output, &t!("package.build_number_failed"))?;
    let build_number = String::from_utf8_lossy(&build_output.stdout)
        .trim()
        .to_string();

    let serial_output = adb::run_adb(&app, &["shell", "getprop", "ro.serialno"], serial)?;
    adb::ensure_success(&serial_output, &t!("package.serial_number_failed"))?;
    let device_serial_value = String::from_utf8_lossy(&serial_output.stdout)
        .trim()
        .to_string();

    let output = adb::run_adb(&app, &["shell", "dumpsys", "package", "packages"], serial)?;
    adb::ensure_success(&output, &t!("package.detail_failed"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut packages = parse_all_package_details(&stdout, &device_serial_value, &build_number);
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packages)
}

#[tauri::command(async)]
pub fn adb_export_package_apk(
    app: AppHandle,
    package_name: String,
    device_serial: Option<String>,
) -> Result<ExportedApk, AdbError> {
    let package_name = package_name.trim();
    if package_name.is_empty() {
        return Err(AdbError::CommandFailed(
            t!("package.package_name_required").into_owned(),
        ));
    }

    let serial = device_serial.as_deref();
    let path_output = adb::run_adb(&app, &["shell", "pm", "path", package_name], serial)?;
    adb::ensure_success(&path_output, &t!("package.apk_path_failed"))?;
    let stdout = String::from_utf8_lossy(&path_output.stdout);
    let remote_paths = parse_pm_paths(&stdout);
    if remote_paths.is_empty() {
        return Err(AdbError::CommandFailed(
            t!("package.apk_path_empty", "package" => package_name).into_owned(),
        ));
    }

    let base_output_dir = package_export_dir(&app)?;
    std::fs::create_dir_all(&base_output_dir)?;
    let safe_package_name = safe_filename(package_name);
    let output_dir = if remote_paths.len() == 1 {
        base_output_dir
    } else {
        let dir = base_output_dir.join(&safe_package_name);
        std::fs::create_dir_all(&dir)?;
        dir
    };

    let mut files = Vec::new();
    for (index, remote_path) in remote_paths.iter().enumerate() {
        let file_name =
            apk_output_file_name(&safe_package_name, remote_path, remote_paths.len(), index);
        let local_path = output_dir.join(file_name);
        let local_path_string = local_path.to_string_lossy().to_string();
        let pull_output = adb::run_adb_with_timeout(
            &app,
            &["pull", remote_path.as_str(), local_path_string.as_str()],
            serial,
            Duration::from_secs(120),
        )?;
        adb::ensure_success(&pull_output, &t!("package.apk_pull_failed"))?;
        files.push(local_path_string);
    }

    Ok(ExportedApk {
        package_name: package_name.to_string(),
        output_dir: output_dir.to_string_lossy().to_string(),
        files,
    })
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

fn package_export_dir(app: &AppHandle) -> Result<PathBuf, AdbError> {
    let downloads = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    Ok(downloads.join("ADB_Manager").join("APKs"))
}

fn parse_pm_paths(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("package:"))
        .filter(|path| !path.trim().is_empty())
        .map(|path| path.trim().to_string())
        .collect()
}

fn apk_output_file_name(
    safe_package_name: &str,
    remote_path: &str,
    total_paths: usize,
    index: usize,
) -> String {
    if total_paths == 1 {
        return format!("{safe_package_name}.apk");
    }

    let remote_file_name = remote_path
        .rsplit('/')
        .next()
        .filter(|name| !name.trim().is_empty())
        .map(safe_filename)
        .unwrap_or_else(|| format!("apk-{}.apk", index + 1));
    if remote_file_name.ends_with(".apk") {
        remote_file_name
    } else {
        format!("{remote_file_name}.apk")
    }
}

fn safe_filename(value: &str) -> String {
    let name: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let name = name.trim_matches('.');
    if name.is_empty() {
        "package".to_string()
    } else {
        name.to_string()
    }
}

fn parse_all_package_details(
    dumpsys_output: &str,
    device_serial: &str,
    build_number: &str,
) -> Vec<PackageInfo> {
    let mut packages = Vec::new();
    let mut current_name: Option<String> = None;
    let mut version_name = String::new();
    let mut version_code = String::new();

    for line in dumpsys_output.lines() {
        let trimmed = line.trim();

        if let Some(name) = parse_package_header(trimmed) {
            push_package(
                &mut packages,
                current_name.take(),
                &mut version_name,
                &mut version_code,
                device_serial,
                build_number,
            );
            current_name = Some(name);
            continue;
        }

        if current_name.is_none() {
            continue;
        }

        if version_name.is_empty() {
            if let Some(value) = trimmed.strip_prefix("versionName=") {
                version_name = value.to_string();
            }
        }

        if version_code.is_empty() {
            if let Some(value) = trimmed.strip_prefix("versionCode=") {
                version_code = value.split_whitespace().next().unwrap_or(value).to_string();
            }
        }
    }

    push_package(
        &mut packages,
        current_name,
        &mut version_name,
        &mut version_code,
        device_serial,
        build_number,
    );

    packages
}

fn parse_package_header(line: &str) -> Option<String> {
    let after_prefix = line.strip_prefix("Package [")?;
    let end = after_prefix.find(']')?;
    Some(after_prefix[..end].to_string())
}

fn push_package(
    packages: &mut Vec<PackageInfo>,
    name: Option<String>,
    version_name: &mut String,
    version_code: &mut String,
    device_serial: &str,
    build_number: &str,
) {
    if let Some(name) = name {
        packages.push(PackageInfo {
            name,
            version_name: std::mem::take(version_name),
            version_code: std::mem::take(version_code),
            device_serial: device_serial.to_string(),
            build_number: build_number.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{apk_output_file_name, parse_pm_paths, safe_filename};

    #[test]
    fn parses_single_and_split_apk_paths() {
        let output = "\
package:/data/app/~~abc/com.android.chrome-xyz/base.apk
package:/data/app/~~abc/com.android.chrome-xyz/split_config.arm64_v8a.apk
";

        assert_eq!(
            parse_pm_paths(output),
            vec![
                "/data/app/~~abc/com.android.chrome-xyz/base.apk",
                "/data/app/~~abc/com.android.chrome-xyz/split_config.arm64_v8a.apk",
            ]
        );
    }

    #[test]
    fn creates_stable_apk_output_names() {
        assert_eq!(
            apk_output_file_name("com.android.chrome", "/data/app/base.apk", 1, 0),
            "com.android.chrome.apk"
        );
        assert_eq!(
            apk_output_file_name(
                "com.android.chrome",
                "/data/app/split_config.arm64_v8a.apk",
                2,
                1,
            ),
            "split_config.arm64_v8a.apk"
        );
    }

    #[test]
    fn sanitizes_package_file_names() {
        assert_eq!(safe_filename("com.android.chrome"), "com.android.chrome");
        assert_eq!(safe_filename("bad/name:pkg"), "bad_name_pkg");
    }
}
