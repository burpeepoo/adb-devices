use serde::Serialize;
use serde_json::Value;
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::adb::AdbError;
use crate::process;

const REFERENCE_FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const REFERENCE_CONTENT_LIMIT: usize = 24_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFeishuReference {
    pub url: String,
    pub content: String,
    pub revision_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFigmaMcpStatus {
    pub configured: bool,
    pub authenticated: bool,
    pub message: String,
    pub login_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFigmaLoginLaunch {
    pub command: String,
    pub login_url: String,
}

#[tauri::command(async)]
pub async fn agent_fetch_feishu_reference(url: String) -> Result<AgentFeishuReference, AdbError> {
    tauri::async_runtime::spawn_blocking(move || fetch_feishu_reference(&url))
        .await
        .map_err(|error| {
            AdbError::CommandFailed(format!("Feishu reference task failed: {error}"))
        })?
}

#[tauri::command(async)]
pub async fn agent_get_figma_mcp_status() -> Result<AgentFigmaMcpStatus, AdbError> {
    tauri::async_runtime::spawn_blocking(read_figma_mcp_status)
        .await
        .map_err(|error| {
            AdbError::CommandFailed(format!("Figma MCP status task failed: {error}"))
        })?
}

#[tauri::command]
pub fn agent_start_figma_mcp_login() -> Result<AgentFigmaLoginLaunch, AdbError> {
    process::hidden_command("codex")
        .args(["mcp", "login", "figma"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            AdbError::CommandFailed(format!("Failed to launch Figma MCP login: {error}"))
        })?;
    Ok(AgentFigmaLoginLaunch {
        command: "codex mcp login figma".to_string(),
        login_url: "https://www.figma.com/login".to_string(),
    })
}

fn fetch_feishu_reference(url: &str) -> Result<AgentFeishuReference, AdbError> {
    let url = url.trim();
    if !is_allowed_feishu_url(url) {
        return Err(AdbError::CommandFailed(
            "Feishu reference must be a feishu.cn, larksuite.com, or larkoffice.com document URL"
                .to_string(),
        ));
    }
    let output = run_with_timeout(
        "lark-cli",
        [
            "docs",
            "+fetch",
            "--as",
            "user",
            "--doc",
            url,
            "--doc-format",
            "markdown",
            "--detail",
            "simple",
            "--format",
            "json",
        ],
    )?;
    if !output.status.success() {
        return Err(AdbError::CommandFailed(trimmed_output(&output.stderr)));
    }
    let response: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        AdbError::CommandFailed(format!("Could not parse Feishu CLI response: {error}"))
    })?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(AdbError::CommandFailed(trimmed_output(&output.stdout)));
    }
    let document = response.pointer("/data/document").ok_or_else(|| {
        AdbError::CommandFailed("Feishu CLI response did not contain document content".to_string())
    })?;
    let content = document
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if content.is_empty() {
        return Err(AdbError::CommandFailed(
            "Feishu document was empty or unreadable".to_string(),
        ));
    }
    Ok(AgentFeishuReference {
        url: url.to_string(),
        content: truncate(content, REFERENCE_CONTENT_LIMIT),
        revision_id: document.get("revision_id").and_then(Value::as_i64),
    })
}

fn read_figma_mcp_status() -> Result<AgentFigmaMcpStatus, AdbError> {
    let output = run_with_timeout("codex", ["mcp", "list"])?;
    if !output.status.success() {
        return Err(AdbError::CommandFailed(trimmed_output(&output.stderr)));
    }
    let body = String::from_utf8_lossy(&output.stdout);
    let figma_line = body
        .lines()
        .find(|line| line.trim_start().starts_with("figma"));
    let configured = figma_line.is_some();
    let authenticated = figma_line.is_some_and(|line| !line.contains("Not logged in"));
    Ok(AgentFigmaMcpStatus {
        configured,
        authenticated,
        message: figma_line
            .unwrap_or("Figma MCP is not configured in the global Codex profile")
            .trim()
            .to_string(),
        login_url: "https://www.figma.com/login".to_string(),
    })
}

fn run_with_timeout<const N: usize>(
    program: &str,
    args: [&str; N],
) -> Result<std::process::Output, AdbError> {
    let mut command = process::hidden_command(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| AdbError::CommandFailed(format!("Failed to start {program}: {error}")))?;
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| AdbError::CommandFailed(format!("{program} failed: {error}")))?
            .is_some()
        {
            return child.wait_with_output().map_err(|error| {
                AdbError::CommandFailed(format!("Failed to read {program} output: {error}"))
            });
        }
        if started.elapsed() >= REFERENCE_FETCH_TIMEOUT {
            let _ = child.kill();
            return Err(AdbError::CommandFailed(format!(
                "{program} reference request timed out"
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn is_allowed_feishu_url(value: &str) -> bool {
    let Some((_, remainder)) = value.split_once("://") else {
        return false;
    };
    let host = remainder
        .split('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        host.as_str(),
        "feishu.cn" | "larksuite.com" | "larkoffice.com"
    ) || host.ends_with(".feishu.cn")
        || host.ends_with(".larksuite.com")
        || host.ends_with(".larkoffice.com")
}

fn truncate(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        value.to_string()
    } else {
        format!("{}\n...[truncated]", &value[..limit])
    }
}

fn trimmed_output(bytes: &[u8]) -> String {
    let value = String::from_utf8_lossy(bytes).trim().to_string();
    if value.is_empty() {
        "Command returned no diagnostic output".to_string()
    } else {
        truncate(&value, 2_000)
    }
}

#[cfg(test)]
mod tests {
    use super::is_allowed_feishu_url;

    #[test]
    fn allows_only_known_feishu_hosts() {
        assert!(is_allowed_feishu_url("https://example.feishu.cn/wiki/abc"));
        assert!(is_allowed_feishu_url(
            "https://example.larksuite.com/docx/abc"
        ));
        assert!(!is_allowed_feishu_url("https://example.com/wiki/abc"));
        assert!(!is_allowed_feishu_url("file:///tmp/reference"));
    }
}
