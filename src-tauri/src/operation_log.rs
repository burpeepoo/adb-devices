use crate::state::{AppState, OperationLogEntry};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Output;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const OPERATION_LOG_UPDATED_EVENT: &str = "operation-log-updated";
pub const OPERATION_LOG_CLEARED_EVENT: &str = "operation-log-cleared";
pub const OPERATION_LOG_PERSISTENCE_ERROR_EVENT: &str = "operation-log-persistence-error";

const MAX_ENTRIES: usize = 2_000;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const COMPACTION_TARGET_BYTES: u64 = MAX_FILE_BYTES * 3 / 4;
const MAX_OUTPUT_CHARS: usize = 4_000;

#[derive(Debug, Serialize, Clone)]
pub struct OperationLogSnapshot {
    pub entries: Vec<OperationLogEntry>,
    pub path: Option<String>,
    pub persistence_error: Option<String>,
    pub oldest_id: Option<u64>,
    pub latest_id: Option<u64>,
}

pub fn record_adb_result(
    app: &AppHandle,
    args: &[&str],
    device_serial: Option<&str>,
    duration: Duration,
    status: &str,
    output: Option<&Output>,
    error: Option<&str>,
) {
    let (action, command) = format_adb_command(args, device_serial);
    let sensitive = args
        .first()
        .is_some_and(|value| value.eq_ignore_ascii_case("pair"))
        || has_command_sequence(args, &["input", "text"])
        || has_command_sequence(args, &["clipboard", "set"]);
    let redact_payload_output = has_command_sequence(args, &["input", "text"])
        || has_command_sequence(args, &["clipboard", "set"]);
    let redact_binary_stdout = is_binary_output_command(args);
    let stdout = output
        .map(|value| String::from_utf8_lossy(&value.stdout).to_string())
        .unwrap_or_default();
    let stderr = output
        .map(|value| String::from_utf8_lossy(&value.stderr).to_string())
        .unwrap_or_default();
    record(
        app,
        action,
        device_serial,
        command,
        status,
        duration,
        &stdout,
        &stderr,
        error,
        sensitive,
        redact_payload_output,
        redact_binary_stdout,
    );
}

pub fn record_event(
    app: &AppHandle,
    action: &str,
    device_serial: Option<&str>,
    command: &str,
    status: &str,
    duration: Duration,
    detail: &str,
) {
    let (stdout, stderr, error) = if matches!(status, "success" | "started" | "info") {
        (detail, "", None)
    } else {
        ("", detail, Some(detail))
    };
    record(
        app,
        action.to_string(),
        device_serial,
        command.to_string(),
        status,
        duration,
        stdout,
        stderr,
        error,
        false,
        false,
        false,
    );
}

pub fn record_process_result(
    app: &AppHandle,
    action: String,
    device_serial: Option<&str>,
    command: String,
    status: &str,
    duration: Duration,
    stdout: &str,
    stderr: &str,
    error: Option<&str>,
    sensitive: bool,
) {
    record(
        app,
        action,
        device_serial,
        command,
        status,
        duration,
        stdout,
        stderr,
        error,
        sensitive,
        false,
        false,
    );
}

pub fn snapshot(app: &AppHandle, limit: Option<usize>) -> OperationLogSnapshot {
    let state = app.state::<AppState>();
    let Ok(mut log) = state.operation_log.lock() else {
        return OperationLogSnapshot {
            entries: Vec::new(),
            path: operation_log_path(app).map(|path| path.to_string_lossy().to_string()),
            persistence_error: Some("operation log state is unavailable".to_string()),
            oldest_id: None,
            latest_id: None,
        };
    };
    ensure_loaded(app, &mut log);
    let count = limit.unwrap_or(300).clamp(1, MAX_ENTRIES);
    let start = log.entries.len().saturating_sub(count);
    OperationLogSnapshot {
        entries: log.entries[start..].to_vec(),
        path: operation_log_path(app).map(|path| path.to_string_lossy().to_string()),
        persistence_error: log.persistence_error.clone(),
        oldest_id: log.entries.get(start).map(|entry| entry.id),
        latest_id: log.entries.last().map(|entry| entry.id),
    }
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut log = state
        .operation_log
        .lock()
        .map_err(|_| "operation log state is unavailable".to_string())?;
    ensure_loaded(app, &mut log);
    if let Some(path) = operation_log_path(app) {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let message = error.to_string();
                log.persistence_error = Some(message.clone());
                let _ = app.emit(OPERATION_LOG_PERSISTENCE_ERROR_EVENT, Some(message.clone()));
                return Err(message);
            }
        }
    }
    log.entries.clear();
    log.next_id = 1;
    log.persistence_error = None;
    log.persistence_dirty = false;
    let _ = app.emit(OPERATION_LOG_CLEARED_EVENT, ());
    let _ = app.emit(
        OPERATION_LOG_PERSISTENCE_ERROR_EVENT,
        Option::<String>::None,
    );
    drop(log);
    Ok(())
}

pub fn format_adb_command(args: &[&str], device_serial: Option<&str>) -> (String, String) {
    let action = match args.first().copied() {
        Some(first) => format!("adb {}", truncate(first)),
        None => "adb".to_string(),
    };
    let mut parts = vec!["adb".to_string()];
    if let Some(serial) = device_serial.filter(|value| !value.trim().is_empty()) {
        parts.push("-s".to_string());
        parts.push(truncate(serial.trim()));
    }
    for (index, arg) in args.iter().enumerate() {
        if should_redact_arg(args, index) {
            parts.push("<redacted>".to_string());
        } else {
            let redacted_arg = redact_sensitive_fields(arg);
            parts.push(shell_display_arg(&redacted_arg));
        }
    }
    // Workbench commands may carry an entire shell expression in one arg;
    // apply field redaction after display quoting as a final safety net.
    (action, truncate(&redact_sensitive_fields(&parts.join(" "))))
}

fn record(
    app: &AppHandle,
    action: String,
    device_serial: Option<&str>,
    command: String,
    status: &str,
    duration: Duration,
    stdout: &str,
    stderr: &str,
    error: Option<&str>,
    sensitive: bool,
    redact_payload_output: bool,
    redact_binary_stdout: bool,
) {
    let state = app.state::<AppState>();
    let Ok(mut log) = state.operation_log.lock() else {
        return;
    };
    ensure_loaded(app, &mut log);
    if log.next_id == 0 {
        log.next_id = log
            .entries
            .iter()
            .map(|entry| entry.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
    }
    let entry = OperationLogEntry {
        id: log.next_id,
        timestamp_ms: now_ms(),
        action: truncate(&action),
        device_serial: device_serial
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(truncate),
        command: truncate(&command),
        status: status.to_string(),
        duration_ms: duration.as_millis().min(u128::from(u64::MAX)) as u64,
        stdout: sanitize_record_output(
            stdout,
            sensitive,
            redact_payload_output || redact_binary_stdout,
        ),
        stderr: sanitize_record_output(stderr, sensitive, redact_payload_output),
        error: error.map(|value| sanitize_record_output(value, sensitive, redact_payload_output)),
    };
    log.next_id = log.next_id.saturating_add(1);
    log.entries.push(entry.clone());
    if log.entries.len() > MAX_ENTRIES {
        let remove_count = log.entries.len() - MAX_ENTRIES;
        log.entries.drain(0..remove_count);
    }
    let byte_trimmed = trim_entries_to_file_budget(&mut log.entries);
    let rewrite = byte_trimmed || log.persistence_dirty;
    match persist_entries(app, &mut log.entries, &entry, rewrite) {
        Ok(()) => {
            log.persistence_error = None;
            log.persistence_dirty = false;
        }
        Err(error) => {
            log.persistence_error = Some(error);
            log.persistence_dirty = true;
        }
    }
    let persistence_error = log.persistence_error.clone();
    let _ = app.emit(OPERATION_LOG_UPDATED_EVENT, entry);
    let _ = app.emit(OPERATION_LOG_PERSISTENCE_ERROR_EVENT, persistence_error);
    drop(log);
}

fn ensure_loaded(app: &AppHandle, log: &mut crate::state::OperationLogState) {
    if log.loaded {
        return;
    }
    log.loaded = true;
    let Some(path) = operation_log_path(app) else {
        log.next_id = 1;
        return;
    };
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            log.next_id = 1;
            return;
        }
        Err(error) => {
            log.persistence_error = Some(error.to_string());
            log.persistence_dirty = true;
            log.next_id = 1;
            return;
        }
    };
    let mut invalid_lines = false;
    log.entries = contents
        .lines()
        .filter_map(
            |line| match serde_json::from_str::<OperationLogEntry>(line) {
                Ok(entry) => Some(entry),
                Err(_) => {
                    invalid_lines = true;
                    None
                }
            },
        )
        .collect();
    if invalid_lines {
        log.persistence_error = Some("operation log contains invalid records".to_string());
        log.persistence_dirty = true;
    }
    let count_trimmed = if log.entries.len() > MAX_ENTRIES {
        let remove_count = log.entries.len() - MAX_ENTRIES;
        log.entries.drain(0..remove_count);
        true
    } else {
        false
    };
    let byte_trimmed = trim_entries_to_file_budget(&mut log.entries);
    if count_trimmed || byte_trimmed {
        if let Err(error) = rewrite_entries(app, &log.entries) {
            log.persistence_error = Some(error);
            log.persistence_dirty = true;
        } else {
            log.persistence_dirty = false;
        }
    }
    log.next_id = log
        .entries
        .iter()
        .map(|entry| entry.id)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
}

fn persist_entries(
    app: &AppHandle,
    entries: &mut Vec<OperationLogEntry>,
    entry: &OperationLogEntry,
    rewrite: bool,
) -> Result<(), String> {
    let Some(path) = operation_log_path(app) else {
        return Err("operation log path is unavailable".to_string());
    };
    let Some(parent) = path.parent() else {
        return Err("operation log parent path is unavailable".to_string());
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let line = serde_json::to_string(entry).map_err(|error| error.to_string())?;
    let current_bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if current_bytes.saturating_add(line.len() as u64 + 1) > MAX_FILE_BYTES {
        // Leave enough headroom for a batch of later entries. Without this
        // compaction target, a full JSONL file would be rewritten on every
        // subsequent event.
        trim_entries_to_budget(entries, COMPACTION_TARGET_BYTES);
        return rewrite_entries(app, entries);
    }
    if rewrite {
        return rewrite_entries(app, entries);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

fn rewrite_entries(app: &AppHandle, entries: &[OperationLogEntry]) -> Result<(), String> {
    let Some(path) = operation_log_path(app) else {
        return Err("operation log path is unavailable".to_string());
    };
    let Some(parent) = path.parent() else {
        return Err("operation log parent path is unavailable".to_string());
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut contents = String::new();
    for item in entries {
        let line = serde_json::to_string(item).map_err(|error| error.to_string())?;
        contents.push_str(&line);
        contents.push('\n');
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("operation-log.jsonl");
    let temporary_path = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        now_ms()
    ));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        replace_operation_log_file(&temporary_path, &path).map_err(|error| error.to_string())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn replace_operation_log_file(
    temporary_path: &std::path::Path,
    path: &std::path::Path,
) -> Result<(), std::io::Error> {
    match fs::rename(temporary_path, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            #[cfg(windows)]
            {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    // Windows does not replace an existing destination with
                    // rename. The temp file is fully synced before this
                    // fallback, so the only non-atomic portion is the short
                    // destination replacement window.
                    fs::remove_file(path)?;
                    return fs::rename(temporary_path, path);
                }
            }
            Err(error)
        }
    }
}

fn trim_entries_to_file_budget(entries: &mut Vec<OperationLogEntry>) -> bool {
    trim_entries_to_budget(entries, MAX_FILE_BYTES)
}

fn trim_entries_to_budget(entries: &mut Vec<OperationLogEntry>, budget: u64) -> bool {
    let mut total = 0_u64;
    let mut first_kept = entries.len();
    for index in (0..entries.len()).rev() {
        let Ok(line) = serde_json::to_string(&entries[index]) else {
            continue;
        };
        let size = line.len() as u64 + 1;
        if total.saturating_add(size) > budget {
            break;
        }
        total = total.saturating_add(size);
        first_kept = index;
    }
    if first_kept == entries.len() {
        if entries.last().is_some_and(|entry| {
            serde_json::to_string(entry)
                .map(|line| line.len() as u64 + 1 > budget)
                .unwrap_or(true)
        }) {
            entries.clear();
            return true;
        }
        return false;
    }
    if first_kept > 0 {
        entries.drain(0..first_kept);
        true
    } else {
        false
    }
}

fn operation_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("operation-log.jsonl"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn should_redact_arg(args: &[&str], index: usize) -> bool {
    if args
        .first()
        .is_some_and(|value| value.eq_ignore_ascii_case("pair"))
        && index == 2
    {
        return true;
    }
    for terms in [
        ["input", "text"].as_slice(),
        ["clipboard", "set"].as_slice(),
    ] {
        let exact_start = args
            .windows(terms.len())
            .enumerate()
            .find_map(|(start, window)| {
                window
                    .iter()
                    .zip(terms.iter())
                    .all(|(left, right)| left.eq_ignore_ascii_case(right))
                    .then_some(start)
            });
        if let Some(start) = exact_start {
            if index > start + terms.len() - 1 {
                return true;
            }
            continue;
        }
        if normalized_command_sequence(args, terms)
            && args
                .iter()
                .enumerate()
                .any(|(start, arg)| start <= index && inline_command_sequence(arg, &[terms[0]]))
        {
            return true;
        }
    }
    if args.get(index).is_some_and(|arg| {
        let lower = arg.to_ascii_lowercase();
        [
            "--password=",
            "--passwd=",
            "--token=",
            "--code=",
            "--secret=",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    }) {
        return true;
    }
    index > 0
        && matches!(
            args[index - 1],
            "--password" | "--token" | "--code" | "--secret"
        )
}

fn has_command_sequence(args: &[&str], terms: &[&str]) -> bool {
    args.windows(terms.len()).any(|window| {
        window
            .iter()
            .zip(terms.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    }) || normalized_command_sequence(args, terms)
}

fn is_binary_output_command(args: &[&str]) -> bool {
    let has_exec_out = args.iter().any(|arg| arg.eq_ignore_ascii_case("exec-out"))
        || normalized_command_sequence(args, &["exec", "out"]);
    let has_binary_subcommand = args.iter().any(|arg| {
        arg.eq_ignore_ascii_case("screencap") || arg.eq_ignore_ascii_case("screenrecord")
    }) || normalized_command_sequence(args, &["screencap"])
        || normalized_command_sequence(args, &["screenrecord"]);
    has_exec_out && has_binary_subcommand
}

fn normalized_command_sequence(args: &[&str], terms: &[&str]) -> bool {
    inline_command_sequence(&args.join(" "), terms)
}

fn inline_command_sequence(value: &str, terms: &[&str]) -> bool {
    let normalized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>();
    let phrase = terms
        .iter()
        .map(|term| term.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .contains(&phrase)
}

fn shell_display_arg(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ".:/_=-".contains(ch))
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn sanitize_output(value: &str, sensitive: bool) -> String {
    let normalized = value.replace('\0', "");
    let normalized = redact_sensitive_fields(&normalized);
    let normalized = if sensitive {
        redact_numeric_runs(&normalized)
    } else {
        normalized
    };
    truncate(&normalized)
}

fn sanitize_record_output(value: &str, sensitive: bool, redact_payload_output: bool) -> String {
    if redact_payload_output && !value.trim().is_empty() {
        return "<redacted>".to_string();
    }
    sanitize_output(value, sensitive)
}

fn redact_sensitive_fields(value: &str) -> String {
    const KEYS: [&str; 12] = [
        "password",
        "passwd",
        "token",
        "secret",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "pairing_code",
        "client_secret",
    ];
    let lower = value.to_ascii_lowercase();
    let mut ranges = Vec::<(usize, usize)>::new();
    for key in KEYS {
        let mut search = 0;
        while let Some(offset) = lower[search..].find(key) {
            let start = search + offset;
            let end_key = start + key.len();
            let boundary_before =
                start == 0 || !lower.as_bytes()[start - 1].is_ascii_alphanumeric();
            let boundary_after =
                end_key == lower.len() || !lower.as_bytes()[end_key].is_ascii_alphanumeric();
            if boundary_before && boundary_after {
                let mut cursor = end_key;
                while lower
                    .as_bytes()
                    .get(cursor)
                    .is_some_and(|ch| ch.is_ascii_whitespace())
                {
                    cursor += 1;
                }
                if matches!(lower.as_bytes().get(cursor), Some(b'"') | Some(b'\'')) {
                    cursor += 1;
                    while lower
                        .as_bytes()
                        .get(cursor)
                        .is_some_and(|ch| ch.is_ascii_whitespace())
                    {
                        cursor += 1;
                    }
                }
                if matches!(lower.as_bytes().get(cursor), Some(b':') | Some(b'=')) {
                    cursor += 1;
                    while lower
                        .as_bytes()
                        .get(cursor)
                        .is_some_and(|ch| ch.is_ascii_whitespace())
                    {
                        cursor += 1;
                    }
                    let value_start = cursor;
                    if let Some(quote @ (b'"' | b'\'')) = lower.as_bytes().get(cursor).copied() {
                        let content_start = cursor + 1;
                        cursor = content_start;
                        let mut closing_quote = None;
                        while cursor < lower.len() {
                            let ch = lower.as_bytes()[cursor];
                            if ch == b'\\' {
                                cursor += 1;
                                if cursor < lower.len() {
                                    cursor += value[cursor..]
                                        .chars()
                                        .next()
                                        .map(char::len_utf8)
                                        .unwrap_or(1);
                                }
                                continue;
                            }
                            if ch == quote {
                                closing_quote = Some(cursor);
                                break;
                            }
                            cursor += value[cursor..]
                                .chars()
                                .next()
                                .map(char::len_utf8)
                                .unwrap_or(1);
                        }
                        let value_end = closing_quote.unwrap_or(value.len());
                        if value.is_char_boundary(content_start)
                            && value.is_char_boundary(value_end)
                            && value_end > content_start
                        {
                            ranges.push((content_start, value_end));
                        }
                    } else {
                        let is_cookie = key.eq_ignore_ascii_case("cookie");
                        while let Some(ch) = lower.as_bytes().get(cursor).copied() {
                            if (is_cookie && matches!(ch, b'\n' | b'\r' | b'}' | b']'))
                                || (!is_cookie
                                    && matches!(ch, b',' | b';' | b'\n' | b'\r' | b'}' | b']'))
                            {
                                break;
                            }
                            cursor += 1;
                        }
                        let mut value_end = cursor;
                        while value_end > value_start
                            && value.as_bytes()[value_end - 1].is_ascii_whitespace()
                        {
                            value_end -= 1;
                        }
                        if value.is_char_boundary(value_start)
                            && value.is_char_boundary(value_end)
                            && value_end > value_start
                        {
                            ranges.push((value_start, value_end));
                        }
                    }
                }
            }
            search = end_key;
        }
    }
    ranges.sort_unstable();
    let mut merged = Vec::<(usize, usize)>::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    let mut output = value.to_string();
    for (start, end) in merged.into_iter().rev() {
        output.replace_range(start..end, "<redacted>");
    }
    output
}

fn redact_numeric_runs(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut digits = String::new();
    let flush = |result: &mut String, digits: &mut String| {
        if digits.len() >= 6 {
            result.push_str("<redacted>");
        } else {
            result.push_str(digits);
        }
        digits.clear();
    };
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            flush(&mut result, &mut digits);
            result.push(ch);
        }
    }
    flush(&mut result, &mut digits);
    result
}

fn truncate(value: &str) -> String {
    let mut chars = value.chars();
    let output = chars.by_ref().take(MAX_OUTPUT_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{output}\n…[truncated]")
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_command_hides_pairing_code() {
        let (action, command) = format_adb_command(&["pair", "10.0.0.1:12345", "123456"], None);
        assert_eq!(action, "adb pair");
        assert_eq!(command, "adb pair 10.0.0.1:12345 <redacted>");
        let (_, token) = format_adb_command(&["shell", "--token=SECRET"], None);
        assert_eq!(token, "adb shell <redacted>");
    }

    #[test]
    fn input_text_command_hides_text() {
        let (_, command) =
            format_adb_command(&["shell", "input", "text", "secret"], Some("serial"));
        assert_eq!(command, "adb -s serial shell input text <redacted>");
    }

    #[test]
    fn clipboard_and_inline_input_commands_hide_payloads() {
        let (_, clipboard) = format_adb_command(
            &["shell", "cmd", "clipboard", "set", "private clipboard"],
            Some("serial"),
        );
        assert_eq!(
            clipboard,
            "adb -s serial shell cmd clipboard set <redacted>"
        );
        let (_, inline) = format_adb_command(&["shell", "input text private"], None);
        assert_eq!(inline, "adb shell <redacted>");
        let (_, split_inline) = format_adb_command(&["shell", "input", "text private"], None);
        assert_eq!(split_inline, "adb shell <redacted> <redacted>");
        let (_, clipboard_split_inline) =
            format_adb_command(&["shell", "cmd clipboard", "set private"], None);
        assert_eq!(clipboard_split_inline, "adb shell <redacted> <redacted>");
    }

    #[test]
    fn sensitive_fields_are_hidden_from_non_sensitive_outputs() {
        assert_eq!(
            sanitize_output(r#"{"access_token":"abc","password": "secret"}"#, false),
            r#"{"access_token":"<redacted>","password": "<redacted>"}"#
        );
        assert_eq!(
            sanitize_output("password=\"秘密", false),
            "password=\"<redacted>"
        );
        assert_eq!(
            sanitize_record_output("PRIVATE_TEXT", true, true),
            "<redacted>"
        );
        assert_eq!(
            sanitize_output("Cookie: theme=light; session=SECRET", false),
            "Cookie: <redacted>"
        );
        assert_eq!(
            sanitize_record_output(
                "PNG bytes",
                false,
                is_binary_output_command(&["exec-out", "screencap", "-p",])
            ),
            "<redacted>"
        );
    }

    #[test]
    fn embedded_shell_credentials_are_hidden_from_command_preview() {
        let (_, command) = format_adb_command(
            &[
                "shell",
                "am broadcast --es payload '{\"password\":\"REVIEW_SECRET\"}'",
            ],
            None,
        );
        assert!(!command.contains("REVIEW_SECRET"));
        let (_, inline) = format_adb_command(
            &[
                "shell",
                "curl --token=SECRET --header 'Cookie: session=SECRET2'",
            ],
            None,
        );
        assert!(!inline.contains("SECRET"));
        assert!(!inline.contains("SECRET2"));
    }

    #[test]
    fn sensitive_output_hides_long_numeric_runs_and_truncates() {
        let output = sanitize_output("code=123456 and short=123\n", true);
        assert_eq!(output, "code=<redacted> and short=123\n");
        let long = sanitize_output(&"x".repeat(MAX_OUTPUT_CHARS + 1), false);
        assert!(long.ends_with("…[truncated]"));
    }

    #[test]
    fn binary_capture_masks_stdout_but_keeps_error_details() {
        assert_eq!(
            sanitize_record_output("PNG bytes", false, true),
            "<redacted>"
        );
        assert_eq!(
            sanitize_record_output("device offline", false, false),
            "device offline"
        );
    }

    #[test]
    fn rolling_file_budget_keeps_newest_entries_within_limit() {
        let mut entries = (0..1_200)
            .map(|id| OperationLogEntry {
                id,
                timestamp_ms: id,
                action: "adb shell".to_string(),
                device_serial: None,
                command: "adb shell logcat".to_string(),
                status: "success".to_string(),
                duration_ms: 1,
                stdout: "x".repeat(MAX_OUTPUT_CHARS),
                stderr: String::new(),
                error: None,
            })
            .collect::<Vec<_>>();
        assert!(trim_entries_to_file_budget(&mut entries));
        let bytes = entries
            .iter()
            .map(|entry| serde_json::to_string(entry).unwrap().len() as u64 + 1)
            .sum::<u64>();
        assert!(bytes <= MAX_FILE_BYTES);
        assert_eq!(entries.last().map(|entry| entry.id), Some(1_199));
        assert!(entries.len() < 1_200);
    }

    #[test]
    fn oversized_single_entry_is_dropped_from_budgeted_history() {
        let mut entries = vec![OperationLogEntry {
            id: 1,
            timestamp_ms: 1,
            action: "adb".to_string(),
            device_serial: None,
            command: "adb".to_string(),
            status: "failed".to_string(),
            duration_ms: 1,
            stdout: "x".repeat((MAX_FILE_BYTES + 1) as usize),
            stderr: String::new(),
            error: None,
        }];
        assert!(trim_entries_to_budget(&mut entries, MAX_FILE_BYTES));
        assert!(entries.is_empty());
    }
}
