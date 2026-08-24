use rust_i18n::t;
use serde::Serialize;
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

use chrono::Local;

use crate::adb::{self, AdbError};
use crate::commands::logcat::{
    build_logcat_args, logcat_text_bounds, normalize_lookback_seconds, resolve_logcat_since,
    LogcatBufferSet,
};

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

#[derive(Debug, Serialize, Clone)]
pub struct LogPathCandidate {
    pub path: String,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExportedPackageLogs {
    pub package_name: String,
    pub output_dir: String,
    pub remote_path: String,
    pub logcat_file: Option<String>,
    pub logcat_scope: Option<String>,
    pub logcat_line_count: usize,
    pub logcat_source_start: Option<String>,
    pub logcat_source_end: Option<String>,
    pub logcat_lookback_seconds: Option<u32>,
    pub logcat_all_available: bool,
    pub metadata_file: String,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct PackageLogcatCapture {
    path: String,
    scope: String,
    line_count: usize,
    source_start: Option<String>,
    source_end: Option<String>,
    warnings: Vec<String>,
}

const COZYLA_LOG_ROOTS: &[&str] = &[
    "/storage/emulated/0/Documents/cozyla/logs",
    "/sdcard/Documents/cozyla/logs",
];

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

#[tauri::command(async)]
pub fn adb_detect_package_log_paths(
    app: AppHandle,
    package_name: String,
    device_serial: Option<String>,
) -> Result<Vec<LogPathCandidate>, AdbError> {
    let package_name = validate_package_name(&package_name)?;
    let serial = require_device_serial(device_serial)?;
    let mut candidates = Vec::new();

    for (path, source) in candidate_log_paths(&package_name) {
        if remote_path_exists(&app, &serial, &path)? {
            candidates.push(LogPathCandidate { path, source });
        }
    }

    for root in COZYLA_LOG_ROOTS {
        for child in remote_directory_entries(&app, &serial, root)? {
            if !matches_package_log_name(&child, &package_name) {
                continue;
            }
            candidates.push(LogPathCandidate {
                path: format!("{root}/{child}"),
                source: "cozyla-match".to_string(),
            });
        }
    }

    dedupe_log_candidates(&mut candidates);
    Ok(candidates)
}

#[tauri::command(async)]
pub fn adb_pull_package_logs(
    app: AppHandle,
    package_name: String,
    remote_path: Option<String>,
    include_logcat: Option<bool>,
    logcat_lookback_seconds: Option<u32>,
    device_serial: Option<String>,
) -> Result<ExportedPackageLogs, AdbError> {
    let package_name = validate_package_name(&package_name)?;
    let serial = require_device_serial(device_serial)?;
    let requested_path = remote_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(validate_remote_log_path)
        .transpose()?;

    let (selected_path, mut warnings) = match requested_path {
        Some(path) => (path, Vec::new()),
        None => {
            let candidates = adb_detect_package_log_paths(
                app.clone(),
                package_name.clone(),
                Some(serial.to_string()),
            )?;
            let strong_candidates = candidates
                .iter()
                .filter(|candidate| is_strong_log_candidate(&candidate.source))
                .collect::<Vec<_>>();
            let selected = match strong_candidates.as_slice() {
                [only] => *only,
                [] => {
                    return Err(AdbError::CommandFailed(
                        t!("package.log_path_not_found", "package" => package_name.clone())
                            .into_owned(),
                    ));
                }
                _ => {
                    return Err(AdbError::CommandFailed(
                        t!("package.log_path_ambiguous", "package" => package_name.clone())
                            .into_owned(),
                    ));
                }
            };
            let mut warnings = Vec::new();
            if candidates.len() > 1 {
                warnings.push(t!("package.log_path_multiple").into_owned());
            }
            (selected.path.clone(), warnings)
        }
    };

    let output_dir = package_logs_dir(&app, &package_name)?;
    std::fs::create_dir_all(&output_dir)?;
    let output_dir_string = output_dir.to_string_lossy().to_string();
    let pull_output = adb::run_adb_with_timeout(
        &app,
        &["pull", selected_path.as_str(), output_dir_string.as_str()],
        Some(serial.as_str()),
        Duration::from_secs(180),
    )?;
    adb::ensure_success(&pull_output, &t!("package.logs_pull_failed"))?;

    let requested_logcat_range = logcat_lookback_seconds.unwrap_or(6 * 60 * 60);
    let normalized_logcat_lookback = normalize_lookback_seconds(Some(requested_logcat_range));
    let logcat_all_available = requested_logcat_range == 0;
    let mut logcat_scope = None;
    let mut logcat_line_count = 0;
    let mut logcat_source_start = None;
    let mut logcat_source_end = None;
    let logcat_file = if include_logcat.unwrap_or(true) {
        match pull_package_logcat(
            &app,
            &serial,
            &package_name,
            &output_dir,
            normalized_logcat_lookback,
        ) {
            Ok(Some(result)) => {
                logcat_scope = Some(result.scope);
                logcat_line_count = result.line_count;
                logcat_source_start = result.source_start;
                logcat_source_end = result.source_end;
                warnings.extend(result.warnings);
                Some(result.path)
            }
            Ok(None) => {
                warnings.push(t!("package.logcat_not_running").into_owned());
                None
            }
            Err(error) => {
                warnings.push(t!("package.logcat_not_collected", "message" => error).into_owned());
                None
            }
        }
    } else {
        None
    };

    let metadata_file = output_dir.join("metadata.json");
    let metadata = serde_json::json!({
        "package_name": &package_name,
        "device_serial": &serial,
        "remote_path": &selected_path,
        "logcat_file": &logcat_file,
        "logcat_scope": &logcat_scope,
        "logcat_line_count": logcat_line_count,
        "logcat_source_start": &logcat_source_start,
        "logcat_source_end": &logcat_source_end,
        "logcat_lookback_seconds": normalized_logcat_lookback,
        "logcat_all_available": logcat_all_available,
        "warnings": &warnings,
        "collected_at": Local::now().to_rfc3339(),
    });
    let metadata_bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| AdbError::CommandFailed(error.to_string()))?;
    std::fs::write(&metadata_file, metadata_bytes)?;

    Ok(ExportedPackageLogs {
        package_name,
        output_dir: output_dir_string,
        remote_path: selected_path,
        logcat_file,
        logcat_scope,
        logcat_line_count,
        logcat_source_start,
        logcat_source_end,
        logcat_lookback_seconds: normalized_logcat_lookback,
        logcat_all_available,
        metadata_file: metadata_file.to_string_lossy().to_string(),
        warnings,
    })
}

fn validate_package_name(value: &str) -> Result<String, AdbError> {
    let value = value.trim();
    if value.is_empty()
        || value
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '$')))
    {
        return Err(AdbError::CommandFailed(
            t!("package.package_name_required").into_owned(),
        ));
    }
    Ok(value.to_string())
}

fn require_device_serial(device_serial: Option<String>) -> Result<String, AdbError> {
    let serial = device_serial
        .as_deref()
        .map(str::trim)
        .filter(|serial| !serial.is_empty())
        .ok_or(AdbError::NoDevice)?;
    Ok(serial.to_string())
}

fn candidate_log_paths(package_name: &str) -> Vec<(String, String)> {
    let package_leaf = package_name.rsplit('.').next().unwrap_or(package_name);
    let mut paths = vec![
        (
            format!("/storage/emulated/0/Documents/cozyla/logs/{package_name}"),
            "cozyla-package".to_string(),
        ),
        (
            format!("/storage/emulated/0/Documents/cozyla/logs/{package_leaf}"),
            "cozyla-leaf".to_string(),
        ),
        (
            format!("/storage/emulated/0/Android/data/{package_name}/files/logs"),
            "app-external".to_string(),
        ),
        (
            format!("/storage/emulated/0/Android/data/{package_name}/files/Logs"),
            "app-external".to_string(),
        ),
        (
            format!("/storage/emulated/0/Android/media/{package_name}/logs"),
            "app-media".to_string(),
        ),
    ];
    paths.dedup_by(|left, right| left.0 == right.0);
    paths
}

fn remote_path_exists(app: &AppHandle, serial: &str, path: &str) -> Result<bool, AdbError> {
    let output = adb::run_adb(app, &["shell", "ls", "-d", path], Some(serial))?;
    Ok(output.status.success())
}

fn remote_directory_entries(
    app: &AppHandle,
    serial: &str,
    path: &str,
) -> Result<Vec<String>, AdbError> {
    let output = adb::run_adb(app, &["shell", "ls", "-1", path], Some(serial))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && *entry != "." && *entry != "..")
        .map(ToString::to_string)
        .collect())
}

fn matches_package_log_name(entry: &str, package_name: &str) -> bool {
    let normalize = |value: &str| {
        value
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let entry = normalize(entry);
    let package = normalize(package_name);
    let package_leaf = normalize(package_name.rsplit('.').next().unwrap_or(package_name));
    entry == package || entry == package_leaf
}

fn dedupe_log_candidates(candidates: &mut Vec<LogPathCandidate>) {
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.path.clone()));
}

fn validate_remote_log_path(value: &str) -> Result<String, AdbError> {
    if !value.starts_with('/')
        || value.starts_with("/-")
        || value.contains('\n')
        || value.contains('\r')
    {
        return Err(AdbError::CommandFailed(
            t!("package.log_path_invalid").into_owned(),
        ));
    }
    Ok(value.to_string())
}

fn package_logs_dir(app: &AppHandle, package_name: &str) -> Result<PathBuf, AdbError> {
    let downloads = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f");
    let base = downloads
        .join("ADB_Manager")
        .join("AppLogs")
        .join(safe_filename(package_name))
        .join(format!("logs_{timestamp}"));
    Ok(next_available_output_dir(base))
}

fn is_strong_log_candidate(source: &str) -> bool {
    matches!(source, "cozyla-package" | "app-external" | "app-media")
}

fn next_available_output_dir(base: PathBuf) -> PathBuf {
    if !base.exists() {
        return base;
    }

    let parent = base.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = base
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("logs");
    for index in 1.. {
        let candidate = parent.join(format!("{stem}_{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("the output directory suffix range is finite")
}

fn pull_package_logcat(
    app: &AppHandle,
    serial: &str,
    package_name: &str,
    output_dir: &std::path::Path,
    lookback_seconds: Option<u32>,
) -> Result<Option<PackageLogcatCapture>, AdbError> {
    let uid_output = adb::run_adb(
        app,
        &[
            "shell",
            "cmd",
            "package",
            "list",
            "packages",
            "-U",
            package_name,
        ],
        Some(serial),
    )?;
    let uid = if uid_output.status.success() {
        parse_package_uid(&String::from_utf8_lossy(&uid_output.stdout), package_name)
    } else {
        None
    };

    let (scope_arg, scope, mut warnings) = if let Some(uid) = uid {
        let warnings = if uid == "1000" {
            vec![t!("package.logcat_shared_uid_scope", "uid" => uid.clone()).into_owned()]
        } else {
            Vec::new()
        };
        (format!("--uid={uid}"), format!("uid:{uid}"), warnings)
    } else {
        let pid_output = adb::run_adb(app, &["shell", "pidof", package_name], Some(serial))?;
        let pid = String::from_utf8_lossy(&pid_output.stdout)
            .split_whitespace()
            .next()
            .map(ToString::to_string);
        let Some(pid) = pid else {
            return Ok(None);
        };
        (
            format!("--pid={pid}"),
            format!("pid:{pid}"),
            vec![t!("package.logcat_pid_fallback").into_owned()],
        )
    };

    let since = resolve_logcat_since(app, Some(serial), lookback_seconds)?;
    let owned_args = build_logcat_args(
        None,
        0,
        true,
        since.as_deref(),
        Some(scope_arg.as_str()),
        LogcatBufferSet::All,
    );
    let arg_refs = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let log_output =
        adb::run_adb_with_timeout(app, &arg_refs, Some(serial), Duration::from_secs(90))?;
    adb::ensure_success(&log_output, &t!("package.logcat_pull_failed"))?;

    let text = String::from_utf8_lossy(&log_output.stdout);
    let (line_count, source_start, source_end) = logcat_text_bounds(&text);
    let path = output_dir.join("logcat.txt");
    std::fs::write(&path, log_output.stdout)?;
    if line_count == 0 {
        warnings.push(t!("package.logcat_empty_range").into_owned());
    }
    Ok(Some(PackageLogcatCapture {
        path: path.to_string_lossy().to_string(),
        scope,
        line_count,
        source_start,
        source_end,
        warnings,
    }))
}

fn parse_package_uid(output: &str, package_name: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let package = parts.next()?.strip_prefix("package:")?;
        if package != package_name {
            return None;
        }
        parts
            .find_map(|part| part.strip_prefix("uid:"))
            .filter(|uid| !uid.is_empty() && uid.chars().all(|ch| ch.is_ascii_digit()))
            .map(ToString::to_string)
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

    // `dumpsys package packages` can repeat updated system apps: the active
    // /data package appears first and the disabled /system base later. Keep the
    // active entry so the UI does not render duplicate keys or stale row data.
    let mut seen = std::collections::HashSet::new();
    packages.retain(|package| seen.insert(package.name.clone()));

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
    use super::{
        apk_output_file_name, candidate_log_paths, is_strong_log_candidate,
        matches_package_log_name, next_available_output_dir, parse_all_package_details,
        parse_package_uid, parse_pm_paths, safe_filename, validate_remote_log_path,
    };

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
    fn parses_exact_package_uid_for_historical_logcat_scope() {
        let output = "package:com.cozyla.calendar uid:10123\npackage:com.cozyla.id uid:1000\n";

        assert_eq!(
            parse_package_uid(output, "com.cozyla.id"),
            Some("1000".to_string())
        );
        assert_eq!(parse_package_uid(output, "com.cozyla.missing"), None);
    }

    #[test]
    fn package_details_keep_the_active_updated_system_app_only_once() {
        let output = "\
  Package [com.cozyla.id] (active):
    versionCode=2026071417 minSdk=28 targetSdk=36
    versionName=1.0.0.2026071417
  Package [com.cozyla.calendar] (calendar):
    versionCode=2026073011 minSdk=33 targetSdk=36
    versionName=1.2.5.2026073011
  Package [com.cozyla.id] (disabled-system-base):
    versionCode=2026033011 minSdk=28 targetSdk=36
    versionName=1.0.0.2026033011
";

        let packages = parse_all_package_details(output, "SERIAL", "BUILD");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].name, "com.cozyla.id");
        assert_eq!(packages[0].version_code, "2026071417");
        assert_eq!(packages[1].name, "com.cozyla.calendar");
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

    #[test]
    fn proposes_standard_and_cozyla_log_locations() {
        let paths = candidate_log_paths("com.cozyla.parentallock");
        let values = paths.iter().map(|(path, _)| path).collect::<Vec<_>>();

        assert!(values.iter().any(|path| {
            path.as_str() == "/storage/emulated/0/Documents/cozyla/logs/com.cozyla.parentallock"
        }));
        assert!(values
            .iter()
            .any(|path| path.as_str() == "/storage/emulated/0/Documents/cozyla/logs/parentallock"));
        assert!(values.iter().any(|path| {
            path.as_str() == "/storage/emulated/0/Android/data/com.cozyla.parentallock/files/logs"
        }));
    }

    #[test]
    fn matches_cozyla_log_directory_by_package_leaf() {
        assert!(matches_package_log_name(
            "parentallock",
            "com.cozyla.parentallock"
        ));
        assert!(matches_package_log_name(
            "com.cozyla.parentallock",
            "com.cozyla.parentallock"
        ));
        assert!(!matches_package_log_name(
            "calendar",
            "com.cozyla.parentallock"
        ));
    }

    #[test]
    fn only_full_package_log_matches_are_eligible_for_automatic_selection() {
        assert!(is_strong_log_candidate("cozyla-package"));
        assert!(is_strong_log_candidate("app-external"));
        assert!(!is_strong_log_candidate("cozyla-leaf"));
        assert!(!is_strong_log_candidate("cozyla-match"));
    }

    #[test]
    fn requires_absolute_manual_log_paths() {
        assert_eq!(
            validate_remote_log_path("/storage/emulated/0/Documents/logs").unwrap(),
            "/storage/emulated/0/Documents/logs"
        );
        assert!(validate_remote_log_path("relative/logs").is_err());
        assert!(validate_remote_log_path("/-not-a-safe-path").is_err());
    }

    #[test]
    fn avoids_existing_output_directories() {
        let base = std::env::temp_dir().join(format!(
            "adb-manager-package-log-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let base_name = base.file_name().unwrap().to_string_lossy().to_string();
        let next = next_available_output_dir(base.clone());
        assert_ne!(next, base);
        assert!(next
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(&format!("{base_name}_")));
        std::fs::remove_dir_all(&base).unwrap();
    }
}
