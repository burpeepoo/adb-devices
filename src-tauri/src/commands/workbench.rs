use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

const DEFAULT_TIMEOUT_SECONDS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkbenchRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Serialize)]
pub struct WorkbenchCommandResult {
    pub command: String,
    pub risk: WorkbenchRisk,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command(async)]
pub fn adb_workbench_execute(
    app: AppHandle,
    command: String,
    device_serial: Option<String>,
    allow_high_risk: Option<bool>,
) -> Result<WorkbenchCommandResult, AdbError> {
    let args = parse_adb_subcommand(&command)
        .map_err(|message| AdbError::CommandFailed(message.to_string()))?;
    let risk = classify_risk(&args);

    if risk == WorkbenchRisk::High && !allow_high_risk.unwrap_or(false) {
        return Err(AdbError::CommandFailed(
            "High-risk command requires confirmation".to_string(),
        ));
    }

    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = adb::run_adb_with_timeout(
        &app,
        &arg_refs,
        device_serial
            .as_deref()
            .filter(|serial| !serial.trim().is_empty()),
        Duration::from_secs(DEFAULT_TIMEOUT_SECONDS),
    )?;

    Ok(WorkbenchCommandResult {
        command: build_command_preview(
            &args,
            device_serial
                .as_deref()
                .map(str::trim)
                .filter(|serial| !serial.is_empty()),
        ),
        risk,
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn parse_adb_subcommand(input: &str) -> Result<Vec<String>, &'static str> {
    let mut args = split_command_line(input.trim())?;
    if args.is_empty() {
        return Err("Command is empty");
    }

    if args
        .first()
        .is_some_and(|arg| arg == "adb" || arg.ends_with("/adb") || arg.ends_with("\\adb.exe"))
    {
        args.remove(0);
    }

    let mut normalized = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "-s" {
            index += 2;
            continue;
        }
        if let Some(serial) = arg.strip_prefix("-s") {
            if !serial.is_empty() {
                index += 1;
                continue;
            }
        }
        if arg == "devices" || arg == "version" || arg == "help" {
            normalized.push(arg.clone());
            index += 1;
            continue;
        }
        normalized.push(arg.clone());
        index += 1;
    }

    if normalized.is_empty() {
        Err("Command has no ADB arguments")
    } else {
        Ok(normalized)
    }
}

fn split_command_line(input: &str) -> Result<Vec<String>, &'static str> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match (quote, ch) {
            (Some(active), c) if c == active => quote = None,
            (Some(_), '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                } else {
                    current.push('\\');
                }
            }
            (Some(_), c) => current.push(c),
            (None, '"' | '\'') => quote = Some(ch),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            (None, '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                } else {
                    current.push('\\');
                }
            }
            (None, c) => current.push(c),
        }
    }

    if quote.is_some() {
        return Err("Command has an unclosed quote");
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

fn classify_risk(args: &[String]) -> WorkbenchRisk {
    if args.is_empty() {
        return WorkbenchRisk::Low;
    }

    let lower = args
        .iter()
        .map(|arg| arg.to_lowercase())
        .collect::<Vec<_>>();
    let joined = lower.join(" ");

    if joined.contains(" rm ")
        || joined.starts_with("shell rm ")
        || joined.contains(" dd ")
        || joined.starts_with("shell dd ")
        || lower
            .iter()
            .any(|arg| arg == "reboot" || arg == "uninstall")
        || lower
            .windows(3)
            .any(|window| window == ["shell", "pm", "clear"])
        || lower.windows(2).any(|window| window == ["pm", "clear"])
    {
        return WorkbenchRisk::High;
    }

    if lower
        .windows(2)
        .any(|window| window == ["shell", "setprop"])
        || lower
            .windows(3)
            .any(|window| window[0] == "shell" && window[1] == "settings" && window[2] == "put")
        || lower
            .windows(2)
            .any(|window| window == ["am", "force-stop"])
        || lower
            .windows(3)
            .any(|window| window == ["shell", "am", "force-stop"])
        || lower
            .iter()
            .any(|arg| arg == "grant" || arg == "revoke" || arg == "install" || arg == "push")
    {
        return WorkbenchRisk::Medium;
    }

    WorkbenchRisk::Low
}

fn build_command_preview(args: &[String], device_serial: Option<&str>) -> String {
    let mut parts = vec!["adb".to_string()];
    if let Some(serial) = device_serial {
        parts.push("-s".to_string());
        parts.push(shell_quote(serial));
    }
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '='))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_adb_subcommand_without_adb_prefix() {
        let args =
            parse_adb_subcommand(r#"shell am start -n "com.example/.Main Activity""#).unwrap();

        assert_eq!(
            args,
            vec!["shell", "am", "start", "-n", "com.example/.Main Activity"]
        );
    }

    #[test]
    fn strips_adb_binary_and_existing_device_selector() {
        let args =
            parse_adb_subcommand("adb -s 192.168.110.69:36217 shell getprop ro.product.model")
                .unwrap();

        assert_eq!(args, vec!["shell", "getprop", "ro.product.model"]);
    }

    #[test]
    fn flags_destructive_shell_commands_as_high_risk() {
        let args = parse_adb_subcommand("shell pm clear com.example.app").unwrap();

        assert_eq!(classify_risk(&args), WorkbenchRisk::High);
    }

    #[test]
    fn flags_install_and_push_as_medium_risk() {
        let install_args = parse_adb_subcommand("install -r /tmp/app.apk").unwrap();
        let push_args =
            parse_adb_subcommand("push /tmp/file.txt /sdcard/Download/file.txt").unwrap();

        assert_eq!(classify_risk(&install_args), WorkbenchRisk::Medium);
        assert_eq!(classify_risk(&push_args), WorkbenchRisk::Medium);
    }

    #[test]
    fn builds_preview_with_selected_device() {
        let args = parse_adb_subcommand("shell getprop ro.build.version.release").unwrap();

        assert_eq!(
            build_command_preview(&args, Some("abc123")),
            "adb -s abc123 shell getprop ro.build.version.release"
        );
    }
}
