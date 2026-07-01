use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::adb::AdbError;
use crate::process;

const AGENT_CLI_TIMEOUT: Duration = Duration::from_secs(120);
const AGENT_CLI_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliAnalysisRequest {
    pub kind: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliAnalysisResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliProbeRequest {
    pub command: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliProbeResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptMode {
    Stdin,
    Argument,
}

struct AgentCliInvocation {
    program: String,
    args: Vec<String>,
    prompt_mode: PromptMode,
    output_file: Option<PathBuf>,
}

#[tauri::command(async)]
pub async fn agent_cli_analyze(
    request: AgentCliAnalysisRequest,
) -> Result<AgentCliAnalysisResult, AdbError> {
    tauri::async_runtime::spawn_blocking(move || run_agent_cli_analysis(request))
        .await
        .map_err(|error| AdbError::CommandFailed(format!("Agent CLI task failed: {error}")))?
}

#[tauri::command(async)]
pub async fn agent_cli_probe(
    request: AgentCliProbeRequest,
) -> Result<AgentCliProbeResult, AdbError> {
    tauri::async_runtime::spawn_blocking(move || run_agent_cli_probe(request))
        .await
        .map_err(|error| AdbError::CommandFailed(format!("Agent CLI probe task failed: {error}")))?
}

fn run_agent_cli_probe(request: AgentCliProbeRequest) -> Result<AgentCliProbeResult, AdbError> {
    let program = request.command.trim();
    if program.is_empty() {
        return Err(AdbError::CommandFailed(
            "Agent CLI command is empty".to_string(),
        ));
    }
    let args = vec!["--version".to_string()];
    let mut command = process::hidden_command(program);
    command.args(&args);
    if let Some(cwd) = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
    {
        command.current_dir(cwd);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AdbError::CommandFailed(format!("Failed to start Agent CLI probe: {error}"))
    })?;
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| AdbError::CommandFailed(format!("Agent CLI probe failed: {error}")))?
            .is_some()
        {
            let output = child.wait_with_output().map_err(|error| {
                AdbError::CommandFailed(format!("Failed to read Agent CLI probe output: {error}"))
            })?;
            return Ok(AgentCliProbeResult {
                command: command_preview(program, &args),
                exit_code: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                ok: output.status.success(),
            });
        }
        if started.elapsed() >= AGENT_CLI_PROBE_TIMEOUT {
            let _ = child.kill();
            return Err(AdbError::CommandFailed(
                "Agent CLI probe timed out".to_string(),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn run_agent_cli_analysis(
    request: AgentCliAnalysisRequest,
) -> Result<AgentCliAnalysisResult, AdbError> {
    if request.prompt.trim().is_empty() {
        return Err(AdbError::CommandFailed(
            "Agent analysis prompt is empty".to_string(),
        ));
    }
    let invocation = build_agent_cli_invocation(&request)?;
    let mut command = process::hidden_command(&invocation.program);
    command.args(&invocation.args);
    if let Some(cwd) = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
    {
        command.current_dir(cwd);
    }
    if invocation.prompt_mode == PromptMode::Stdin {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| AdbError::CommandFailed(format!("Failed to start Agent CLI: {error}")))?;
    if invocation.prompt_mode == PromptMode::Stdin {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(request.prompt.as_bytes())
                .map_err(|error| {
                    AdbError::CommandFailed(format!("Failed to send prompt to Agent CLI: {error}"))
                })?;
        }
    }

    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| AdbError::CommandFailed(format!("Agent CLI failed: {error}")))?
            .is_some()
        {
            let output = child.wait_with_output().map_err(|error| {
                AdbError::CommandFailed(format!("Failed to read Agent CLI output: {error}"))
            })?;
            let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
            if let Some(output_file) = invocation.output_file.as_ref() {
                if let Ok(last_message) = fs::read_to_string(output_file) {
                    if !last_message.trim().is_empty() {
                        stdout = last_message;
                    }
                }
                let _ = fs::remove_file(output_file);
            }
            return Ok(AgentCliAnalysisResult {
                command: command_preview(&invocation.program, &invocation.args),
                exit_code: output.status.code(),
                stdout,
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            });
        }
        if started.elapsed() >= AGENT_CLI_TIMEOUT {
            let _ = child.kill();
            return Err(AdbError::CommandFailed(
                "Agent CLI analysis timed out".to_string(),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn build_agent_cli_invocation(
    request: &AgentCliAnalysisRequest,
) -> Result<AgentCliInvocation, AdbError> {
    let program = request.command.trim();
    if program.is_empty() {
        return Err(AdbError::CommandFailed(
            "Agent CLI command is empty".to_string(),
        ));
    }
    let mut args = request.args.clone();
    match request.kind.as_str() {
        "codex_cli" => {
            let output_file = temp_output_file("codex-agent-analysis");
            let has_sandbox_override = codex_args_include_sandbox_override(&args);
            args.push("exec".to_string());
            if !has_sandbox_override {
                args.extend(["--sandbox".to_string(), "read-only".to_string()]);
            }
            args.extend([
                "--skip-git-repo-check".to_string(),
                "--ephemeral".to_string(),
                "--color".to_string(),
                "never".to_string(),
                "--output-last-message".to_string(),
                output_file.to_string_lossy().to_string(),
                "-".to_string(),
            ]);
            Ok(AgentCliInvocation {
                program: program.to_string(),
                args,
                prompt_mode: PromptMode::Stdin,
                output_file: Some(output_file),
            })
        }
        "claude_code" => {
            args.extend([
                "--print".to_string(),
                "--permission-mode".to_string(),
                "dontAsk".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                request.prompt.clone(),
            ]);
            Ok(AgentCliInvocation {
                program: program.to_string(),
                args,
                prompt_mode: PromptMode::Argument,
                output_file: None,
            })
        }
        _ => Ok(AgentCliInvocation {
            program: program.to_string(),
            args,
            prompt_mode: PromptMode::Stdin,
            output_file: None,
        }),
    }
}

fn codex_args_include_sandbox_override(args: &[String]) -> bool {
    args.iter().any(|arg| {
        matches!(
            arg.as_str(),
            "--yolo" | "--dangerously-bypass-approvals-and-sandbox" | "--sandbox" | "-s"
        ) || arg.starts_with("--sandbox=")
    })
}

fn temp_output_file(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("{prefix}-{timestamp}.txt"))
}

fn command_preview(program: &str, args: &[String]) -> String {
    let mut preview = vec![program.to_string()];
    preview.extend(args.iter().map(|arg| {
        if arg.len() > 160 {
            "<prompt>".to_string()
        } else {
            arg.clone()
        }
    }));
    preview.join(" ")
}

#[cfg(test)]
mod tests {
    use super::{build_agent_cli_invocation, AgentCliAnalysisRequest, PromptMode};

    fn request(kind: &str) -> AgentCliAnalysisRequest {
        AgentCliAnalysisRequest {
            kind: kind.to_string(),
            command: if kind == "claude_code" {
                "claude".to_string()
            } else {
                "codex".to_string()
            },
            args: vec!["--profile".to_string(), "android".to_string()],
            cwd: None,
            prompt: "Analyze this evidence".to_string(),
        }
    }

    #[test]
    fn codex_cli_uses_non_interactive_read_only_exec_with_stdin() {
        let invocation = build_agent_cli_invocation(&request("codex_cli")).unwrap();

        assert_eq!(invocation.prompt_mode, PromptMode::Stdin);
        assert!(invocation.args.contains(&"exec".to_string()));
        assert!(invocation.args.contains(&"read-only".to_string()));
        assert!(!invocation.args.contains(&"--ask-for-approval".to_string()));
        assert!(invocation.args.contains(&"-".to_string()));
        assert!(invocation.output_file.is_some());
    }

    #[test]
    fn codex_cli_respects_user_sandbox_or_yolo_args() {
        let mut yolo = request("codex_cli");
        yolo.args = vec!["--yolo".to_string()];
        let invocation = build_agent_cli_invocation(&yolo).unwrap();

        assert_eq!(invocation.args[0], "--yolo");
        assert!(invocation.args.contains(&"exec".to_string()));
        assert!(!invocation.args.contains(&"--sandbox".to_string()));
        assert!(!invocation.args.contains(&"read-only".to_string()));

        let mut danger = request("codex_cli");
        danger.args = vec!["--sandbox".to_string(), "danger-full-access".to_string()];
        let invocation = build_agent_cli_invocation(&danger).unwrap();
        assert_eq!(
            invocation
                .args
                .iter()
                .filter(|arg| arg.as_str() == "--sandbox")
                .count(),
            1
        );
        assert!(!invocation.args.contains(&"read-only".to_string()));
    }

    #[test]
    fn claude_cli_uses_print_mode_with_prompt_argument() {
        let invocation = build_agent_cli_invocation(&request("claude_code")).unwrap();

        assert_eq!(invocation.prompt_mode, PromptMode::Argument);
        assert!(invocation.args.contains(&"--print".to_string()));
        assert!(invocation.args.contains(&"--output-format".to_string()));
        assert!(invocation
            .args
            .contains(&"Analyze this evidence".to_string()));
    }

    #[test]
    fn custom_cli_preserves_user_args_and_receives_prompt_on_stdin() {
        let mut custom = request("custom_cli");
        custom.command = "my-agent".to_string();
        custom.args = vec!["analyze".to_string(), "--json".to_string()];
        let invocation = build_agent_cli_invocation(&custom).unwrap();

        assert_eq!(invocation.program, "my-agent");
        assert_eq!(invocation.args, vec!["analyze", "--json"]);
        assert_eq!(invocation.prompt_mode, PromptMode::Stdin);
    }
}
