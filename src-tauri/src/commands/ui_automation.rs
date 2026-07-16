use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::adb::{self, AdbError};
use crate::commands::agent;

const UI_AUTOMATION_TIMEOUT: Duration = Duration::from_secs(12);
const UI_SNAPSHOT_LIMIT: usize = 24_000;
const UI_NODE_LIMIT: usize = 160;
const MAX_UI_DIMENSION: i32 = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiNode {
    pub text: String,
    #[serde(alias = "content_desc")]
    pub content_desc: String,
    #[serde(alias = "resource_id")]
    pub resource_id: String,
    #[serde(alias = "class_name")]
    pub class_name: String,
    pub bounds: String,
    pub clickable: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSnapshotResponse {
    #[serde(default)]
    pub device_serial: String,
    pub width: i32,
    pub height: i32,
    pub nodes: Vec<UiNode>,
    #[serde(default)]
    pub xml: String,
    pub source: String,
    #[serde(default)]
    pub fallback_attempted: bool,
    #[serde(default)]
    pub fallback_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiActionResponse {
    pub action: String,
    pub device_serial: String,
    pub width: i32,
    pub height: i32,
    pub output: String,
    pub source: String,
}

#[tauri::command(async)]
pub fn adb_ui_snapshot(
    app: AppHandle,
    device_serial: String,
) -> Result<UiSnapshotResponse, AdbError> {
    if let Some(value) = agent::agent_ui_request(&device_serial, "/ui/snapshot", Some("{}"))
        .map_err(AdbError::CommandFailed)?
    {
        let mut snapshot =
            serde_json::from_value::<UiSnapshotResponse>(value).map_err(|error| {
                AdbError::CommandFailed(format!("parse Agent accessibility UI snapshot: {error}"))
            })?;
        snapshot.device_serial = device_serial;
        snapshot.source = "accessibility".to_string();
        if !should_fallback_to_uiautomator(&snapshot) {
            return Ok(snapshot);
        }

        match read_uiautomator_snapshot(&app, &snapshot.device_serial, true) {
            Ok(fallback) => return Ok(fallback),
            Err(error) => {
                snapshot.fallback_attempted = true;
                snapshot.fallback_error = Some(error.to_string());
                return Ok(snapshot);
            }
        }
    }
    read_uiautomator_snapshot(&app, &device_serial, false)
}

fn should_fallback_to_uiautomator(snapshot: &UiSnapshotResponse) -> bool {
    if snapshot.source != "accessibility" {
        return false;
    }
    if snapshot.nodes.is_empty() {
        return true;
    }

    // Some vendor accessibility trees expose clickable containers but omit all
    // text/content descriptions from their children. The tree is non-empty in
    // that case, but it is not sufficient to resolve the next semantic tap.
    // A repeated unlabeled resource id is a strong signal for that shape (for
    // example, three view-mode rows all reported as `linear_bg`).
    let unlabeled_clickable_nodes: Vec<&UiNode> = snapshot
        .nodes
        .iter()
        .filter(|node| {
            node.clickable
                && node.enabled
                && node.text.trim().is_empty()
                && node.content_desc.trim().is_empty()
        })
        .collect();
    if unlabeled_clickable_nodes.len() < 2 {
        return false;
    }
    unlabeled_clickable_nodes.iter().any(|candidate| {
        let resource_id = candidate.resource_id.trim();
        !resource_id.is_empty()
            && unlabeled_clickable_nodes
                .iter()
                .filter(|node| node.resource_id.trim() == resource_id)
                .count()
                > 1
    })
}

fn read_uiautomator_snapshot(
    app: &AppHandle,
    device_serial: &str,
    fallback_attempted: bool,
) -> Result<UiSnapshotResponse, AdbError> {
    let (width, height) = device_size(app, device_serial)?;
    // Some Android/vendor builds print only the dump status to stdout when the
    // destination is /dev/tty. Dump to a device file and cat it separately so
    // the hierarchy transport is deterministic across devices.
    let remote_path = format!(
        "/sdcard/adb-manager-ui-{}-{}.xml",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    );
    let cleanup = || {
        let _ = adb::run_adb_with_timeout(
            app,
            &["shell", "rm", "-f", &remote_path],
            Some(device_serial),
            UI_AUTOMATION_TIMEOUT,
        );
    };
    let dump_output = match adb::run_adb_with_timeout(
        app,
        &["shell", "uiautomator", "dump", &remote_path],
        Some(device_serial),
        UI_AUTOMATION_TIMEOUT,
    ) {
        Ok(output) => output,
        Err(error) => {
            cleanup();
            return Err(error);
        }
    };
    if let Err(error) = adb::ensure_success(&dump_output, "write UI hierarchy dump") {
        cleanup();
        return Err(error);
    }

    let xml_output = match adb::run_adb_with_timeout(
        app,
        &["shell", "cat", &remote_path],
        Some(device_serial),
        UI_AUTOMATION_TIMEOUT,
    ) {
        Ok(output) => output,
        Err(error) => {
            cleanup();
            return Err(error);
        }
    };
    if let Err(error) = adb::ensure_success(&xml_output, "read UI hierarchy dump") {
        cleanup();
        return Err(error);
    }
    let xml = normalize_ui_xml(&String::from_utf8_lossy(&xml_output.stdout));
    cleanup();
    if xml.is_empty() {
        return Err(AdbError::CommandFailed(
            "UI hierarchy dump returned no XML".to_string(),
        ));
    }
    Ok(UiSnapshotResponse {
        device_serial: device_serial.to_string(),
        width,
        height,
        nodes: parse_ui_nodes(&xml),
        xml: truncate_utf8(&xml, UI_SNAPSHOT_LIMIT),
        source: "adb_uiautomator".to_string(),
        fallback_attempted,
        fallback_error: None,
    })
}

#[tauri::command(async)]
pub fn adb_ui_tap(
    app: AppHandle,
    device_serial: String,
    x: i32,
    y: i32,
) -> Result<UiActionResponse, AdbError> {
    let (width, height) = device_size(&app, &device_serial)?;
    validate_point(x, y, width, height)?;
    if let Some(value) = agent::agent_ui_request(
        &device_serial,
        "/ui/tap",
        Some(&format!("{{\"x\":{x},\"y\":{y}}}")),
    )
    .map_err(AdbError::CommandFailed)?
    {
        return Ok(agent_action_response(
            "tap",
            device_serial,
            width,
            height,
            value,
        ));
    }
    let output = adb::run_adb_with_timeout(
        &app,
        &["shell", "input", "tap", &x.to_string(), &y.to_string()],
        Some(&device_serial),
        UI_AUTOMATION_TIMEOUT,
    )?;
    adb::ensure_success(&output, "tap UI")?;
    Ok(ui_action_response(
        "tap",
        device_serial,
        width,
        height,
        output,
    ))
}

#[tauri::command(async)]
pub fn adb_ui_swipe(
    app: AppHandle,
    device_serial: String,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: Option<i32>,
) -> Result<UiActionResponse, AdbError> {
    let (width, height) = device_size(&app, &device_serial)?;
    validate_point(x1, y1, width, height)?;
    validate_point(x2, y2, width, height)?;
    let duration = duration_ms.unwrap_or(320).clamp(80, 2_000);
    if let Some(value) = agent::agent_ui_request(
        &device_serial,
        "/ui/swipe",
        Some(&format!(
            "{{\"x1\":{x1},\"y1\":{y1},\"x2\":{x2},\"y2\":{y2},\"duration_ms\":{duration}}}"
        )),
    )
    .map_err(AdbError::CommandFailed)?
    {
        return Ok(agent_action_response(
            "swipe",
            device_serial,
            width,
            height,
            value,
        ));
    }
    let output = adb::run_adb_with_timeout(
        &app,
        &[
            "shell",
            "input",
            "swipe",
            &x1.to_string(),
            &y1.to_string(),
            &x2.to_string(),
            &y2.to_string(),
            &duration.to_string(),
        ],
        Some(&device_serial),
        UI_AUTOMATION_TIMEOUT,
    )?;
    adb::ensure_success(&output, "swipe UI")?;
    Ok(ui_action_response(
        "swipe",
        device_serial,
        width,
        height,
        output,
    ))
}

#[tauri::command(async)]
pub fn adb_ui_press_back(
    app: AppHandle,
    device_serial: String,
) -> Result<UiActionResponse, AdbError> {
    let (width, height) = device_size(&app, &device_serial)?;
    if let Some(value) = agent::agent_ui_request(&device_serial, "/ui/back", Some("{}"))
        .map_err(AdbError::CommandFailed)?
    {
        return Ok(agent_action_response(
            "back",
            device_serial,
            width,
            height,
            value,
        ));
    }
    let output = adb::run_adb_with_timeout(
        &app,
        &["shell", "input", "keyevent", "KEYCODE_BACK"],
        Some(&device_serial),
        UI_AUTOMATION_TIMEOUT,
    )?;
    adb::ensure_success(&output, "press UI back")?;
    Ok(ui_action_response(
        "back",
        device_serial,
        width,
        height,
        output,
    ))
}

fn ui_action_response(
    action: &str,
    device_serial: String,
    width: i32,
    height: i32,
    output: std::process::Output,
) -> UiActionResponse {
    UiActionResponse {
        action: action.to_string(),
        device_serial,
        width,
        height,
        output: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        source: "adb_input".to_string(),
    }
}

fn agent_action_response(
    action: &str,
    device_serial: String,
    width: i32,
    height: i32,
    value: serde_json::Value,
) -> UiActionResponse {
    UiActionResponse {
        action: value
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or(action)
            .to_string(),
        device_serial,
        width,
        height,
        output: value
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        source: "accessibility".to_string(),
    }
}

fn device_size(app: &AppHandle, device_serial: &str) -> Result<(i32, i32), AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &["shell", "wm", "size"],
        Some(device_serial),
        UI_AUTOMATION_TIMEOUT,
    )?;
    adb::ensure_success(&output, "read device display size")?;
    parse_device_size(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        AdbError::CommandFailed("Could not determine the current device display size".to_string())
    })
}

fn parse_device_size(value: &str) -> Option<(i32, i32)> {
    value.lines().find_map(|line| {
        let candidate = line.split(':').next_back()?.trim();
        let (width, height) = candidate.split_once('x')?;
        let width = width.trim().parse::<i32>().ok()?;
        let height = height.trim().parse::<i32>().ok()?;
        (width > 0 && height > 0 && width <= MAX_UI_DIMENSION && height <= MAX_UI_DIMENSION)
            .then_some((width, height))
    })
}

fn validate_point(x: i32, y: i32, width: i32, height: i32) -> Result<(), AdbError> {
    if x < 0 || y < 0 || x >= width || y >= height {
        return Err(AdbError::CommandFailed(format!(
            "UI coordinate ({x}, {y}) is outside the {width}x{height} display"
        )));
    }
    Ok(())
}

fn normalize_ui_xml(value: &str) -> String {
    let trimmed = value.trim();
    let start = trimmed
        .find("<?xml")
        .or_else(|| trimmed.find("<hierarchy"))
        .unwrap_or(0);
    let end = trimmed
        .rfind("</hierarchy>")
        .map(|index| index + "</hierarchy>".len());
    end.map(|index| trimmed[start..index].trim().to_string())
        .unwrap_or_else(|| trimmed[start..].trim().to_string())
}

fn parse_ui_nodes(xml: &str) -> Vec<UiNode> {
    xml.split("<node ")
        .skip(1)
        .filter_map(|node| {
            let end = node.find('>')?;
            let attributes = &node[..end];
            let text = xml_attribute(attributes, "text");
            let content_desc = xml_attribute(attributes, "content-desc");
            let resource_id = xml_attribute(attributes, "resource-id");
            let clickable = xml_attribute(attributes, "clickable") == "true";
            if !clickable && text.is_empty() && content_desc.is_empty() {
                return None;
            }
            Some(UiNode {
                text,
                content_desc,
                resource_id,
                class_name: xml_attribute(attributes, "class"),
                bounds: xml_attribute(attributes, "bounds"),
                clickable,
                enabled: xml_attribute(attributes, "enabled") != "false",
            })
        })
        .take(UI_NODE_LIMIT)
        .collect()
}

fn xml_attribute(value: &str, name: &str) -> String {
    let prefix = format!("{name}=\"");
    let Some(start) = value.find(&prefix).map(|index| index + prefix.len()) else {
        return String::new();
    };
    let Some(end) = value[start..].find('"').map(|index| start + index) else {
        return String::new();
    };
    value[start..end]
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn truncate_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n...[truncated]", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::{
        parse_device_size, parse_ui_nodes, should_fallback_to_uiautomator, validate_point, UiNode,
        UiSnapshotResponse,
    };

    #[test]
    fn parses_physical_or_override_device_size() {
        assert_eq!(
            parse_device_size("Physical size: 1920x1080"),
            Some((1920, 1080))
        );
        assert_eq!(
            parse_device_size("Physical size: 1920x1080\nOverride size: 1280x720"),
            Some((1920, 1080))
        );
    }

    #[test]
    fn rejects_out_of_bounds_ui_coordinates() {
        assert!(validate_point(1279, 719, 1280, 720).is_ok());
        assert!(validate_point(1280, 719, 1280, 720).is_err());
        assert!(validate_point(-1, 20, 1280, 720).is_err());
    }

    #[test]
    fn keeps_actionable_or_labeled_ui_nodes() {
        let nodes = parse_ui_nodes(
            r#"<hierarchy><node text="" content-desc="Create" resource-id="create" class="Button" clickable="true" enabled="true" bounds="[0,0][20,20]"/><node text="Title" content-desc="" resource-id="" class="TextView" clickable="false" enabled="true" bounds="[0,20][40,40]"/></hierarchy>"#,
        );
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].content_desc, "Create");
        assert_eq!(nodes[1].text, "Title");
    }

    #[test]
    fn falls_back_when_accessibility_snapshot_is_empty() {
        let empty = UiSnapshotResponse {
            device_serial: "serial".to_string(),
            width: 1080,
            height: 1920,
            nodes: Vec::new(),
            xml: String::new(),
            source: "accessibility".to_string(),
            fallback_attempted: false,
            fallback_error: None,
        };
        assert!(should_fallback_to_uiautomator(&empty));

        let populated = UiSnapshotResponse {
            nodes: vec![UiNode {
                text: "Calendar".to_string(),
                content_desc: String::new(),
                resource_id: String::new(),
                class_name: "android.widget.TextView".to_string(),
                bounds: "[0,0][100,100]".to_string(),
                clickable: false,
                enabled: true,
            }],
            ..empty.clone()
        };
        assert!(!should_fallback_to_uiautomator(&populated));
        assert!(!should_fallback_to_uiautomator(&UiSnapshotResponse {
            source: "adb_uiautomator".to_string(),
            ..empty
        }));
    }

    #[test]
    fn falls_back_when_accessibility_tree_has_unlabeled_repeated_clickable_rows() {
        let snapshot = UiSnapshotResponse {
            device_serial: "serial".to_string(),
            width: 1080,
            height: 1920,
            nodes: vec![
                UiNode {
                    text: String::new(),
                    content_desc: String::new(),
                    resource_id: "com.example:id/linear_bg".to_string(),
                    class_name: "android.widget.LinearLayout".to_string(),
                    bounds: "[0,0][100,60]".to_string(),
                    clickable: true,
                    enabled: true,
                },
                UiNode {
                    text: String::new(),
                    content_desc: String::new(),
                    resource_id: "com.example:id/linear_bg".to_string(),
                    class_name: "android.widget.LinearLayout".to_string(),
                    bounds: "[0,60][100,120]".to_string(),
                    clickable: true,
                    enabled: true,
                },
            ],
            xml: String::new(),
            source: "accessibility".to_string(),
            fallback_attempted: false,
            fallback_error: None,
        };
        assert!(should_fallback_to_uiautomator(&snapshot));
    }

    #[test]
    fn keeps_labeled_or_uniquely_identified_accessibility_controls() {
        let labeled = UiSnapshotResponse {
            nodes: vec![UiNode {
                text: "Day".to_string(),
                content_desc: String::new(),
                resource_id: "com.example:id/tv_name".to_string(),
                class_name: "android.widget.TextView".to_string(),
                bounds: "[0,0][100,60]".to_string(),
                clickable: true,
                enabled: true,
            }],
            ..UiSnapshotResponse {
                device_serial: "serial".to_string(),
                width: 1080,
                height: 1920,
                nodes: Vec::new(),
                xml: String::new(),
                source: "accessibility".to_string(),
                fallback_attempted: false,
                fallback_error: None,
            }
        };
        assert!(!should_fallback_to_uiautomator(&labeled));

        let unique = UiSnapshotResponse {
            nodes: vec![
                UiNode {
                    text: String::new(),
                    content_desc: String::new(),
                    resource_id: "com.example:id/close".to_string(),
                    class_name: "android.widget.ImageButton".to_string(),
                    bounds: "[0,0][60,60]".to_string(),
                    clickable: true,
                    enabled: true,
                },
                UiNode {
                    text: String::new(),
                    content_desc: String::new(),
                    resource_id: "com.example:id/settings".to_string(),
                    class_name: "android.widget.ImageButton".to_string(),
                    bounds: "[60,0][120,60]".to_string(),
                    clickable: true,
                    enabled: true,
                },
            ],
            ..labeled
        };
        assert!(!should_fallback_to_uiautomator(&unique));
    }
}
