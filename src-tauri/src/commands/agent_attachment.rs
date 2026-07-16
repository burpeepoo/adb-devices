use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::adb::AdbError;
use crate::commands::clipboard_paths::{
    normalize_clipboard_path, read_clipboard_file_paths, read_clipboard_text_paths,
};

const MAX_TEXT_PREVIEW_BYTES: u64 = 512 * 1024;
const TEXT_PREVIEW_CHARS: usize = 2400;
const MAX_IMAGE_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAttachmentFilePayload {
    name: String,
    mime_type: String,
    size_bytes: u64,
    text_preview: Option<String>,
    preview_kind: Option<String>,
    preview_data_url: Option<String>,
    source_path: String,
}

#[tauri::command(async)]
pub fn read_agent_attachment_files(
    paths: Vec<String>,
) -> Result<Vec<AgentAttachmentFilePayload>, AdbError> {
    Ok(read_attachment_files(paths))
}

#[tauri::command(async)]
pub fn read_clipboard_agent_attachment_files() -> Result<Vec<AgentAttachmentFilePayload>, AdbError>
{
    Ok(read_attachment_files(read_clipboard_local_paths()))
}

/// Returns the real local paths represented by a native clipboard selection.
///
/// Finder commonly exposes a file name as `text/plain`; reading the native
/// pasteboard first preserves the full path for Scout text fields.
#[tauri::command(async)]
pub fn read_clipboard_local_paths() -> Vec<String> {
    let mut paths = read_clipboard_file_paths();

    if paths.is_empty() {
        paths = read_clipboard_text_paths()
            .into_iter()
            .filter(|path| is_file_uri_or_absolute_path(path))
            .collect();
    }

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .map(|path| normalize_clipboard_path(&path))
        .filter(|path| !path.is_empty() && seen.insert(path.clone()))
        .collect()
}

fn read_attachment_files(paths: Vec<String>) -> Vec<AgentAttachmentFilePayload> {
    let mut seen = HashSet::new();
    let mut attachments = Vec::new();

    for path in paths {
        let normalized = normalize_clipboard_path(&path);
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }

        if let Some(attachment) = read_attachment_file(Path::new(&normalized)) {
            attachments.push(attachment);
        }
    }

    attachments
}

fn read_attachment_file(path: &Path) -> Option<AgentAttachmentFilePayload> {
    if !path.exists() || !path.is_file() {
        return None;
    }

    let metadata = fs::metadata(path).ok()?;
    let size_bytes = metadata.len();
    let mime_type = mime_type_for_path(path);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("attachment")
        .to_string();
    let mut preview_kind = None;
    let mut preview_data_url = None;
    let mut text_preview = None;

    if mime_type.starts_with("image/") && size_bytes <= MAX_IMAGE_PREVIEW_BYTES {
        if let Ok(bytes) = fs::read(path) {
            preview_kind = Some("image".to_string());
            preview_data_url = Some(format!(
                "data:{};base64,{}",
                mime_type,
                general_purpose::STANDARD.encode(bytes)
            ));
        }
    } else if is_text_like_path(path, &mime_type) && size_bytes <= MAX_TEXT_PREVIEW_BYTES {
        if let Ok(bytes) = fs::read(path) {
            text_preview = Some(
                String::from_utf8_lossy(&bytes)
                    .chars()
                    .take(TEXT_PREVIEW_CHARS)
                    .collect(),
            );
        }
    }

    Some(AgentAttachmentFilePayload {
        name,
        mime_type,
        size_bytes,
        text_preview,
        preview_kind,
        preview_data_url,
        source_path: path.to_string_lossy().to_string(),
    })
}

fn is_file_uri_or_absolute_path(path: &str) -> bool {
    let trimmed = path.trim().trim_matches(['"', '\'']);
    trimmed.starts_with("file://") || Path::new(trimmed).is_absolute()
}

fn mime_type_for_path(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "txt" | "log" | "md" | "markdown" | "csv" | "ini" | "properties" => "text/plain",
        "json" | "jsonl" => "application/json",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/x-yaml",
        "pdf" => "application/pdf",
        "apk" => "application/vnd.android.package-archive",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn is_text_like_path(path: &Path, mime_type: &str) -> bool {
    if mime_type.starts_with("text/")
        || matches!(
            mime_type,
            "application/json" | "application/xml" | "application/x-yaml"
        )
    {
        return true;
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "txt"
                    | "md"
                    | "markdown"
                    | "json"
                    | "jsonl"
                    | "log"
                    | "csv"
                    | "xml"
                    | "yaml"
                    | "yml"
                    | "ini"
                    | "properties"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_attachment_mime_types() {
        assert_eq!(mime_type_for_path(Path::new("/tmp/a.png")), "image/png");
        assert_eq!(
            mime_type_for_path(Path::new("/tmp/a.JSON")),
            "application/json"
        );
        assert_eq!(
            mime_type_for_path(Path::new("/tmp/a.apk")),
            "application/vnd.android.package-archive"
        );
    }

    #[test]
    fn reads_text_preview_without_failing_binary_metadata() {
        let path = std::env::temp_dir().join(format!(
            "adb-manager-agent-attachment-{}.txt",
            std::process::id()
        ));
        fs::write(&path, "hello\nworld").unwrap();

        let attachment = read_attachment_file(&path).unwrap();

        assert_eq!(attachment.name, path.file_name().unwrap().to_string_lossy());
        assert_eq!(attachment.mime_type, "text/plain");
        assert_eq!(attachment.text_preview.as_deref(), Some("hello\nworld"));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn clipboard_text_fallback_requires_absolute_paths() {
        assert!(is_file_uri_or_absolute_path("file:///Users/test/a.png"));
        assert!(is_file_uri_or_absolute_path("/Users/test/a.png"));
        assert!(!is_file_uri_or_absolute_path("a.png"));
    }
}
