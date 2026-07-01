use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::adb::AdbError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceExportAsset {
    pub path: String,
    pub title: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceExportPackageRequest {
    pub default_name: String,
    pub report_markdown: String,
    pub assets: Vec<EvidenceExportAsset>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceExportPackageResult {
    pub path: String,
    pub asset_count: usize,
    pub skipped_assets: Vec<String>,
}

#[tauri::command]
pub async fn export_evidence_package(
    app: AppHandle,
    request: EvidenceExportPackageRequest,
) -> Result<Option<EvidenceExportPackageResult>, AdbError> {
    tauri::async_runtime::spawn_blocking(move || export_evidence_package_blocking(app, request))
        .await
        .map_err(|error| {
            AdbError::CommandFailed(format!("Evidence package task failed: {error}"))
        })?
}

fn export_evidence_package_blocking(
    app: AppHandle,
    request: EvidenceExportPackageRequest,
) -> Result<Option<EvidenceExportPackageResult>, AdbError> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("Export QA Scribe evidence package")
        .set_file_name(&ensure_zip_extension(&request.default_name))
        .blocking_save_file();

    let Some(path) = path else {
        return Ok(None);
    };

    let path_string = path.to_string();
    let file = File::create(&path_string)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    archive
        .start_file("report.md", options)
        .map_err(|error| AdbError::CommandFailed(format!("Failed to start report.md: {error}")))?;
    archive.write_all(request.report_markdown.as_bytes())?;

    let mut used_names = HashSet::new();
    let mut asset_count = 0usize;
    let mut skipped_assets = Vec::new();

    for asset in request.assets {
        let source_path = Path::new(&asset.path);
        if !source_path.is_file() {
            skipped_assets.push(asset.path);
            continue;
        }
        let Ok(mut source_file) = File::open(source_path) else {
            skipped_assets.push(asset.path);
            continue;
        };
        let entry_name = unique_asset_entry_name(&asset, source_path, &mut used_names);
        archive.start_file(entry_name, options).map_err(|error| {
            AdbError::CommandFailed(format!("Failed to start asset file: {error}"))
        })?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = source_file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            archive.write_all(&buffer[..read])?;
        }
        asset_count += 1;
    }

    archive.finish().map_err(|error| {
        AdbError::CommandFailed(format!("Failed to finish evidence package: {error}"))
    })?;

    Ok(Some(EvidenceExportPackageResult {
        path: path_string,
        asset_count,
        skipped_assets,
    }))
}

fn ensure_zip_extension(default_name: &str) -> String {
    let trimmed = default_name.trim();
    let name = if trimmed.is_empty() {
        "qa_scribe_evidence.zip"
    } else {
        trimmed
    };
    if name.to_lowercase().ends_with(".zip") {
        name.to_string()
    } else {
        format!("{name}.zip")
    }
}

fn unique_asset_entry_name(
    asset: &EvidenceExportAsset,
    source_path: &Path,
    used_names: &mut HashSet<String>,
) -> String {
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(sanitize_name_part)
        .filter(|value| !value.is_empty());
    let source_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let title_stem = asset
        .title
        .as_deref()
        .map(sanitize_name_part)
        .filter(|value| !value.is_empty());
    let kind = asset
        .kind
        .as_deref()
        .map(sanitize_name_part)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "artifact".to_string());
    let base = sanitize_name_part(title_stem.as_deref().unwrap_or(source_stem));
    let base = if base.is_empty() {
        "asset".to_string()
    } else {
        base
    };

    for index in 0.. {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{}", index + 1)
        };
        let file_name = match extension.as_deref() {
            Some(extension) => format!("{base}{suffix}.{extension}"),
            None => format!("{base}{suffix}"),
        };
        let entry = format!("assets/{kind}/{file_name}");
        if used_names.insert(entry.clone()) {
            return entry;
        }
    }
    unreachable!("asset file name loop should always return");
}

fn sanitize_name_part(value: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_separator = false;
    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else if character == '.'
            || character == '-'
            || character == '_'
            || character.is_whitespace()
        {
            '-'
        } else {
            '-'
        };
        if next == '-' {
            if !last_was_separator {
                sanitized.push(next);
            }
            last_was_separator = true;
        } else {
            sanitized.push(next);
            last_was_separator = false;
        }
    }
    sanitized.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn evidence_package_default_name_gets_zip_extension() {
        assert_eq!(ensure_zip_extension("walkthrough"), "walkthrough.zip");
        assert_eq!(ensure_zip_extension("walkthrough.ZIP"), "walkthrough.ZIP");
        assert_eq!(ensure_zip_extension("  "), "qa_scribe_evidence.zip");
    }

    #[test]
    fn evidence_asset_entries_are_grouped_and_unique() {
        let mut used_names = HashSet::new();
        let first = unique_asset_entry_name(
            &EvidenceExportAsset {
                path: "/tmp/screenshot.png".to_string(),
                title: Some("Screenshot".to_string()),
                kind: Some("screenshot".to_string()),
            },
            Path::new("/tmp/screenshot.png"),
            &mut used_names,
        );
        let second = unique_asset_entry_name(
            &EvidenceExportAsset {
                path: "/tmp/other.png".to_string(),
                title: Some("Screenshot".to_string()),
                kind: Some("screenshot".to_string()),
            },
            Path::new("/tmp/other.png"),
            &mut used_names,
        );

        assert_eq!(first, "assets/screenshot/screenshot.png");
        assert_eq!(second, "assets/screenshot/screenshot-2.png");
    }

    #[test]
    fn evidence_asset_names_do_not_escape_assets_directory() {
        let mut used_names = HashSet::new();
        let entry = unique_asset_entry_name(
            &EvidenceExportAsset {
                path: "../private/report.md".to_string(),
                title: Some("../../Bad Name".to_string()),
                kind: Some("../screen_state".to_string()),
            },
            Path::new("../private/report.md"),
            &mut used_names,
        );

        assert_eq!(entry, "assets/screen-state/bad-name.md");
    }
}
