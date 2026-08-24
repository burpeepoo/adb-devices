use rust_i18n::t;
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::thread;

use chrono::{Duration as ChronoDuration, NaiveDateTime};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb::{self, AdbError};
use crate::process;
use crate::state::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct LogcatEntry {
    pub timestamp: String,
    pub level: String,
    pub pid: String,
    pub tag: String,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct LogcatSnapshot {
    pub entries: Vec<LogcatEntry>,
    pub total_lines: usize,
    pub truncated: bool,
    pub time_range_requested: bool,
    pub requested_lookback_seconds: Option<u32>,
    pub requested_filter: String,
    pub source_start: Option<String>,
    pub source_end: Option<String>,
}

const DEFAULT_LINE_LIMIT: u16 = 800;
const MAX_SNAPSHOT_ENTRIES: u16 = 20_000;
pub(crate) const MAX_LOOKBACK_SECONDS: u32 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogcatBufferSet {
    MainSystemCrash,
    All,
}

#[tauri::command(async)]
pub fn adb_read_logcat(
    app: AppHandle,
    device_serial: Option<String>,
    logcat_filter: Option<String>,
    line_limit: Option<u16>,
    lookback_seconds: Option<u32>,
) -> Result<LogcatSnapshot, AdbError> {
    let time_range_requested = lookback_seconds.is_some();
    let requested_lookback_seconds = normalize_lookback_seconds(lookback_seconds);
    let since = if time_range_requested {
        resolve_logcat_since(&app, device_serial.as_deref(), requested_lookback_seconds)?
    } else {
        None
    };
    let display_limit = line_limit
        .unwrap_or(DEFAULT_LINE_LIMIT)
        .clamp(100, MAX_SNAPSHOT_ENTRIES) as usize;
    let requested_filter = effective_logcat_filter(logcat_filter.as_deref());
    let owned_args = build_logcat_args(
        logcat_filter.as_deref(),
        display_limit,
        time_range_requested,
        since.as_deref(),
        None,
        LogcatBufferSet::MainSystemCrash,
    );

    let arg_refs = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = adb::run_adb(&app, &arg_refs, device_serial.as_deref())?;
    adb::ensure_success(&output, &t!("logcat.read_failed"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = stdout.lines().map(parse_logcat_line).collect::<Vec<_>>();
    let total_lines = entries.len();
    let (source_start, source_end) = entry_time_bounds(&entries);
    let truncated = time_range_requested && total_lines > display_limit;
    if truncated {
        entries = entries.split_off(total_lines - display_limit);
    }

    Ok(LogcatSnapshot {
        entries,
        total_lines,
        truncated,
        time_range_requested,
        requested_lookback_seconds,
        requested_filter,
        source_start,
        source_end,
    })
}

#[tauri::command(async)]
pub fn adb_start_logcat(
    app: AppHandle,
    state: State<'_, AppState>,
    device_serial: Option<String>,
    logcat_filter: Option<String>,
) -> Result<String, AdbError> {
    {
        let mut process = state
            .logcat_process
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("logcat.state_error").into_owned()))?;
        if let Some(child) = process.as_mut() {
            if child.try_wait()?.is_none() {
                return Err(AdbError::CommandFailed(
                    t!("logcat.already_running").into_owned(),
                ));
            }
            *process = None;
        }
    }

    let adb_path = adb::get_adb_path(&app)?;
    let mut command = process::hidden_command(adb_path);
    if let Some(serial) = device_serial.as_deref() {
        command.args(["-s", serial]);
    }
    command.args([
        "logcat",
        "-b",
        "main",
        "-b",
        "system",
        "-b",
        "crash",
        "-v",
        "threadtime",
    ]);
    let mut filter_args = Vec::new();
    append_filter_args(&mut filter_args, logcat_filter.as_deref());
    command.args(filter_args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    adb::prepare_adb_command(&mut command);

    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit("adb-logcat-line", parse_logcat_line(&line));
            }
        });
    }

    if let Some(err) = stderr {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit(
                    "adb-logcat-line",
                    LogcatEntry {
                        timestamp: String::new(),
                        level: "E".to_string(),
                        pid: String::new(),
                        tag: "adb".to_string(),
                        message: line,
                    },
                );
            }
        });
    }

    {
        let mut process = state
            .logcat_process
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("logcat.state_error").into_owned()))?;
        *process = Some(child);
    }
    {
        let mut active_device = state
            .logcat_device
            .lock()
            .map_err(|_| AdbError::CommandFailed(t!("logcat.state_error").into_owned()))?;
        *active_device = device_serial;
    }

    Ok(t!("logcat.started").to_string())
}

#[tauri::command(async)]
pub fn adb_stop_logcat(state: State<'_, AppState>) -> Result<String, AdbError> {
    let mut process = state
        .logcat_process
        .lock()
        .map_err(|_| AdbError::CommandFailed(t!("logcat.state_error").into_owned()))?;

    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(mut active_device) = state.logcat_device.lock() {
            *active_device = None;
        }
        Ok(t!("logcat.closed").to_string())
    } else {
        Ok(t!("logcat.not_running").to_string())
    }
}

#[tauri::command]
pub async fn export_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, AdbError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;

        let path = app
            .dialog()
            .file()
            .set_title(t!("logcat.export_title").to_string())
            .set_file_name(&default_name)
            .blocking_save_file();

        if let Some(path) = path {
            let path_string = path.to_string();
            std::fs::write(&path_string, content)?;
            Ok(Some(path_string))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| {
        AdbError::CommandFailed(t!("logcat.export_failed", "message" => e.to_string()).into_owned())
    })?
}

fn append_filter_args(args: &mut Vec<String>, logcat_filter: Option<&str>) {
    if let Some(filter) = logcat_filter
        .map(str::trim)
        .filter(|filter| !filter.is_empty())
    {
        args.extend(filter.split_whitespace().map(ToString::to_string));
    } else {
        // Make verbose/debug native tags explicit instead of inheriting a host
        // ANDROID_LOG_TAGS value that could silently hide entries such as tls-handler.
        args.push("*:V".to_string());
    }
}

fn effective_logcat_filter(logcat_filter: Option<&str>) -> String {
    logcat_filter
        .map(str::trim)
        .filter(|filter| !filter.is_empty())
        .unwrap_or("*:V")
        .to_string()
}

pub(crate) fn normalize_lookback_seconds(value: Option<u32>) -> Option<u32> {
    value.and_then(|seconds| {
        if seconds == 0 {
            None
        } else {
            Some(seconds.clamp(60, MAX_LOOKBACK_SECONDS))
        }
    })
}

pub(crate) fn resolve_logcat_since(
    app: &AppHandle,
    device_serial: Option<&str>,
    lookback_seconds: Option<u32>,
) -> Result<Option<String>, AdbError> {
    let Some(lookback_seconds) = lookback_seconds else {
        return Ok(None);
    };

    let output = adb::run_adb(app, &["shell", "date", "+%Y-%m-%dT%H:%M:%S"], device_serial)?;
    adb::ensure_success(&output, &t!("logcat.device_time_failed"))?;
    let device_now = String::from_utf8_lossy(&output.stdout);
    format_logcat_since(device_now.trim(), lookback_seconds)
        .map(Some)
        .map_err(AdbError::CommandFailed)
}

pub(crate) fn build_logcat_args(
    logcat_filter: Option<&str>,
    line_limit: usize,
    time_range_requested: bool,
    since: Option<&str>,
    scope_filter: Option<&str>,
    buffers: LogcatBufferSet,
) -> Vec<String> {
    let mut args = vec!["logcat".to_string()];
    match buffers {
        LogcatBufferSet::MainSystemCrash => args.extend([
            "-b".to_string(),
            "main".to_string(),
            "-b".to_string(),
            "system".to_string(),
            "-b".to_string(),
            "crash".to_string(),
        ]),
        LogcatBufferSet::All => args.extend(["-b".to_string(), "all".to_string()]),
    }
    if let Some(scope_filter) = scope_filter {
        args.push(scope_filter.to_string());
    }
    args.extend(["-d".to_string(), "-v".to_string(), "threadtime".to_string()]);
    if time_range_requested {
        if let Some(since) = since {
            args.extend(["-T".to_string(), since.to_string()]);
        }
    } else {
        args.extend(["-t".to_string(), line_limit.to_string()]);
    }
    append_filter_args(&mut args, logcat_filter);
    args
}

fn format_logcat_since(device_now: &str, lookback_seconds: u32) -> Result<String, String> {
    let device_now = NaiveDateTime::parse_from_str(device_now, "%Y-%m-%dT%H:%M:%S")
        .map_err(|error| format!("Invalid device time '{device_now}': {error}"))?;
    let since = device_now - ChronoDuration::seconds(i64::from(lookback_seconds));
    Ok(since.format("%Y-%m-%d %H:%M:%S.000").to_string())
}

pub(crate) fn logcat_text_bounds(text: &str) -> (usize, Option<String>, Option<String>) {
    let entries = text.lines().map(parse_logcat_line).collect::<Vec<_>>();
    let count = entries.len();
    let (start, end) = entry_time_bounds(&entries);
    (count, start, end)
}

fn entry_time_bounds(entries: &[LogcatEntry]) -> (Option<String>, Option<String>) {
    let mut timestamps = entries
        .iter()
        .map(|entry| entry.timestamp.trim())
        .filter(|timestamp| !timestamp.is_empty());
    let start = timestamps.next().map(ToString::to_string);
    let end = timestamps
        .last()
        .map(ToString::to_string)
        .or_else(|| start.clone());
    (start, end)
}

fn parse_logcat_line(line: &str) -> LogcatEntry {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() >= 6 {
        let rest = parts[5..].join(" ");
        let (tag, message) = rest
            .split_once(':')
            .map(|(tag, message)| (tag.trim().to_string(), message.trim_start().to_string()))
            .unwrap_or_else(|| (String::new(), rest));
        return LogcatEntry {
            timestamp: format!("{} {}", parts[0], parts[1]),
            pid: parts[2].to_string(),
            level: parts[4].to_string(),
            tag,
            message,
        };
    }

    LogcatEntry {
        timestamp: String::new(),
        level: String::new(),
        pid: String::new(),
        tag: String::new(),
        message: line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_logcat_args, effective_logcat_filter, format_logcat_since, logcat_text_bounds,
        normalize_lookback_seconds, parse_logcat_line, LogcatBufferSet, MAX_LOOKBACK_SECONDS,
    };

    #[test]
    fn time_range_uses_device_timestamp_instead_of_line_tail() {
        let args = build_logcat_args(
            None,
            10_000,
            true,
            Some("2026-08-05 15:00:00.000"),
            None,
            LogcatBufferSet::MainSystemCrash,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["-T", "2026-08-05 15:00:00.000"]));
        assert!(!args.iter().any(|arg| arg == "-t"));
        assert_eq!(args.last().map(String::as_str), Some("*:V"));
    }

    #[test]
    fn line_tail_remains_available_for_bounded_agent_snapshots() {
        let args = build_logcat_args(
            Some("*:W"),
            400,
            false,
            None,
            None,
            LogcatBufferSet::MainSystemCrash,
        );

        assert!(args.windows(2).any(|pair| pair == ["-t", "400"]));
        assert_eq!(args.last().map(String::as_str), Some("*:W"));
    }

    #[test]
    fn package_history_scope_keeps_all_buffers_uid_time_and_verbose_levels() {
        let args = build_logcat_args(
            None,
            0,
            true,
            Some("2026-08-05 10:00:00.000"),
            Some("--uid=1000"),
            LogcatBufferSet::All,
        );

        assert!(args.windows(2).any(|pair| pair == ["-b", "all"]));
        assert!(args.iter().any(|arg| arg == "--uid=1000"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-T", "2026-08-05 10:00:00.000"]));
        assert!(!args.iter().any(|arg| arg == "-t"));
        assert_eq!(args.last().map(String::as_str), Some("*:V"));
    }

    #[test]
    fn formats_lookback_from_device_wall_clock_across_day_boundary() {
        assert_eq!(
            format_logcat_since("2026-08-05T00:05:00", 15 * 60).unwrap(),
            "2026-08-04 23:50:00.000"
        );
    }

    #[test]
    fn preserves_the_previous_year_for_a_cross_year_lookback() {
        assert_eq!(
            format_logcat_since("2027-01-01T00:05:00", 15 * 60).unwrap(),
            "2026-12-31 23:50:00.000"
        );
    }

    #[test]
    fn normalizes_custom_lookback_and_all_buffer_selection() {
        assert_eq!(normalize_lookback_seconds(Some(0)), None);
        assert_eq!(normalize_lookback_seconds(Some(1)), Some(60));
        assert_eq!(
            normalize_lookback_seconds(Some(MAX_LOOKBACK_SECONDS + 1)),
            Some(MAX_LOOKBACK_SECONDS)
        );
    }

    #[test]
    fn reports_the_effective_filter_used_for_snapshot_evidence() {
        assert_eq!(effective_logcat_filter(None), "*:V");
        assert_eq!(
            effective_logcat_filter(Some("  tls-handler:V *:S  ")),
            "tls-handler:V *:S"
        );
    }

    #[test]
    fn parses_verbose_native_tls_tags_and_reports_time_bounds() {
        let first = "08-05 14:47:10.123 15159 15291 V tls-handler: bytes written";
        let second = "08-05 14:47:11.456 15159 15291 D channel-bootstrap: tls negotiated";
        let entry = parse_logcat_line(first);

        assert_eq!(entry.level, "V");
        assert_eq!(entry.tag, "tls-handler");
        assert_eq!(entry.message, "bytes written");
        assert_eq!(
            logcat_text_bounds(&format!("{first}\n{second}\n")),
            (
                2,
                Some("08-05 14:47:10.123".to_string()),
                Some("08-05 14:47:11.456".to_string())
            )
        );
    }
}
