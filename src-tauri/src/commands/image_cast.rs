use chrono::Local;
use rust_i18n::t;
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

use crate::adb::{self, AdbError};

const DEFAULT_REMOTE_DIR: &str = "/sdcard/Pictures/ADBManager";

#[derive(Debug, Serialize)]
pub struct ImageCastResult {
    pub remote_path: String,
    pub mime_type: String,
    pub pushed: bool,
    pub scanned: bool,
    pub opened: bool,
    pub message: String,
}

#[tauri::command(async)]
pub fn adb_push_reference_image(
    app: AppHandle,
    local_path: String,
    device_serial: Option<String>,
    remote_dir: Option<String>,
    open_after_push: bool,
    scan_media: bool,
) -> Result<ImageCastResult, AdbError> {
    let local = Path::new(&local_path);
    if !local.exists() || !local.is_file() {
        return Err(AdbError::CommandFailed(
            t!("image_cast.invalid_file", "path" => local_path).into_owned(),
        ));
    }

    let mime_type = mime_type_for_path(local)?;
    let remote_dir = validate_remote_dir(remote_dir)?;
    let remote_name = safe_remote_filename(local);
    let remote_path = format!("{}/{}", remote_dir, remote_name);
    let serial = device_serial
        .as_deref()
        .map(str::trim)
        .filter(|serial| !serial.is_empty());

    let mkdir_output = adb::run_adb(&app, &["shell", "mkdir", "-p", remote_dir.as_str()], serial)?;
    ensure_success(&mkdir_output, &t!("image_cast.mkdir_failed"))?;

    let push_output = adb::run_adb(&app, &["push", &local_path, &remote_path], serial)?;
    ensure_success(&push_output, &t!("image_cast.push_failed"))?;

    let uri = file_uri(&remote_path);
    let (scanned, scan_message) = if scan_media {
        run_media_scan(&app, serial, &uri)
    } else {
        (false, None)
    };

    if !open_after_push {
        let message = if let Some(scan_message) = scan_message {
            t!(
                "image_cast.pushed_scan_failed",
                "path" => remote_path.as_str(),
                "message" => scan_message.as_str()
            )
            .into_owned()
        } else {
            t!("image_cast.pushed", "path" => remote_path.as_str()).into_owned()
        };
        return Ok(ImageCastResult {
            remote_path,
            mime_type: mime_type.to_string(),
            pushed: true,
            scanned,
            opened: false,
            message,
        });
    }

    let (opened, open_message) = run_open_image(&app, serial, &uri, mime_type);
    let message = match (opened, scan_message) {
        (true, None) => t!("image_cast.opened", "path" => remote_path.as_str()).into_owned(),
        (true, Some(scan_message)) => t!(
            "image_cast.opened_scan_failed",
            "path" => remote_path.as_str(),
            "message" => scan_message.as_str()
        )
        .into_owned(),
        (false, None) => t!(
            "image_cast.open_failed_after_push",
            "path" => remote_path.as_str(),
            "message" => open_message.as_str()
        )
        .into_owned(),
        (false, Some(scan_message)) => t!(
            "image_cast.open_failed_after_push_with_scan",
            "path" => remote_path.as_str(),
            "scan_message" => scan_message.as_str(),
            "message" => open_message.as_str()
        )
        .into_owned(),
    };

    Ok(ImageCastResult {
        remote_path,
        mime_type: mime_type.to_string(),
        pushed: true,
        scanned,
        opened,
        message,
    })
}

#[tauri::command(async)]
pub fn adb_open_reference_image(
    app: AppHandle,
    remote_path: String,
    mime_type: String,
    device_serial: Option<String>,
    scan_media: bool,
) -> Result<ImageCastResult, AdbError> {
    let normalized_mime = normalize_mime_type(&mime_type)?;
    let remote_path = validate_remote_path(&remote_path)?;
    let serial = device_serial
        .as_deref()
        .map(str::trim)
        .filter(|serial| !serial.is_empty());
    let uri = file_uri(&remote_path);

    let (scanned, scan_message) = if scan_media {
        run_media_scan(&app, serial, &uri)
    } else {
        (false, None)
    };
    let (opened, open_message) = run_open_image(&app, serial, &uri, normalized_mime);
    let message = match (opened, scan_message) {
        (true, None) => t!("image_cast.opened", "path" => remote_path.as_str()).into_owned(),
        (true, Some(scan_message)) => t!(
            "image_cast.opened_scan_failed",
            "path" => remote_path.as_str(),
            "message" => scan_message.as_str()
        )
        .into_owned(),
        (false, None) => t!(
            "image_cast.open_failed",
            "path" => remote_path.as_str(),
            "message" => open_message.as_str()
        )
        .into_owned(),
        (false, Some(scan_message)) => t!(
            "image_cast.open_failed_with_scan",
            "path" => remote_path.as_str(),
            "scan_message" => scan_message.as_str(),
            "message" => open_message.as_str()
        )
        .into_owned(),
    };

    Ok(ImageCastResult {
        remote_path,
        mime_type: normalized_mime.to_string(),
        pushed: false,
        scanned,
        opened,
        message,
    })
}

fn run_media_scan(app: &AppHandle, serial: Option<&str>, uri: &str) -> (bool, Option<String>) {
    match adb::run_adb(
        app,
        &[
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            uri,
        ],
        serial,
    ) {
        Ok(output) if output.status.success() => (true, None),
        Ok(output) => (false, Some(output_detail(&output))),
        Err(error) => (false, Some(error.to_string())),
    }
}

fn run_open_image(
    app: &AppHandle,
    serial: Option<&str>,
    uri: &str,
    mime_type: &str,
) -> (bool, String) {
    match adb::run_adb(
        app,
        &[
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            uri,
            "-t",
            mime_type,
        ],
        serial,
    ) {
        Ok(output) if output.status.success() => (true, output_detail(&output)),
        Ok(output) => (false, output_detail(&output)),
        Err(error) => (false, error.to_string()),
    }
}

fn ensure_success(output: &std::process::Output, context: &str) -> Result<(), AdbError> {
    if output.status.success() {
        return Ok(());
    }

    Err(AdbError::CommandFailed(format!(
        "{}: {}",
        context,
        output_detail(output)
    )))
}

fn output_detail(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = stderr.trim();
    let stdout = stdout.trim();

    if !stderr.is_empty() {
        stderr.to_string()
    } else if !stdout.is_empty() {
        stdout.to_string()
    } else {
        t!("image_cast.no_output").to_string()
    }
}

fn mime_type_for_path(path: &Path) -> Result<&'static str, AdbError> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    mime_type_for_extension(extension)
}

fn mime_type_for_extension(extension: &str) -> Result<&'static str, AdbError> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        _ => Err(AdbError::CommandFailed(
            t!("image_cast.unsupported_format").into_owned(),
        )),
    }
}

fn normalize_mime_type(mime_type: &str) -> Result<&'static str, AdbError> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("image/png"),
        "image/jpeg" => Ok("image/jpeg"),
        "image/webp" => Ok("image/webp"),
        _ => Err(AdbError::CommandFailed(
            t!("image_cast.unsupported_format").into_owned(),
        )),
    }
}

fn safe_remote_filename(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .unwrap_or_else(|| "png".to_string());
    let basename = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_basename)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "figma_ref".to_string());
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");

    format!("{basename}_{timestamp}.{extension}")
}

fn sanitize_basename(value: &str) -> String {
    let mut output = String::new();
    let mut previous_underscore = false;

    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '-' {
            Some(ch)
        } else if ch == '_' || ch.is_whitespace() {
            Some('_')
        } else {
            None
        };

        if let Some(ch) = next {
            if ch == '_' {
                if previous_underscore {
                    continue;
                }
                previous_underscore = true;
            } else {
                previous_underscore = false;
            }
            output.push(ch);
        }
    }

    output.trim_matches('_').to_string()
}

fn validate_remote_dir(remote_dir: Option<String>) -> Result<String, AdbError> {
    let remote_dir = remote_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_REMOTE_DIR);

    validate_remote_path(remote_dir).map(|path| path.trim_end_matches('/').to_string())
}

fn validate_remote_path(remote_path: &str) -> Result<String, AdbError> {
    let remote_path = remote_path.trim();
    let allowed_prefix = remote_path.starts_with("/sdcard/")
        || remote_path == "/sdcard"
        || remote_path.starts_with("/storage/emulated/0/");

    if !allowed_prefix
        || remote_path.contains("..")
        || remote_path.chars().any(|ch| {
            ch.is_control()
                || matches!(
                    ch,
                    '\'' | '"' | '`' | '$' | ';' | '&' | '|' | '<' | '>' | '(' | ')' | '\\'
                )
        })
    {
        return Err(AdbError::CommandFailed(
            t!("image_cast.invalid_remote_path", "path" => remote_path).into_owned(),
        ));
    }

    Ok(remote_path.to_string())
}

fn file_uri(remote_path: &str) -> String {
    format!("file://{remote_path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_mime_types() {
        assert_eq!(mime_type_for_extension("png").unwrap(), "image/png");
        assert_eq!(mime_type_for_extension("jpg").unwrap(), "image/jpeg");
        assert_eq!(mime_type_for_extension("jpeg").unwrap(), "image/jpeg");
        assert_eq!(mime_type_for_extension("webp").unwrap(), "image/webp");
        assert!(mime_type_for_extension("gif").is_err());
    }

    #[test]
    fn sanitizes_remote_basename() {
        assert_eq!(sanitize_basename("Figma ref @ 100%"), "Figma_ref_100");
        assert_eq!(sanitize_basename("  颜色 对比  "), "");
        assert_eq!(sanitize_basename("screen-final_01"), "screen-final_01");
    }

    #[test]
    fn validates_remote_directory() {
        assert_eq!(
            validate_remote_dir(None).unwrap(),
            "/sdcard/Pictures/ADBManager"
        );
        assert_eq!(
            validate_remote_dir(Some("/sdcard/Download".to_string())).unwrap(),
            "/sdcard/Download"
        );
        assert!(validate_remote_dir(Some("/data/local/tmp".to_string())).is_err());
        assert!(validate_remote_dir(Some("/sdcard/Pictures;rm -rf".to_string())).is_err());
    }

    #[test]
    fn builds_file_uri() {
        assert_eq!(
            file_uri("/sdcard/Pictures/ADBManager/ref.png"),
            "file:///sdcard/Pictures/ADBManager/ref.png"
        );
    }
}
