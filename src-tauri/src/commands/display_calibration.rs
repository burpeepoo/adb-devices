use chrono::Local;
use image::{Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::adb::{self, AdbError};

const DEFAULT_REMOTE_DIR: &str = "/sdcard/Pictures/ADBManager";
const DISPLAY_HELPER_RESOURCE: &str = "resources/agent/adb-manager-agent.apk";
const DISPLAY_HELPER_REMOTE_PATH: &str = "/data/local/tmp/adb-manager-display-helper.apk";
const DISPLAY_HELPER_MAIN_CLASS: &str = "com.cozyla.adbmanager.agent.DisplayOutputShell";
const VENDOR_DISPLAY_SERVICE: &str = "vendor.display.output.IDisplayOutputManager/default";
const COLOR_TEMPERATURE_VALUE_KEY: &str = "aw_color_temperature_value";
const COLOR_TEMPERATURE_POINT_KEY: &str = "srgb_color_temperature";
const COLOR_TEMPERATURE_POINT_RANGE: f64 = 205.0;
const COLOR_TEMPERATURE_POINT_CENTER: f64 = COLOR_TEMPERATURE_POINT_RANGE / 2.0;
const COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS: f64 =
    COLOR_TEMPERATURE_POINT_CENTER * (74.0 / 75.0) * (15.0 / 16.0);
const MAX_PROBE_TEXT_BYTES: usize = 60_000;
const MAX_CANDIDATES: usize = 400;
const MAX_VALUE_BYTES: usize = 128;

const DISCOVERY_KEYWORDS: &[&str] = &[
    "color",
    "colour",
    "display",
    "screen",
    "pq",
    "picture",
    "saturation",
    "contrast",
    "temperature",
    "brightness",
    "backlight",
    "cabc",
    "gamma",
    "white",
    "black",
    "reading",
    "enhance",
    "hdr",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationSnapshot {
    pub captured_at: String,
    pub device_serial: String,
    pub probes: Vec<DisplayCalibrationProbe>,
    pub candidates: Vec<DisplayCalibrationCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationProbe {
    pub id: String,
    pub label: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationCandidate {
    pub id: String,
    pub label: String,
    pub value: String,
    pub source: String,
    pub probe_id: String,
    pub line: String,
    pub confidence: u8,
    pub reason: String,
    pub writable: bool,
    pub target: Option<DisplayCalibrationTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DisplayCalibrationTarget {
    Settings {
        namespace: String,
        key: String,
    },
    SystemProperty {
        key: String,
    },
    Sysfs {
        path: String,
    },
    VendorDisplay {
        service: String,
        #[serde(alias = "display_id")]
        display_id: i32,
        operation: String,
        component: Option<i32>,
        #[serde(alias = "read_method")]
        read_method: String,
        #[serde(alias = "write_method")]
        write_method: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationDiff {
    pub before_captured_at: String,
    pub after_captured_at: String,
    pub changed: Vec<DisplayCalibrationChangedValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationChangedValue {
    pub id: String,
    pub label: String,
    pub source: String,
    pub before_value: String,
    pub after_value: String,
    pub writable: bool,
    pub target: Option<DisplayCalibrationTarget>,
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationApplyResult {
    pub target: DisplayCalibrationTarget,
    pub requested_value: String,
    pub readback_value: Option<String>,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationReadResult {
    pub target: DisplayCalibrationTarget,
    pub readback_value: Option<String>,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationProfile {
    pub profile_name: String,
    pub created_at: Option<String>,
    pub device: DisplayCalibrationDeviceIdentity,
    pub parameters: Vec<DisplayCalibrationProfileParameter>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationDeviceIdentity {
    pub adb_serial: String,
    pub device_sn: Option<String>,
    pub model: Option<String>,
    pub build_fingerprint: Option<String>,
    pub firmware_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationProfileParameter {
    pub name: String,
    pub target: DisplayCalibrationTarget,
    pub baseline_value: Option<String>,
    pub desired_value: String,
    pub readback_value: Option<String>,
    pub visible_effect_confirmed: Option<bool>,
    pub requires_physical_validation: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationExportBundle {
    pub json: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationTestPatternResult {
    pub local_path: String,
    pub remote_path: String,
    pub pushed: bool,
    pub opened: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCalibrationRootResult {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct DisplayHelperResponse {
    ok: bool,
    value: Option<serde_json::Value>,
    error: Option<String>,
}

struct DisplayHelperCommandOutput {
    command: String,
    stdout: String,
    stderr: String,
    success: bool,
    value: Option<String>,
}

#[tauri::command(async)]
pub fn adb_display_calibration_snapshot(
    app: AppHandle,
    device_serial: String,
) -> Result<DisplayCalibrationSnapshot, AdbError> {
    let serial = resolve_executable_serial(&app, &device_serial)?;
    let mut probes = Vec::new();

    for spec in discovery_probes() {
        probes.push(run_probe(&app, &serial, spec));
    }

    let candidates = collect_candidates(&probes);

    Ok(DisplayCalibrationSnapshot {
        captured_at: Local::now().to_rfc3339(),
        device_serial: serial,
        probes,
        candidates,
    })
}

#[tauri::command]
pub fn adb_display_calibration_diff(
    before: DisplayCalibrationSnapshot,
    after: DisplayCalibrationSnapshot,
) -> DisplayCalibrationDiff {
    diff_snapshots(&before, &after)
}

#[tauri::command(async)]
pub fn adb_display_calibration_read_target(
    app: AppHandle,
    device_serial: String,
    target: DisplayCalibrationTarget,
) -> Result<DisplayCalibrationReadResult, AdbError> {
    let serial = resolve_executable_serial(&app, &device_serial)?;
    validate_target(&target)?;
    read_target_result(&app, &serial, target)
}

#[tauri::command(async)]
pub fn adb_display_calibration_apply(
    app: AppHandle,
    device_serial: String,
    target: DisplayCalibrationTarget,
    value: String,
    confirmed: bool,
) -> Result<DisplayCalibrationApplyResult, AdbError> {
    if !confirmed {
        return Err(AdbError::CommandFailed(
            "Display calibration writes require explicit confirmation".to_string(),
        ));
    }

    let serial = resolve_executable_serial(&app, &device_serial)?;
    let value = validate_write_value(&value)?;
    validate_target(&target)?;
    if is_color_temperature_point_target(&target) {
        color_temperature_point_to_native_color(&value)?;
    }

    if matches!(target, DisplayCalibrationTarget::VendorDisplay { .. }) {
        let helper_output = run_vendor_display_helper_write(&app, &serial, &target, &value)?;
        let readback_value = if helper_output.success {
            readback_target(&app, &serial, &target).ok()
        } else {
            None
        };

        return Ok(DisplayCalibrationApplyResult {
            target,
            requested_value: value,
            readback_value,
            command: helper_output.command,
            stdout: helper_output.stdout,
            stderr: helper_output.stderr,
            success: helper_output.success,
        });
    }

    let (args, preview) = build_write_command(&target, &value)?;
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = adb::run_adb_with_timeout(&app, &arg_refs, Some(&serial), Duration::from_secs(8))?;
    let command_success = output.status.success();
    let readback_result = if command_success {
        readback_target(&app, &serial, &target)
    } else {
        Err(AdbError::CommandFailed(output_detail(&output)))
    };
    let readback_value = readback_result.as_ref().ok().cloned();
    let mut success = command_success && readback_result.is_ok();
    let mut command = preview;
    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if command_success {
        if let Err(error) = readback_result {
            if !stderr.trim().is_empty() {
                stderr.push('\n');
            }
            stderr.push_str(&error.to_string());
        }
    }
    if success {
        let live_value_source = readback_value.as_deref().unwrap_or(&value);
        if is_color_temperature_point_target(&target) {
            match color_temperature_point_to_native_color(live_value_source) {
                Ok(native_color) => {
                    match write_color_temperature_value_setting(&app, &serial, native_color) {
                        Ok(sync_output) => {
                            command = format!("{command} && {}", sync_output.command);
                            append_output(&mut stdout, &sync_output.stdout);
                            append_output(&mut stderr, &sync_output.stderr);
                            success = sync_output.success;
                        }
                        Err(error) => {
                            success = false;
                            append_output(&mut stderr, &error.to_string());
                        }
                    }
                }
                Err(error) => {
                    success = false;
                    append_output(&mut stderr, &error.to_string());
                }
            }
        }
        let live_targets = match live_apply_targets(&target, live_value_source) {
            Ok(targets) => targets,
            Err(error) => {
                success = false;
                append_output(&mut stderr, &error.to_string());
                Vec::new()
            }
        };
        for (live_target, live_value) in live_targets {
            if !success {
                break;
            }
            match run_vendor_display_helper_write(&app, &serial, &live_target, &live_value) {
                Ok(live_output) => {
                    command = format!("{command} && {}", live_output.command);
                    append_output(&mut stdout, &live_output.stdout);
                    append_output(&mut stderr, &live_output.stderr);
                    success = live_output.success;
                }
                Err(error) => {
                    success = false;
                    append_output(&mut stderr, &error.to_string());
                }
            }
        }
    }

    Ok(DisplayCalibrationApplyResult {
        target,
        requested_value: value,
        readback_value,
        command,
        stdout,
        stderr,
        success,
    })
}

#[tauri::command]
pub fn adb_display_calibration_build_export(
    profile: DisplayCalibrationProfile,
) -> Result<DisplayCalibrationExportBundle, AdbError> {
    validate_profile(&profile)?;
    let json = serde_json::to_string_pretty(&profile).map_err(|error| {
        AdbError::CommandFailed(format!("Failed to serialize display profile: {error}"))
    })?;
    let markdown = build_profile_markdown(&profile);
    Ok(DisplayCalibrationExportBundle { json, markdown })
}

#[tauri::command(async)]
pub fn adb_display_calibration_open_test_pattern(
    app: AppHandle,
    device_serial: String,
) -> Result<DisplayCalibrationTestPatternResult, AdbError> {
    let serial = resolve_executable_serial(&app, &device_serial)?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let local_path = test_pattern_path(&app, &format!("display_calibration_{timestamp}.png"))?;
    generate_test_pattern_png(&local_path)?;

    let remote_path = format!("{DEFAULT_REMOTE_DIR}/display_calibration_pattern_{timestamp}.png");
    let mkdir_output = adb::run_adb_with_timeout(
        &app,
        &["shell", "mkdir", "-p", DEFAULT_REMOTE_DIR],
        Some(&serial),
        Duration::from_secs(5),
    )?;
    ensure_success(
        &mkdir_output,
        "Failed to create remote calibration image directory",
    )?;

    let local_path_str = local_path.to_string_lossy().to_string();
    let push_output = adb::run_adb_with_timeout(
        &app,
        &["push", &local_path_str, &remote_path],
        Some(&serial),
        Duration::from_secs(20),
    )?;
    ensure_success(
        &push_output,
        "Failed to push display calibration test pattern",
    )?;

    let uri = format!("file://{remote_path}");
    let _ = adb::run_adb_with_timeout(
        &app,
        &[
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            &uri,
        ],
        Some(&serial),
        Duration::from_secs(5),
    );

    let open_output = adb::run_adb_with_timeout(
        &app,
        &[
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            &uri,
            "-t",
            "image/png",
        ],
        Some(&serial),
        Duration::from_secs(8),
    )?;
    let opened = open_output.status.success();

    let message = if opened {
        format!("Opened display calibration test pattern on {serial}")
    } else {
        format!(
            "Pushed test pattern, but opening it failed: {}",
            output_detail(&open_output)
        )
    };

    Ok(DisplayCalibrationTestPatternResult {
        local_path: local_path_str,
        remote_path,
        pushed: true,
        opened,
        message,
    })
}

#[tauri::command(async)]
pub fn adb_display_calibration_enable_root(
    app: AppHandle,
    device_serial: String,
) -> Result<DisplayCalibrationRootResult, AdbError> {
    let serial = resolve_executable_serial(&app, &device_serial)?;
    let output =
        adb::run_adb_with_timeout(&app, &["root"], Some(&serial), Duration::from_secs(15))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = root_request_succeeded(output.status.success(), &stdout, &stderr);
    let detail = output_detail(&output);
    let message = if success {
        if detail.trim().is_empty() {
            "adbd root requested. The device may reconnect; refresh the device list if it disappears."
                .to_string()
        } else {
            detail
        }
    } else if detail.trim().is_empty() {
        "adb root failed without output".to_string()
    } else {
        detail
    };

    Ok(DisplayCalibrationRootResult {
        stdout,
        stderr,
        success,
        message,
    })
}

struct ProbeSpec {
    id: &'static str,
    label: &'static str,
    args: &'static [&'static str],
    timeout_secs: u64,
}

fn discovery_probes() -> Vec<ProbeSpec> {
    vec![
        ProbeSpec {
            id: "settings_system",
            label: "Android system settings",
            args: &["shell", "settings", "list", "system"],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "settings_secure",
            label: "Android secure settings",
            args: &["shell", "settings", "list", "secure"],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "settings_global",
            label: "Android global settings",
            args: &["shell", "settings", "list", "global"],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "properties",
            label: "Android properties",
            args: &["shell", "getprop"],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "dumpsys_display",
            label: "Display service dump",
            args: &["shell", "dumpsys", "display"],
            timeout_secs: 8,
        },
        ProbeSpec {
            id: "dumpsys_surfaceflinger",
            label: "SurfaceFlinger dump",
            args: &["shell", "dumpsys", "SurfaceFlinger"],
            timeout_secs: 8,
        },
        ProbeSpec {
            id: "cmd_color_display",
            label: "Color display command surface",
            args: &["shell", "cmd", "color_display"],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "service_list_display",
            label: "Likely display or PQ services",
            args: &[
                "shell",
                "service list 2>/dev/null | grep -iE 'display|color|pq|picture|surface|flinger|backlight|gamma|cabc'",
            ],
            timeout_secs: 5,
        },
        ProbeSpec {
            id: "sysfs_likely_display",
            label: "Likely display sysfs nodes",
            args: &[
                "shell",
                "find /sys -maxdepth 5 -type f 2>/dev/null | grep -iE 'display|color|colour|pq|picture|saturation|contrast|gamma|cabc|backlight' | head -n 200 | while read p; do v=$(cat \"$p\" 2>/dev/null | head -c 160); echo \"$p=$v\"; done",
            ],
            timeout_secs: 8,
        },
        ProbeSpec {
            id: "logcat_display_tail",
            label: "Recent display-related logcat tail",
            args: &[
                "shell",
                "logcat -d -t 300 2>/dev/null | grep -iE 'display|color|pq|picture|saturation|contrast|gamma|backlight|surfaceflinger' | tail -n 120",
            ],
            timeout_secs: 8,
        },
    ]
}

fn run_probe(app: &AppHandle, serial: &str, spec: ProbeSpec) -> DisplayCalibrationProbe {
    let command = format!("adb -s {serial} {}", spec.args.join(" "));
    let output = match adb::run_adb_with_timeout(
        app,
        spec.args,
        Some(serial),
        Duration::from_secs(spec.timeout_secs),
    ) {
        Ok(output) => output,
        Err(error) => {
            return DisplayCalibrationProbe {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                command,
                exit_code: None,
                stdout: String::new(),
                stderr: error.to_string(),
                success: false,
                truncated: false,
            };
        }
    };
    let (stdout, stdout_truncated) = bounded_text(&String::from_utf8_lossy(&output.stdout));
    let (stderr, stderr_truncated) = bounded_text(&String::from_utf8_lossy(&output.stderr));

    DisplayCalibrationProbe {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        command,
        exit_code: output.status.code(),
        stdout,
        stderr,
        success: output.status.success(),
        truncated: stdout_truncated || stderr_truncated,
    }
}

fn collect_candidates(probes: &[DisplayCalibrationProbe]) -> Vec<DisplayCalibrationCandidate> {
    let mut candidates = Vec::new();

    for probe in probes {
        for line in probe.stdout.lines().chain(probe.stderr.lines()) {
            if candidates.len() >= MAX_CANDIDATES {
                return candidates;
            }
            if let Some(candidate) = candidate_from_line(probe, line) {
                candidates.push(candidate);
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.confidence
            .cmp(&a.confidence)
            .then_with(|| a.id.cmp(&b.id))
    });
    candidates
}

fn candidate_from_line(
    probe: &DisplayCalibrationProbe,
    line: &str,
) -> Option<DisplayCalibrationCandidate> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !matches_discovery_keyword(trimmed) {
        return None;
    }

    match probe.id.as_str() {
        "settings_system" | "settings_secure" | "settings_global" => {
            let (key, value) = parse_key_value_line(trimmed)?;
            let namespace = probe.id.strip_prefix("settings_")?.to_string();
            let target = DisplayCalibrationTarget::Settings {
                namespace: namespace.clone(),
                key: key.to_string(),
            };
            let confidence = confidence_for_key(key);
            Some(DisplayCalibrationCandidate {
                id: candidate_id(&target),
                label: key.to_string(),
                value: value.to_string(),
                source: format!("settings {namespace}"),
                probe_id: probe.id.clone(),
                line: trimmed.to_string(),
                confidence,
                reason: discovery_reason(key),
                writable: true,
                target: Some(target),
            })
        }
        "properties" => {
            let (key, value) = parse_property_line(trimmed)?;
            let target = DisplayCalibrationTarget::SystemProperty {
                key: key.to_string(),
            };
            let confidence = confidence_for_key(key).saturating_sub(10);
            Some(DisplayCalibrationCandidate {
                id: candidate_id(&target),
                label: key.to_string(),
                value: value.to_string(),
                source: "getprop".to_string(),
                probe_id: probe.id.clone(),
                line: trimmed.to_string(),
                confidence,
                reason: discovery_reason(key),
                writable: true,
                target: Some(target),
            })
        }
        "sysfs_likely_display" => {
            let (path, value) = parse_key_value_line(trimmed)?;
            let target = DisplayCalibrationTarget::Sysfs {
                path: path.to_string(),
            };
            let confidence = confidence_for_key(path).saturating_sub(5);
            Some(DisplayCalibrationCandidate {
                id: candidate_id(&target),
                label: path.to_string(),
                value: value.to_string(),
                source: "sysfs".to_string(),
                probe_id: probe.id.clone(),
                line: trimmed.to_string(),
                confidence,
                reason: discovery_reason(path),
                writable: true,
                target: Some(target),
            })
        }
        _ => Some(DisplayCalibrationCandidate {
            id: format!("{}:{}", probe.id, stable_line_key(trimmed)),
            label: first_words(trimmed, 8),
            value: trimmed.to_string(),
            source: probe.label.clone(),
            probe_id: probe.id.clone(),
            line: trimmed.to_string(),
            confidence: 20,
            reason: "Contains display/color calibration keywords".to_string(),
            writable: false,
            target: None,
        }),
    }
}

fn diff_snapshots(
    before: &DisplayCalibrationSnapshot,
    after: &DisplayCalibrationSnapshot,
) -> DisplayCalibrationDiff {
    let before_by_id = before
        .candidates
        .iter()
        .map(|candidate| (candidate.id.clone(), candidate))
        .collect::<BTreeMap<_, _>>();

    let mut changed = Vec::new();
    for after_candidate in &after.candidates {
        let Some(before_candidate) = before_by_id.get(&after_candidate.id) else {
            continue;
        };
        if before_candidate.value == after_candidate.value {
            continue;
        }
        changed.push(DisplayCalibrationChangedValue {
            id: after_candidate.id.clone(),
            label: after_candidate.label.clone(),
            source: after_candidate.source.clone(),
            before_value: before_candidate.value.clone(),
            after_value: after_candidate.value.clone(),
            writable: after_candidate.writable,
            target: after_candidate.target.clone(),
            confidence: after_candidate.confidence,
        });
    }

    changed.sort_by(|a, b| {
        b.confidence
            .cmp(&a.confidence)
            .then_with(|| a.id.cmp(&b.id))
    });

    DisplayCalibrationDiff {
        before_captured_at: before.captured_at.clone(),
        after_captured_at: after.captured_at.clone(),
        changed,
    }
}

fn build_write_command(
    target: &DisplayCalibrationTarget,
    value: &str,
) -> Result<(Vec<String>, String), AdbError> {
    match target {
        DisplayCalibrationTarget::Settings { namespace, key } => Ok((
            vec![
                "shell".to_string(),
                "settings".to_string(),
                "put".to_string(),
                namespace.clone(),
                key.clone(),
                value.to_string(),
            ],
            format!("settings put {namespace} {key} {value}"),
        )),
        DisplayCalibrationTarget::SystemProperty { key } => Ok((
            vec![
                "shell".to_string(),
                "setprop".to_string(),
                key.clone(),
                value.to_string(),
            ],
            format!("setprop {key} {value}"),
        )),
        DisplayCalibrationTarget::Sysfs { path } => {
            let command = format!("printf %s {} > {}", shell_quote(value), shell_quote(path));
            Ok((
                vec![
                    "shell".to_string(),
                    "sh".to_string(),
                    "-c".to_string(),
                    command.clone(),
                ],
                format!("sh -c {command}"),
            ))
        }
        DisplayCalibrationTarget::VendorDisplay { .. } => Err(AdbError::CommandFailed(
            "Vendor display controls require the ADB Manager display helper; direct settings writes cannot reach this device Settings control".to_string(),
        )),
    }
}

fn readback_target(
    app: &AppHandle,
    serial: &str,
    target: &DisplayCalibrationTarget,
) -> Result<String, AdbError> {
    let output = match target {
        DisplayCalibrationTarget::Settings { namespace, key } => adb::run_adb_with_timeout(
            app,
            &["shell", "settings", "get", namespace.as_str(), key.as_str()],
            Some(serial),
            Duration::from_secs(5),
        )?,
        DisplayCalibrationTarget::SystemProperty { key } => adb::run_adb_with_timeout(
            app,
            &["shell", "getprop", key.as_str()],
            Some(serial),
            Duration::from_secs(5),
        )?,
        DisplayCalibrationTarget::Sysfs { path } => {
            let command = format!("cat {}", shell_quote(path));
            adb::run_adb_with_timeout(
                app,
                &["shell", "sh", "-c", &command],
                Some(serial),
                Duration::from_secs(5),
            )?
        }
        DisplayCalibrationTarget::VendorDisplay { .. } => {
            let helper_output = run_vendor_display_helper_read(app, serial, target)?;
            if helper_output.success {
                return helper_output.value.ok_or_else(|| {
                    AdbError::CommandFailed(
                        "Vendor display helper did not return a value".to_string(),
                    )
                });
            }
            return Err(AdbError::CommandFailed(helper_failure_detail(
                &helper_output.stdout,
                &helper_output.stderr,
            )));
        }
    };

    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        match target {
            DisplayCalibrationTarget::SystemProperty { key } if value.is_empty() => {
                return Err(AdbError::CommandFailed(format!(
                    "Property {key} is empty or not set"
                )));
            }
            DisplayCalibrationTarget::Settings { namespace, key }
                if value.eq_ignore_ascii_case("null") =>
            {
                return Err(AdbError::CommandFailed(format!(
                    "Setting {namespace} {key} is not set"
                )));
            }
            _ => {}
        }
        Ok(value)
    } else {
        Err(AdbError::CommandFailed(output_detail(&output)))
    }
}

fn read_target_result(
    app: &AppHandle,
    serial: &str,
    target: DisplayCalibrationTarget,
) -> Result<DisplayCalibrationReadResult, AdbError> {
    match &target {
        DisplayCalibrationTarget::VendorDisplay { .. } => {
            let helper_output = run_vendor_display_helper_read(app, serial, &target)?;
            let stderr = helper_failure_detail(&helper_output.stdout, &helper_output.stderr);
            Ok(DisplayCalibrationReadResult {
                target,
                readback_value: if helper_output.success {
                    helper_output.value
                } else {
                    None
                },
                command: helper_output.command,
                stdout: helper_output.stdout,
                stderr,
                success: helper_output.success,
            })
        }
        _ => {
            let command = read_command_label(&target);
            match readback_target(app, serial, &target) {
                Ok(value) => Ok(DisplayCalibrationReadResult {
                    target,
                    readback_value: Some(value.clone()),
                    command,
                    stdout: value,
                    stderr: String::new(),
                    success: true,
                }),
                Err(error) => Ok(DisplayCalibrationReadResult {
                    target,
                    readback_value: None,
                    command,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    success: false,
                }),
            }
        }
    }
}

fn read_command_label(target: &DisplayCalibrationTarget) -> String {
    match target {
        DisplayCalibrationTarget::Settings { namespace, key } => {
            format!("settings get {namespace} {key}")
        }
        DisplayCalibrationTarget::SystemProperty { key } => format!("getprop {key}"),
        DisplayCalibrationTarget::Sysfs { path } => format!("cat {path}"),
        DisplayCalibrationTarget::VendorDisplay { .. } => "display-helper read".to_string(),
    }
}

fn live_apply_targets(
    target: &DisplayCalibrationTarget,
    readback_value: &str,
) -> Result<Vec<(DisplayCalibrationTarget, String)>, AdbError> {
    match target {
        DisplayCalibrationTarget::SystemProperty { key }
            if key == "persist.vendor.display.enhance_bright" =>
        {
            Ok(vec![(
                vendor_enhance_component_target(1),
                readback_value.to_string(),
            )])
        }
        DisplayCalibrationTarget::SystemProperty { key }
            if key == "persist.vendor.display.enhance_contrast" =>
        {
            Ok(vec![(
                vendor_enhance_component_target(2),
                readback_value.to_string(),
            )])
        }
        DisplayCalibrationTarget::SystemProperty { key }
            if key == "persist.vendor.display.enhance_saturation" =>
        {
            Ok(vec![(
                vendor_enhance_component_target(6),
                readback_value.to_string(),
            )])
        }
        DisplayCalibrationTarget::Settings { namespace, key }
            if namespace == "system" && key == COLOR_TEMPERATURE_VALUE_KEY =>
        {
            Ok(vec![(
                vendor_color_temperature_target(),
                readback_value.to_string(),
            )])
        }
        DisplayCalibrationTarget::Settings { namespace, key }
            if namespace == "system" && key == COLOR_TEMPERATURE_POINT_KEY =>
        {
            let native_color = color_temperature_point_to_native_color(readback_value)?;
            Ok(vec![(
                vendor_enhance_component_target(10),
                native_color.to_string(),
            )])
        }
        _ => Ok(Vec::new()),
    }
}

fn is_color_temperature_point_target(target: &DisplayCalibrationTarget) -> bool {
    matches!(
        target,
        DisplayCalibrationTarget::Settings { namespace, key }
            if namespace == "system" && key == COLOR_TEMPERATURE_POINT_KEY
    )
}

fn write_color_temperature_value_setting(
    app: &AppHandle,
    serial: &str,
    native_color: i32,
) -> Result<DisplayHelperCommandOutput, AdbError> {
    let target = DisplayCalibrationTarget::Settings {
        namespace: "system".to_string(),
        key: COLOR_TEMPERATURE_VALUE_KEY.to_string(),
    };
    let value = native_color.to_string();
    let (args, preview) = build_write_command(&target, &value)?;
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = adb::run_adb_with_timeout(app, &arg_refs, Some(serial), Duration::from_secs(8))?;
    Ok(DisplayHelperCommandOutput {
        command: preview,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
        value: None,
    })
}

fn color_temperature_point_to_native_color(value: &str) -> Result<i32, AdbError> {
    let (x, y) = parse_color_temperature_point(value)?;
    let dx = x - COLOR_TEMPERATURE_POINT_CENTER;
    let dy = y - COLOR_TEMPERATURE_POINT_CENTER;
    let x_rotated = -dy;
    let y_rotated = dx;
    let hue = normalize_hue(y_rotated.atan2(-x_rotated).to_degrees() + 180.0);
    let saturation =
        (dx.hypot(dy) / COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS).clamp(0.0, 1.0) * 0.498;
    let (red, green, blue) = hsv_to_rgb_bytes(hue, saturation, 1.0);
    let unsigned_color = 0xff00_0000u32 | (red << 16) | (green << 8) | blue;
    Ok(unsigned_color as i32)
}

fn parse_color_temperature_point(value: &str) -> Result<(f64, f64), AdbError> {
    let mut parts = value.split(',');
    let x = parts
        .next()
        .and_then(|part| part.trim().parse::<f64>().ok());
    let y = parts
        .next()
        .and_then(|part| part.trim().parse::<f64>().ok());
    if parts.next().is_some() {
        return Err(invalid_color_temperature_point(value));
    }
    match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Ok((
            x.clamp(0.0, COLOR_TEMPERATURE_POINT_RANGE),
            y.clamp(0.0, COLOR_TEMPERATURE_POINT_RANGE),
        )),
        _ => Err(invalid_color_temperature_point(value)),
    }
}

fn invalid_color_temperature_point(value: &str) -> AdbError {
    AdbError::CommandFailed(format!(
        "Color wheel coordinate must use the Settings x,y format: {value}"
    ))
}

fn normalize_hue(hue: f64) -> f64 {
    hue.rem_euclid(360.0)
}

fn hsv_to_rgb_bytes(hue: f64, saturation: f64, value: f64) -> (u32, u32, u32) {
    let chroma = value * saturation;
    let hue_section = hue / 60.0;
    let x = chroma * (1.0 - ((hue_section % 2.0) - 1.0).abs());
    let m = value - chroma;
    let (red, green, blue) = if (0.0..1.0).contains(&hue_section) {
        (chroma, x, 0.0)
    } else if hue_section < 2.0 {
        (x, chroma, 0.0)
    } else if hue_section < 3.0 {
        (0.0, chroma, x)
    } else if hue_section < 4.0 {
        (0.0, x, chroma)
    } else if hue_section < 5.0 {
        (x, 0.0, chroma)
    } else {
        (chroma, 0.0, x)
    };
    (
        color_channel_to_byte(red + m),
        color_channel_to_byte(green + m),
        color_channel_to_byte(blue + m),
    )
}

fn color_channel_to_byte(value: f64) -> u32 {
    ((value.clamp(0.0, 1.0) * 255.0).round() as u32).min(255)
}

fn vendor_enhance_component_target(component: i32) -> DisplayCalibrationTarget {
    DisplayCalibrationTarget::VendorDisplay {
        service: VENDOR_DISPLAY_SERVICE.to_string(),
        display_id: 0,
        operation: "enhanceComponent".to_string(),
        component: Some(component),
        read_method: "getEnhanceComponent".to_string(),
        write_method: "setEnhanceComponent".to_string(),
    }
}

fn vendor_color_temperature_target() -> DisplayCalibrationTarget {
    DisplayCalibrationTarget::VendorDisplay {
        service: VENDOR_DISPLAY_SERVICE.to_string(),
        display_id: 0,
        operation: "colorTemperature".to_string(),
        component: None,
        read_method: "getColorTemperature".to_string(),
        write_method: "setColorTemperature".to_string(),
    }
}

fn append_output(buffer: &mut String, addition: &str) {
    let addition = addition.trim();
    if addition.is_empty() {
        return;
    }
    if !buffer.trim().is_empty() {
        buffer.push('\n');
    }
    buffer.push_str(addition);
}

fn run_vendor_display_helper_write(
    app: &AppHandle,
    serial: &str,
    target: &DisplayCalibrationTarget,
    value: &str,
) -> Result<DisplayHelperCommandOutput, AdbError> {
    let args = vendor_display_helper_write_args(target, value)?;
    run_display_helper(app, serial, args)
}

fn run_vendor_display_helper_read(
    app: &AppHandle,
    serial: &str,
    target: &DisplayCalibrationTarget,
) -> Result<DisplayHelperCommandOutput, AdbError> {
    let args = vendor_display_helper_read_args(target)?;
    run_display_helper(app, serial, args)
}

fn run_display_helper(
    app: &AppHandle,
    serial: &str,
    args: Vec<String>,
) -> Result<DisplayHelperCommandOutput, AdbError> {
    ensure_display_helper(app, serial)?;
    let command = display_helper_shell_command(&args);
    let shell_args = display_helper_adb_shell_args(&command);
    let output = adb::run_adb_with_timeout(app, &shell_args, Some(serial), Duration::from_secs(8))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let parsed = parse_display_helper_response(&stdout);
    let success = output.status.success() && parsed.as_ref().map(|value| value.ok).unwrap_or(false);
    let value = parsed.as_ref().and_then(display_helper_value_string);
    let stderr = if success {
        stderr
    } else if let Some(response) = parsed {
        match response.error {
            Some(error) if !error.trim().is_empty() => {
                format!("{}{}", stderr, error)
            }
            _ => stderr,
        }
    } else {
        stderr
    };

    Ok(DisplayHelperCommandOutput {
        command: format!("display-helper {}", args.join(" ")),
        stdout,
        stderr,
        success,
        value,
    })
}

fn display_helper_shell_command(args: &[String]) -> String {
    format!(
        "CLASSPATH={} app_process /system/bin {} {}",
        shell_quote(DISPLAY_HELPER_REMOTE_PATH),
        shell_quote(DISPLAY_HELPER_MAIN_CLASS),
        args.iter()
            .map(|arg| shell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn display_helper_adb_shell_args(command: &str) -> [&str; 2] {
    ["shell", command]
}

fn ensure_display_helper(app: &AppHandle, serial: &str) -> Result<(), AdbError> {
    let helper_path = display_helper_apk_path(app)?;
    let helper_path = helper_path.to_string_lossy().to_string();
    let output = adb::run_adb_with_timeout(
        app,
        &["push", &helper_path, DISPLAY_HELPER_REMOTE_PATH],
        Some(serial),
        Duration::from_secs(15),
    )?;
    adb::ensure_success(&output, "push Display Color helper")
}

fn display_helper_apk_path(app: &AppHandle) -> Result<PathBuf, AdbError> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        AdbError::CommandFailed(format!("read app resource directory: {error}"))
    })?;
    let resource_path = resource_dir.join(DISPLAY_HELPER_RESOURCE);
    if resource_path.exists() {
        return Ok(resource_path);
    }

    #[cfg(debug_assertions)]
    {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DISPLAY_HELPER_RESOURCE);
        if manifest_path.exists() {
            return Ok(manifest_path);
        }
    }

    Err(AdbError::CommandFailed(format!(
        "Display Color helper missing at {DISPLAY_HELPER_RESOURCE}"
    )))
}

fn vendor_display_helper_write_args(
    target: &DisplayCalibrationTarget,
    value: &str,
) -> Result<Vec<String>, AdbError> {
    let value = vendor_display_int_value(value)?;
    match target {
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            component,
            ..
        } if operation == "enhanceComponent" => {
            let component = component.ok_or_else(|| {
                AdbError::CommandFailed(
                    "Vendor display enhance target requires a component id".to_string(),
                )
            })?;
            Ok(vec![
                "setEnhanceComponent".to_string(),
                display_id.to_string(),
                component.to_string(),
                value.to_string(),
            ])
        }
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "smartBacklight" => Ok(vec![
            "setSmartBacklight".to_string(),
            display_id.to_string(),
            value.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "colorTemperature" => Ok(vec![
            "setColorTemperature".to_string(),
            display_id.to_string(),
            value.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "blackWhiteMode" => Ok(vec![
            "setBlackWhiteMode".to_string(),
            display_id.to_string(),
            value.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "readingMode" => Ok(vec![
            "setReadingMode".to_string(),
            display_id.to_string(),
            value.to_string(),
        ]),
        _ => Err(AdbError::CommandFailed(
            "Unsupported vendor display write target".to_string(),
        )),
    }
}

fn vendor_display_helper_read_args(
    target: &DisplayCalibrationTarget,
) -> Result<Vec<String>, AdbError> {
    match target {
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            component,
            ..
        } if operation == "enhanceComponent" => {
            let component = component.ok_or_else(|| {
                AdbError::CommandFailed(
                    "Vendor display enhance target requires a component id".to_string(),
                )
            })?;
            Ok(vec![
                "getEnhanceComponent".to_string(),
                display_id.to_string(),
                component.to_string(),
            ])
        }
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "smartBacklight" => Ok(vec![
            "getSmartBacklight".to_string(),
            display_id.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "colorTemperature" => Ok(vec![
            "getColorTemperature".to_string(),
            display_id.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "blackWhiteMode" => Ok(vec![
            "getBlackWhiteMode".to_string(),
            display_id.to_string(),
        ]),
        DisplayCalibrationTarget::VendorDisplay {
            display_id,
            operation,
            ..
        } if operation == "readingMode" => {
            Ok(vec!["getReadingMode".to_string(), display_id.to_string()])
        }
        _ => Err(AdbError::CommandFailed(
            "Unsupported vendor display read target".to_string(),
        )),
    }
}

fn vendor_display_int_value(value: &str) -> Result<i32, AdbError> {
    value.parse::<i32>().map_err(|_| {
        AdbError::CommandFailed(format!("Vendor display value must be an integer: {value}"))
    })
}

fn parse_display_helper_response(stdout: &str) -> Option<DisplayHelperResponse> {
    stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<DisplayHelperResponse>(line.trim()).ok())
}

fn display_helper_value_string(response: &DisplayHelperResponse) -> Option<String> {
    match response.value.as_ref()? {
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(if *value { "1" } else { "0" }.to_string()),
        serde_json::Value::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn helper_failure_detail(stdout: &str, stderr: &str) -> String {
    let parts = [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        "Display Color helper failed without output".to_string()
    } else {
        parts.join("\n")
    }
}

fn root_request_succeeded(status_success: bool, stdout: &str, stderr: &str) -> bool {
    if !status_success {
        return false;
    }
    let detail = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    ![
        "cannot run as root",
        "adbd cannot run as root",
        "not allowed",
        "permission denied",
        "failed",
    ]
    .iter()
    .any(|needle| detail.contains(needle))
}

fn build_profile_markdown(profile: &DisplayCalibrationProfile) -> String {
    let created_at = profile
        .created_at
        .clone()
        .unwrap_or_else(|| Local::now().to_rfc3339());
    let mut body = String::new();
    body.push_str("# Display Calibration Profile\n\n");
    body.push_str(&format!("- Profile: {}\n", profile.profile_name));
    body.push_str(&format!("- Created at: {created_at}\n"));
    body.push_str(&format!("- ADB serial: {}\n", profile.device.adb_serial));
    if let Some(device_sn) = &profile.device.device_sn {
        body.push_str(&format!("- Device SN: {device_sn}\n"));
    }
    if let Some(model) = &profile.device.model {
        body.push_str(&format!("- Model: {model}\n"));
    }
    if let Some(version) = &profile.device.firmware_version {
        body.push_str(&format!("- Firmware: {version}\n"));
    }
    if let Some(fingerprint) = &profile.device.build_fingerprint {
        body.push_str(&format!("- Build fingerprint: `{fingerprint}`\n"));
    }
    body.push('\n');
    body.push_str("## Parameters\n\n");
    body.push_str("| Name | Target | Baseline | Desired | Readback | Visible effect | Physical validation |\n");
    body.push_str("| --- | --- | --- | --- | --- | --- | --- |\n");
    for parameter in &profile.parameters {
        body.push_str(&format!(
            "| {} | `{}` | {} | {} | {} | {} | {} |\n",
            markdown_cell(&parameter.name),
            target_label(&parameter.target),
            markdown_cell(parameter.baseline_value.as_deref().unwrap_or("-")),
            markdown_cell(&parameter.desired_value),
            markdown_cell(parameter.readback_value.as_deref().unwrap_or("-")),
            match parameter.visible_effect_confirmed {
                Some(true) => "confirmed",
                Some(false) => "not confirmed",
                None => "not checked",
            },
            if parameter.requires_physical_validation {
                "required"
            } else {
                "not required"
            }
        ));
    }
    body.push('\n');
    body.push_str(
        "## Notes\n\nADB readback proves the software-visible parameter value. Final panel color still needs physical-screen validation, because vendor PQ or display hardware can apply color processing after Android screenshot capture.\n",
    );
    if let Some(notes) = &profile.notes {
        body.push('\n');
        body.push_str(notes);
        body.push('\n');
    }
    body
}

fn validate_profile(profile: &DisplayCalibrationProfile) -> Result<(), AdbError> {
    if profile.profile_name.trim().is_empty() {
        return Err(AdbError::CommandFailed(
            "Display calibration profile name is required".to_string(),
        ));
    }
    selected_serial(&profile.device.adb_serial)?;
    if profile.parameters.is_empty() {
        return Err(AdbError::CommandFailed(
            "Display calibration profile has no parameters".to_string(),
        ));
    }
    for parameter in &profile.parameters {
        if parameter.name.trim().is_empty() {
            return Err(AdbError::CommandFailed(
                "Display calibration parameter name is required".to_string(),
            ));
        }
        validate_target(&parameter.target)?;
        validate_write_value(&parameter.desired_value)?;
    }
    Ok(())
}

fn validate_target(target: &DisplayCalibrationTarget) -> Result<(), AdbError> {
    match target {
        DisplayCalibrationTarget::Settings { namespace, key } => {
            validate_settings_namespace(namespace)?;
            validate_key_token(key, "settings key")
        }
        DisplayCalibrationTarget::SystemProperty { key } => validate_key_token(key, "property key"),
        DisplayCalibrationTarget::Sysfs { path } => validate_sysfs_path(path),
        DisplayCalibrationTarget::VendorDisplay {
            service,
            display_id,
            operation,
            component,
            read_method,
            write_method,
        } => {
            validate_vendor_display_service(service)?;
            if *display_id < 0 || *display_id > 8 {
                return Err(AdbError::CommandFailed(format!(
                    "Invalid vendor display id: {display_id}"
                )));
            }
            if let Some(component) = component {
                if *component < 0 || *component > 64 {
                    return Err(AdbError::CommandFailed(format!(
                        "Invalid vendor display component: {component}"
                    )));
                }
            }
            validate_key_token(operation, "vendor display operation")?;
            validate_key_token(read_method, "vendor display read method")?;
            validate_key_token(write_method, "vendor display write method")
        }
    }
}

fn validate_vendor_display_service(service: &str) -> Result<(), AdbError> {
    if service == VENDOR_DISPLAY_SERVICE {
        Ok(())
    } else {
        Err(AdbError::CommandFailed(format!(
            "Unsupported vendor display service: {service}"
        )))
    }
}

fn validate_settings_namespace(namespace: &str) -> Result<(), AdbError> {
    match namespace {
        "system" | "secure" | "global" => Ok(()),
        _ => Err(AdbError::CommandFailed(format!(
            "Unsupported settings namespace: {namespace}"
        ))),
    }
}

fn validate_key_token(value: &str, label: &str) -> Result<(), AdbError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 120
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':' | '/'))
    {
        return Err(AdbError::CommandFailed(format!("Invalid {label}: {value}")));
    }
    Ok(())
}

fn validate_sysfs_path(path: &str) -> Result<(), AdbError> {
    let path = path.trim();
    if !path.starts_with("/sys/")
        || path.contains("..")
        || path.len() > 240
        || path.chars().any(|ch| {
            ch.is_control()
                || matches!(
                    ch,
                    '\'' | '"' | '`' | '$' | ';' | '&' | '|' | '<' | '>' | '(' | ')' | '\\'
                )
        })
    {
        return Err(AdbError::CommandFailed(format!(
            "Invalid sysfs path: {path}"
        )));
    }
    Ok(())
}

fn validate_write_value(value: &str) -> Result<String, AdbError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_VALUE_BYTES
        || value.chars().any(|ch| {
            ch.is_control()
                || matches!(
                    ch,
                    '\'' | '"' | '`' | '$' | ';' | '&' | '|' | '<' | '>' | '(' | ')' | '\\'
                )
        })
    {
        return Err(AdbError::CommandFailed(
            "Invalid display calibration value".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn selected_serial(device_serial: &str) -> Result<&str, AdbError> {
    let serial = device_serial.trim();
    if serial.is_empty() {
        return Err(AdbError::CommandFailed(
            "A selected online device is required for display calibration".to_string(),
        ));
    }
    Ok(serial)
}

fn resolve_executable_serial(app: &AppHandle, device_serial: &str) -> Result<String, AdbError> {
    let serial = selected_serial(device_serial)?.to_string();
    let Some(device_sn) = mdns_service_device_sn(&serial) else {
        return Ok(serial);
    };

    Ok(resolve_mdns_service_to_connected_serial(app, &serial, &device_sn).unwrap_or(serial))
}

fn resolve_mdns_service_to_connected_serial(
    app: &AppHandle,
    mdns_serial: &str,
    device_sn: &str,
) -> Option<String> {
    let output =
        adb::run_adb_with_timeout(app, &["devices", "-l"], None, Duration::from_secs(8)).ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for candidate in adb_device_serials_from_devices_output(&stdout) {
        if candidate == mdns_serial || mdns_service_device_sn(&candidate).is_some() {
            continue;
        }
        if read_serial_number_for_candidate(app, &candidate).as_deref() == Some(device_sn) {
            return Some(candidate);
        }
    }

    None
}

fn read_serial_number_for_candidate(app: &AppHandle, adb_serial: &str) -> Option<String> {
    let output = adb::run_adb_with_timeout(
        app,
        &["shell", "getprop", "ro.serialno"],
        Some(adb_serial),
        Duration::from_secs(3),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn adb_device_serials_from_devices_output(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            (state == "device").then(|| serial.to_string())
        })
        .collect()
}

fn mdns_service_device_sn(serial: &str) -> Option<String> {
    let serial = serial.strip_prefix("adb-")?;
    let (device_sn, _) = serial.split_once('-')?;
    if device_sn.is_empty() || !serial.contains("._adb-tls-connect._tcp") {
        return None;
    }
    Some(device_sn.to_string())
}

fn bounded_text(value: &str) -> (String, bool) {
    if value.len() <= MAX_PROBE_TEXT_BYTES {
        return (value.to_string(), false);
    }

    let mut end = MAX_PROBE_TEXT_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true)
}

fn matches_discovery_keyword(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    DISCOVERY_KEYWORDS
        .iter()
        .any(|keyword| lower.contains(keyword))
}

fn confidence_for_key(key: &str) -> u8 {
    let lower = key.to_ascii_lowercase();
    let mut score = 25u8;
    for keyword in [
        "saturation",
        "contrast",
        "temperature",
        "color_temperature",
        "colour_temperature",
        "gamma",
        "cabc",
        "pq",
        "picture",
        "enhance",
        "backlight",
        "reading",
        "black",
        "white",
    ] {
        if lower.contains(keyword) {
            score = score.saturating_add(15);
        }
    }
    if lower.contains("display") || lower.contains("screen") || lower.contains("color") {
        score = score.saturating_add(8);
    }
    score.min(95)
}

fn discovery_reason(key: &str) -> String {
    let lower = key.to_ascii_lowercase();
    let hits = DISCOVERY_KEYWORDS
        .iter()
        .filter(|keyword| lower.contains(**keyword))
        .copied()
        .collect::<Vec<_>>();
    if hits.is_empty() {
        "Contains display/color calibration keywords".to_string()
    } else {
        format!("Matched keywords: {}", hits.join(", "))
    }
}

fn parse_key_value_line(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once('=')?;
    let key = key.trim();
    let value = value.trim();
    if key.is_empty() {
        None
    } else {
        Some((key, value))
    }
}

fn parse_property_line(line: &str) -> Option<(&str, &str)> {
    let without_prefix = line.strip_prefix('[')?;
    let (key, rest) = without_prefix.split_once("]: [")?;
    let value = rest.strip_suffix(']')?;
    if key.is_empty() {
        None
    } else {
        Some((key, value))
    }
}

fn candidate_id(target: &DisplayCalibrationTarget) -> String {
    match target {
        DisplayCalibrationTarget::Settings { namespace, key } => {
            format!("settings:{namespace}:{key}")
        }
        DisplayCalibrationTarget::SystemProperty { key } => format!("property:{key}"),
        DisplayCalibrationTarget::Sysfs { path } => format!("sysfs:{path}"),
        DisplayCalibrationTarget::VendorDisplay {
            service,
            display_id,
            operation,
            component,
            read_method,
            write_method,
        } => format!(
            "vendor-display:{service}:{display_id}:{operation}:{}:{read_method}:{write_method}",
            component
                .map(|value| value.to_string())
                .unwrap_or_else(|| "none".to_string())
        ),
    }
}

fn stable_line_key(line: &str) -> String {
    let mut hash = 5381u64;
    for byte in line.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    format!("{hash:016x}")
}

fn first_words(value: &str, count: usize) -> String {
    value
        .split_whitespace()
        .take(count)
        .collect::<Vec<_>>()
        .join(" ")
}

fn target_label(target: &DisplayCalibrationTarget) -> String {
    match target {
        DisplayCalibrationTarget::Settings { namespace, key } => {
            format!("settings {namespace} {key}")
        }
        DisplayCalibrationTarget::SystemProperty { key } => format!("setprop {key}"),
        DisplayCalibrationTarget::Sysfs { path } => format!("sysfs {path}"),
        DisplayCalibrationTarget::VendorDisplay {
            service,
            operation,
            component,
            read_method,
            write_method,
            ..
        } => match component {
            Some(component) => {
                format!("{service} {operation} component={component} {read_method}/{write_method}")
            }
            None => format!("{service} {operation} {read_method}/{write_method}"),
        },
    }
}

fn markdown_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn test_pattern_path(app: &AppHandle, filename: &str) -> Result<PathBuf, AdbError> {
    let dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("display-calibration");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(filename))
}

fn generate_test_pattern_png(path: &PathBuf) -> Result<(), AdbError> {
    let mut image = RgbImage::from_pixel(1600, 1000, Rgb([248, 248, 248]));
    draw_gray_ramp(&mut image, 80, 80, 1440, 120);
    draw_color_patches(&mut image, 80, 250, 1440, 220);
    draw_hsv_disc(&mut image, 240, 650, 210);
    draw_edge_patterns(&mut image, 600, 560, 850, 300);
    image.save(path).map_err(|error| {
        AdbError::CommandFailed(format!("Failed to write display test pattern: {error}"))
    })
}

fn draw_gray_ramp(image: &mut RgbImage, x: u32, y: u32, width: u32, height: u32) {
    for step in 0..16 {
        let value = (step * 17) as u8;
        fill_rect(
            image,
            x + step * width / 16,
            y,
            width / 16,
            height,
            Rgb([value, value, value]),
        );
    }
}

fn draw_color_patches(image: &mut RgbImage, x: u32, y: u32, width: u32, height: u32) {
    let colors = [
        Rgb([255, 0, 0]),
        Rgb([0, 255, 0]),
        Rgb([0, 0, 255]),
        Rgb([255, 255, 0]),
        Rgb([0, 255, 255]),
        Rgb([255, 0, 255]),
        Rgb([255, 180, 120]),
        Rgb([128, 96, 72]),
    ];
    let patch_width = width / colors.len() as u32;
    for (index, color) in colors.into_iter().enumerate() {
        fill_rect(
            image,
            x + index as u32 * patch_width,
            y,
            patch_width,
            height,
            color,
        );
    }
}

fn draw_hsv_disc(image: &mut RgbImage, center_x: i32, center_y: i32, radius: i32) {
    for y in -radius..=radius {
        for x in -radius..=radius {
            let distance = ((x * x + y * y) as f32).sqrt();
            if distance > radius as f32 {
                continue;
            }
            let hue = (y as f32).atan2(x as f32).to_degrees().rem_euclid(360.0);
            let saturation = distance / radius as f32;
            let rgb = hsv_to_rgb(hue, saturation, 1.0);
            let px = center_x + x;
            let py = center_y + y;
            if px >= 0 && py >= 0 && px < image.width() as i32 && py < image.height() as i32 {
                image.put_pixel(px as u32, py as u32, rgb);
            }
        }
    }
}

fn draw_edge_patterns(image: &mut RgbImage, x: u32, y: u32, width: u32, height: u32) {
    fill_rect(image, x, y, width, height, Rgb([255, 255, 255]));
    for i in 0..width {
        let color = if i % 16 < 8 { 0 } else { 255 };
        fill_rect(image, x + i, y, 1, height / 2, Rgb([color, color, color]));
    }
    for row in 0..height / 2 {
        let color = if row % 16 < 8 { 0 } else { 255 };
        fill_rect(
            image,
            x,
            y + height / 2 + row,
            width,
            1,
            Rgb([color, color, color]),
        );
    }
}

fn fill_rect(image: &mut RgbImage, x: u32, y: u32, width: u32, height: u32, color: Rgb<u8>) {
    let max_x = (x + width).min(image.width());
    let max_y = (y + height).min(image.height());
    for py in y..max_y {
        for px in x..max_x {
            image.put_pixel(px, py, color);
        }
    }
}

fn hsv_to_rgb(hue: f32, saturation: f32, value: f32) -> Rgb<u8> {
    let chroma = value * saturation;
    let hue_prime = hue / 60.0;
    let x = chroma * (1.0 - (hue_prime % 2.0 - 1.0).abs());
    let (r1, g1, b1) = match hue_prime as u32 {
        0 => (chroma, x, 0.0),
        1 => (x, chroma, 0.0),
        2 => (0.0, chroma, x),
        3 => (0.0, x, chroma),
        4 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let m = value - chroma;
    Rgb([
        ((r1 + m) * 255.0).round() as u8,
        ((g1 + m) * 255.0).round() as u8,
        ((b1 + m) * 255.0).round() as u8,
    ])
}

fn ensure_success(output: &std::process::Output, context: &str) -> Result<(), AdbError> {
    if output.status.success() {
        return Ok(());
    }
    Err(AdbError::CommandFailed(format!(
        "{context}: {}",
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
        "no output".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(id: &str, stdout: &str) -> DisplayCalibrationProbe {
        DisplayCalibrationProbe {
            id: id.to_string(),
            label: id.to_string(),
            command: "adb".to_string(),
            exit_code: Some(0),
            stdout: stdout.to_string(),
            stderr: String::new(),
            success: true,
            truncated: false,
        }
    }

    #[test]
    fn extracts_writable_settings_candidates() {
        let candidates = collect_candidates(&[probe(
            "settings_system",
            "volume_music=10\ncolor_temperature=6500\nplain_key=value\n",
        )]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "settings:system:color_temperature");
        assert!(candidates[0].writable);
        assert_eq!(candidates[0].value, "6500");
    }

    #[test]
    fn diffs_changed_candidate_values() {
        let before = DisplayCalibrationSnapshot {
            captured_at: "before".to_string(),
            device_serial: "device-1".to_string(),
            probes: vec![probe("settings_system", "color_temperature=6500\n")],
            candidates: collect_candidates(&[probe("settings_system", "color_temperature=6500\n")]),
        };
        let after = DisplayCalibrationSnapshot {
            captured_at: "after".to_string(),
            device_serial: "device-1".to_string(),
            probes: vec![probe("settings_system", "color_temperature=7200\n")],
            candidates: collect_candidates(&[probe("settings_system", "color_temperature=7200\n")]),
        };

        let diff = diff_snapshots(&before, &after);

        assert_eq!(diff.changed.len(), 1);
        assert_eq!(diff.changed[0].before_value, "6500");
        assert_eq!(diff.changed[0].after_value, "7200");
    }

    #[test]
    fn rejects_unsafe_write_targets_and_values() {
        assert!(validate_settings_namespace("system").is_ok());
        assert!(validate_settings_namespace("bad").is_err());
        assert!(validate_key_token("persist.vendor.display.color", "property key").is_ok());
        assert!(validate_key_token("bad;rm", "property key").is_err());
        assert!(validate_sysfs_path("/sys/class/backlight/panel0-backlight/brightness").is_ok());
        assert!(validate_sysfs_path("/data/local/tmp/value").is_err());
        assert!(validate_write_value("42").is_ok());
        assert!(validate_write_value("42;reboot").is_err());
    }

    #[test]
    fn vendor_display_targets_are_validated_but_not_written_directly() {
        let target = DisplayCalibrationTarget::VendorDisplay {
            service: "vendor.display.output.IDisplayOutputManager/default".to_string(),
            display_id: 0,
            operation: "enhanceComponent".to_string(),
            component: Some(1),
            read_method: "getDisplayBright".to_string(),
            write_method: "setDisplayBright".to_string(),
        };

        assert!(validate_target(&target).is_ok());
        assert!(target_label(&target).contains("component=1"));
        assert!(build_write_command(&target, "42").is_err());
        assert_eq!(
            vendor_display_helper_write_args(&target, "42").unwrap(),
            vec![
                "setEnhanceComponent".to_string(),
                "0".to_string(),
                "1".to_string(),
                "42".to_string()
            ]
        );
        assert_eq!(
            vendor_display_helper_read_args(&target).unwrap(),
            vec![
                "getEnhanceComponent".to_string(),
                "0".to_string(),
                "1".to_string()
            ]
        );
    }

    #[test]
    fn vendor_display_targets_accept_frontend_camel_case_fields() {
        let target: DisplayCalibrationTarget = serde_json::from_value(serde_json::json!({
            "kind": "vendorDisplay",
            "service": "vendor.display.output.IDisplayOutputManager/default",
            "displayId": 0,
            "operation": "enhanceComponent",
            "component": 2,
            "readMethod": "getDisplayContrast",
            "writeMethod": "setDisplayContrast"
        }))
        .unwrap();

        assert_eq!(
            target,
            DisplayCalibrationTarget::VendorDisplay {
                service: "vendor.display.output.IDisplayOutputManager/default".to_string(),
                display_id: 0,
                operation: "enhanceComponent".to_string(),
                component: Some(2),
                read_method: "getDisplayContrast".to_string(),
                write_method: "setDisplayContrast".to_string(),
            }
        );

        let serialized = serde_json::to_value(&target).unwrap();
        assert_eq!(serialized["displayId"], 0);
        assert_eq!(serialized["readMethod"], "getDisplayContrast");
        assert_eq!(serialized["writeMethod"], "setDisplayContrast");
        assert!(serialized.get("display_id").is_none());
    }

    #[test]
    fn property_targets_map_to_live_vendor_display_apply() {
        let bright = DisplayCalibrationTarget::SystemProperty {
            key: "persist.vendor.display.enhance_bright".to_string(),
        };
        let (target, value) = live_apply_targets(&bright, "24").unwrap().remove(0);
        assert_eq!(value, "24");
        assert_eq!(
            vendor_display_helper_write_args(&target, &value).unwrap(),
            vec![
                "setEnhanceComponent".to_string(),
                "0".to_string(),
                "1".to_string(),
                "24".to_string()
            ]
        );

        let color_temperature = DisplayCalibrationTarget::Settings {
            namespace: "system".to_string(),
            key: "aw_color_temperature_value".to_string(),
        };
        let (target, value) = live_apply_targets(&color_temperature, "-2603")
            .unwrap()
            .remove(0);
        assert_eq!(value, "-2603");
        assert_eq!(
            vendor_display_helper_write_args(&target, &value).unwrap(),
            vec![
                "setColorTemperature".to_string(),
                "0".to_string(),
                "-2603".to_string()
            ]
        );
    }

    #[test]
    fn color_temperature_point_matches_settings_color_picker_formula() {
        assert_eq!(
            color_temperature_point_to_native_color("102.5,102.5").unwrap(),
            -1
        );
        assert_eq!(
            color_temperature_point_to_native_color("205,102.5").unwrap(),
            -4_161_281
        );
        assert_eq!(
            color_temperature_point_to_native_color("102.5,0").unwrap(),
            -32_640
        );
        assert!(color_temperature_point_to_native_color("bad").is_err());
    }

    #[test]
    fn color_temperature_point_maps_to_srgb_white_point_live_apply() {
        let color_point = DisplayCalibrationTarget::Settings {
            namespace: "system".to_string(),
            key: "srgb_color_temperature".to_string(),
        };
        let (target, value) = live_apply_targets(&color_point, "205,102.5")
            .unwrap()
            .remove(0);

        assert_eq!(value, "-4161281");
        assert_eq!(
            vendor_display_helper_write_args(&target, &value).unwrap(),
            vec![
                "setEnhanceComponent".to_string(),
                "0".to_string(),
                "10".to_string(),
                "-4161281".to_string()
            ]
        );
    }

    #[test]
    fn display_helper_uses_single_adb_shell_command() {
        let command = display_helper_shell_command(&[
            "getEnhanceComponent".to_string(),
            "0".to_string(),
            "1".to_string(),
        ]);
        let adb_args = display_helper_adb_shell_args(&command);

        assert_eq!(adb_args[0], "shell");
        assert!(adb_args[1].starts_with("CLASSPATH="));
        assert!(adb_args[1].contains("app_process /system/bin"));
        assert!(adb_args[1].contains(DISPLAY_HELPER_MAIN_CLASS));
        assert!(!adb_args.contains(&"sh"));
        assert!(!adb_args.contains(&"-c"));
    }

    #[test]
    fn root_request_rejects_production_build_denials() {
        assert!(root_request_succeeded(
            true,
            "restarting adbd as root\n",
            ""
        ));
        assert!(root_request_succeeded(
            true,
            "adbd is already running as root\n",
            ""
        ));
        assert!(!root_request_succeeded(
            true,
            "adbd cannot run as root in production builds\n",
            ""
        ));
        assert!(!root_request_succeeded(
            false,
            "",
            "error: device not found"
        ));
    }

    #[test]
    fn parses_display_helper_json_values() {
        let number = parse_display_helper_response(
            "noise\n{\"ok\":true,\"operation\":\"getEnhanceComponent\",\"value\":57}\n",
        )
        .unwrap();
        assert!(number.ok);
        assert_eq!(display_helper_value_string(&number), Some("57".to_string()));

        let boolean = parse_display_helper_response(
            "{\"ok\":true,\"operation\":\"getBlackWhiteMode\",\"value\":true}\n",
        )
        .unwrap();
        assert_eq!(display_helper_value_string(&boolean), Some("1".to_string()));
    }

    #[test]
    fn parses_mdns_service_serial_for_device_sn() {
        assert_eq!(
            mdns_service_device_sn("adb-GC7N10001XL-38aWJJ._adb-tls-connect._tcp"),
            Some("GC7N10001XL".to_string())
        );
        assert_eq!(mdns_service_device_sn("192.168.110.206:37511"), None);
        assert_eq!(
            mdns_service_device_sn("adb-GC7N10001XL-38aWJJ._adb-tls-pairing._tcp"),
            None
        );
    }

    #[test]
    fn extracts_online_adb_device_serials_from_devices_output() {
        let serials = adb_device_serials_from_devices_output(
            "List of devices attached\n\
             192.168.110.206:37511  device product:KB07 model:CD_27541F1 device:KB07 transport_id:1\n\
             adb-GC7N10001XL-38aWJJ._adb-tls-connect._tcp offline\n\
             emulator-5554 unauthorized\n",
        );

        assert_eq!(serials, vec!["192.168.110.206:37511"]);
    }

    #[test]
    fn builds_supplier_export_markdown() {
        let profile = DisplayCalibrationProfile {
            profile_name: "Warm startup profile".to_string(),
            created_at: Some("2026-07-02T00:00:00+08:00".to_string()),
            device: DisplayCalibrationDeviceIdentity {
                adb_serial: "NCRC10008CC".to_string(),
                device_sn: Some("NCRC10008CC".to_string()),
                model: Some("Cozyla".to_string()),
                build_fingerprint: Some("cozyla/test".to_string()),
                firmware_version: Some("v-test".to_string()),
            },
            parameters: vec![DisplayCalibrationProfileParameter {
                name: "Color temperature".to_string(),
                target: DisplayCalibrationTarget::Settings {
                    namespace: "system".to_string(),
                    key: "color_temperature".to_string(),
                },
                baseline_value: Some("6500".to_string()),
                desired_value: "7200".to_string(),
                readback_value: Some("7200".to_string()),
                visible_effect_confirmed: Some(true),
                requires_physical_validation: true,
                notes: None,
            }],
            notes: None,
        };

        validate_profile(&profile).unwrap();
        let markdown = build_profile_markdown(&profile);

        assert!(markdown.contains("Warm startup profile"));
        assert!(markdown.contains("settings system color_temperature"));
        assert!(markdown.contains("physical-screen validation"));
    }

    #[test]
    fn generates_hsv_reference_colors() {
        assert_eq!(hsv_to_rgb(0.0, 1.0, 1.0), Rgb([255, 0, 0]));
        assert_eq!(hsv_to_rgb(120.0, 1.0, 1.0), Rgb([0, 255, 0]));
        assert_eq!(hsv_to_rgb(240.0, 1.0, 1.0), Rgb([0, 0, 255]));
    }
}
