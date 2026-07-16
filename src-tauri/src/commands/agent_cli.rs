use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

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
    #[serde(default)]
    pub model_override: Option<String>,
    #[serde(default)]
    pub reasoning_effort_override: Option<String>,
    pub cwd: Option<String>,
    pub prompt: String,
    pub stream_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliAnalysisResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentCliStreamEvent {
    phase: Option<String>,
    text: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeDiscoveryResult {
    pub runtimes: Vec<AgentRuntimeDiscoveryItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeDiscoveryItem {
    pub kind: String,
    pub name: String,
    pub command: String,
    pub available: bool,
    pub version: Option<String>,
    pub configured_model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub model_options: Vec<AgentRuntimeModelOption>,
    pub reasoning_effort_options: Vec<String>,
    pub configuration_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeModelOption {
    pub value: String,
    pub label: String,
    pub default_reasoning_effort: Option<String>,
    pub reasoning_efforts: Vec<String>,
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
    stream_json: bool,
}

#[tauri::command(async)]
pub async fn agent_cli_analyze(
    app: tauri::AppHandle,
    request: AgentCliAnalysisRequest,
) -> Result<AgentCliAnalysisResult, AdbError> {
    tauri::async_runtime::spawn_blocking(move || run_agent_cli_analysis(request, app))
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

#[tauri::command(async)]
pub async fn agent_runtime_discover() -> Result<AgentRuntimeDiscoveryResult, AdbError> {
    tauri::async_runtime::spawn_blocking(discover_agent_runtimes)
        .await
        .map_err(|error| {
            AdbError::CommandFailed(format!("Agent runtime discovery failed: {error}"))
        })?
}

fn discover_agent_runtimes() -> Result<AgentRuntimeDiscoveryResult, AdbError> {
    Ok(AgentRuntimeDiscoveryResult {
        runtimes: vec![discover_codex_runtime(), discover_claude_runtime()],
    })
}

fn discover_codex_runtime() -> AgentRuntimeDiscoveryItem {
    let (available, version) = probe_cli_version("codex");
    let config = codex_config_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|content| parse_codex_runtime_config(&content))
        .unwrap_or_default();
    let mut model_options = capture_cli_output("codex", &["debug", "models"])
        .or_else(|| capture_cli_output("codex", &["debug", "models", "--bundled"]))
        .map(|output| parse_codex_model_catalog(&output))
        .unwrap_or_default();
    if let Some(model) = config.model.as_deref() {
        push_model_option_if_missing(&mut model_options, model);
    }
    let reasoning_effort_options = collect_reasoning_efforts(&model_options);
    let has_configuration = config.model.is_some() || config.reasoning_effort.is_some();
    AgentRuntimeDiscoveryItem {
        kind: "codex_cli".to_string(),
        name: "Codex CLI".to_string(),
        command: "codex".to_string(),
        available,
        version,
        configured_model: config.model,
        reasoning_effort: config.reasoning_effort,
        model_options,
        reasoning_effort_options,
        configuration_source: has_configuration.then_some("user_config".to_string()),
    }
}

fn discover_claude_runtime() -> AgentRuntimeDiscoveryItem {
    let (available, version) = probe_cli_version("claude");
    let config = claude_settings_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|content| parse_claude_runtime_config(&content))
        .unwrap_or_default();
    let help = capture_cli_output("claude", &["--help"])
        .map(|output| parse_claude_help(&output))
        .unwrap_or_else(ClaudeHelpDiscovery::fallback);
    let mut model_options = help
        .model_aliases
        .into_iter()
        .map(|value| AgentRuntimeModelOption {
            label: value.clone(),
            value,
            default_reasoning_effort: None,
            reasoning_efforts: Vec::new(),
        })
        .collect::<Vec<_>>();
    if let Some(model) = config.model.as_deref() {
        push_model_option_if_missing(&mut model_options, model);
    }
    let has_configuration = config.model.is_some() || config.reasoning_effort.is_some();
    AgentRuntimeDiscoveryItem {
        kind: "claude_code".to_string(),
        name: "Claude Code".to_string(),
        command: "claude".to_string(),
        available,
        version,
        configuration_source: has_configuration.then_some("user_config".to_string()),
        configured_model: config.model,
        reasoning_effort: config.reasoning_effort,
        model_options,
        reasoning_effort_options: help.reasoning_efforts,
    }
}

fn capture_cli_output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = process::hidden_command(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    return None;
                }
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return (!stdout.is_empty()).then_some(stdout);
            }
            Ok(None) if started.elapsed() < AGENT_CLI_PROBE_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    }
}

fn probe_cli_version(program: &str) -> (bool, Option<String>) {
    let mut command = process::hidden_command(program);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let Ok(mut child) = command.spawn() else {
        return (false, None);
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let Ok(output) = child.wait_with_output() else {
                    return (false, None);
                };
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return (
                    output.status.success(),
                    (!version.is_empty()).then_some(version),
                );
            }
            Ok(None) if started.elapsed() < AGENT_CLI_PROBE_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return (false, None);
            }
            Err(_) => return (false, None),
        }
    }
}

#[derive(Default)]
struct CodexRuntimeConfig {
    model: Option<String>,
    reasoning_effort: Option<String>,
}

#[derive(Default)]
struct ClaudeRuntimeConfig {
    model: Option<String>,
    reasoning_effort: Option<String>,
}

#[derive(Default)]
struct ClaudeHelpDiscovery {
    model_aliases: Vec<String>,
    reasoning_efforts: Vec<String>,
}

impl ClaudeHelpDiscovery {
    fn fallback() -> Self {
        Self {
            model_aliases: vec!["sonnet".to_string(), "opus".to_string()],
            reasoning_efforts: ["low", "medium", "high", "xhigh", "max"]
                .into_iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

fn parse_codex_runtime_config(content: &str) -> CodexRuntimeConfig {
    CodexRuntimeConfig {
        model: toml_string_assignment(content, "model"),
        reasoning_effort: toml_string_assignment(content, "model_reasoning_effort"),
    }
}

fn parse_claude_runtime_config(content: &str) -> ClaudeRuntimeConfig {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return ClaudeRuntimeConfig::default();
    };
    let env_model = value
        .get("env")
        .and_then(|value| value.as_object())
        .and_then(|env| {
            ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL"]
                .into_iter()
                .find_map(|key| env.get(key).and_then(|value| value.as_str()))
        });
    ClaudeRuntimeConfig {
        model: value
            .get("model")
            .and_then(|value| value.as_str())
            .or(env_model)
            .map(ToString::to_string),
        reasoning_effort: value
            .get("effortLevel")
            .and_then(|value| value.as_str())
            .map(ToString::to_string),
    }
}

fn parse_codex_model_catalog(content: &str) -> Vec<AgentRuntimeModelOption> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return Vec::new();
    };
    value
        .get("models")
        .and_then(|models| models.as_array())
        .into_iter()
        .flatten()
        .filter(|model| model.get("visibility").and_then(|value| value.as_str()) == Some("list"))
        .filter_map(|model| {
            let value = model.get("slug")?.as_str()?.to_string();
            let label = model
                .get("display_name")
                .and_then(|value| value.as_str())
                .unwrap_or(&value)
                .to_string();
            let reasoning_efforts = model
                .get("supported_reasoning_levels")
                .and_then(|levels| levels.as_array())
                .into_iter()
                .flatten()
                .filter_map(|level| level.get("effort").and_then(|value| value.as_str()))
                .map(ToString::to_string)
                .collect();
            Some(AgentRuntimeModelOption {
                value,
                label,
                default_reasoning_effort: model
                    .get("default_reasoning_level")
                    .and_then(|value| value.as_str())
                    .map(ToString::to_string),
                reasoning_efforts,
            })
        })
        .collect()
}

fn parse_claude_help(content: &str) -> ClaudeHelpDiscovery {
    let model_section = help_option_section(content, "--model <model>");
    let mut model_aliases = quoted_values(&model_section)
        .into_iter()
        .filter(|value| {
            !value.starts_with("claude-") && value.chars().all(|ch| ch.is_ascii_alphabetic())
        })
        .collect::<Vec<_>>();
    model_aliases.dedup();

    let effort_section = help_option_section(content, "--effort <level>");
    let reasoning_efforts = effort_section
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .map(|(choices, _)| {
            choices
                .split(',')
                .map(str::trim)
                .filter(|choice| {
                    !choice.is_empty() && choice.chars().all(|ch| ch.is_ascii_alphabetic())
                })
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let fallback = ClaudeHelpDiscovery::fallback();
    ClaudeHelpDiscovery {
        model_aliases: if model_aliases.is_empty() {
            fallback.model_aliases
        } else {
            model_aliases
        },
        reasoning_efforts: if reasoning_efforts.is_empty() {
            fallback.reasoning_efforts
        } else {
            reasoning_efforts
        },
    }
}

fn help_option_section(content: &str, marker: &str) -> String {
    content
        .split_once(marker)
        .map(|(_, rest)| {
            rest.lines()
                .take_while(|line| !line.trim_start().starts_with('-'))
                .take(6)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

fn quoted_values(content: &str) -> Vec<String> {
    content
        .split('\'')
        .enumerate()
        .filter_map(|(index, value)| (index % 2 == 1).then_some(value.trim().to_string()))
        .filter(|value| !value.is_empty())
        .collect()
}

fn push_model_option_if_missing(options: &mut Vec<AgentRuntimeModelOption>, model: &str) {
    if options.iter().any(|option| option.value == model) {
        return;
    }
    options.insert(
        0,
        AgentRuntimeModelOption {
            value: model.to_string(),
            label: model.to_string(),
            default_reasoning_effort: None,
            reasoning_efforts: Vec::new(),
        },
    );
}

fn collect_reasoning_efforts(options: &[AgentRuntimeModelOption]) -> Vec<String> {
    let mut efforts = Vec::new();
    for effort in options
        .iter()
        .flat_map(|option| option.reasoning_efforts.iter())
    {
        if !efforts.contains(effort) {
            efforts.push(effort.clone());
        }
    }
    efforts
}

fn toml_string_assignment(content: &str, key: &str) -> Option<String> {
    let mut in_root_table = true;
    content.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            in_root_table = false;
            return None;
        }
        if !in_root_table {
            return None;
        }
        let (candidate, value) = line.split_once('=')?;
        if candidate.trim() != key {
            return None;
        }
        let value = value.trim().split('#').next()?.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            })?;
        (!value.trim().is_empty()).then(|| value.trim().to_string())
    })
}

fn codex_config_path() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("config.toml"))
}

fn claude_settings_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".claude").join("settings.json"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
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
    app: tauri::AppHandle,
) -> Result<AgentCliAnalysisResult, AdbError> {
    if request.prompt.trim().is_empty() {
        return Err(AdbError::CommandFailed(
            "Agent analysis prompt is empty".to_string(),
        ));
    }
    let invocation = build_agent_cli_invocation(&request)?;
    if invocation.stream_json {
        return run_streaming_agent_cli_analysis(request, invocation, app);
    }
    // Keep the non-streaming path from deadlocking on a full stdout/stderr
    // pipe. Codex emits JSON lifecycle events even when the final answer is
    // written to --output-last-message; desktop callers must drain those
    // streams while the child is running, or redirect them to files.
    let stdout_path = temp_output_file("agent-cli-stdout");
    let stderr_path = temp_output_file("agent-cli-stderr");
    let stdout_file = fs::File::create(&stdout_path).map_err(|error| {
        AdbError::CommandFailed(format!("Failed to create Agent CLI stdout file: {error}"))
    })?;
    let stderr_file = fs::File::create(&stderr_path).map_err(|error| {
        let _ = fs::remove_file(&stdout_path);
        AdbError::CommandFailed(format!("Failed to create Agent CLI stderr file: {error}"))
    })?;
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
    command
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    let mut child = command.spawn().map_err(|error| {
        let _ = fs::remove_file(&stdout_path);
        let _ = fs::remove_file(&stderr_path);
        AdbError::CommandFailed(format!(
            "Failed to start Agent CLI ({}): {error}",
            command_preview(&invocation.program, &invocation.args)
        ))
    })?;
    if invocation.prompt_mode == PromptMode::Stdin {
        if let Some(mut stdin) = child.stdin.take() {
            if let Err(error) = stdin.write_all(request.prompt.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&stdout_path);
                let _ = fs::remove_file(&stderr_path);
                if let Some(output_file) = invocation.output_file.as_ref() {
                    let _ = fs::remove_file(output_file);
                }
                return Err(AdbError::CommandFailed(format!(
                    "Failed to send prompt to Agent CLI: {error}"
                )));
            }
        }
    }

    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| AdbError::CommandFailed(format!("Agent CLI failed: {error}")))?
            .is_some()
        {
            let status = child.wait().map_err(|error| {
                AdbError::CommandFailed(format!("Failed to wait for Agent CLI output: {error}"))
            })?;
            let mut stdout = fs::read_to_string(&stdout_path).unwrap_or_default();
            if let Some(output_file) = invocation.output_file.as_ref() {
                if let Ok(last_message) = fs::read_to_string(output_file) {
                    if !last_message.trim().is_empty() {
                        stdout = last_message;
                    }
                }
                let _ = fs::remove_file(output_file);
            }
            let stderr = fs::read_to_string(&stderr_path).unwrap_or_default();
            let _ = fs::remove_file(&stdout_path);
            let _ = fs::remove_file(&stderr_path);
            return Ok(AgentCliAnalysisResult {
                command: command_preview(&invocation.program, &invocation.args),
                exit_code: status.code(),
                stdout,
                stderr,
            });
        }
        if started.elapsed() >= AGENT_CLI_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&stdout_path);
            let _ = fs::remove_file(&stderr_path);
            if let Some(output_file) = invocation.output_file.as_ref() {
                let _ = fs::remove_file(output_file);
            }
            return Err(AdbError::CommandFailed(format!(
                "Agent CLI analysis timed out after {}s ({})",
                AGENT_CLI_TIMEOUT.as_secs(),
                command_preview(&invocation.program, &invocation.args)
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn run_streaming_agent_cli_analysis(
    request: AgentCliAnalysisRequest,
    invocation: AgentCliInvocation,
    app: tauri::AppHandle,
) -> Result<AgentCliAnalysisResult, AdbError> {
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
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AdbError::CommandFailed(format!(
            "Failed to start Agent CLI ({}): {error}",
            command_preview(&invocation.program, &invocation.args)
        ))
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.prompt.as_bytes())
            .map_err(|error| {
                AdbError::CommandFailed(format!("Failed to send prompt to Agent CLI: {error}"))
            })?;
    }

    let stdout = child.stdout.take().ok_or_else(|| {
        AdbError::CommandFailed("Failed to capture Agent CLI stream output".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        AdbError::CommandFailed("Failed to capture Agent CLI error output".to_string())
    })?;
    let event_name = request
        .stream_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|stream_id| format!("agent-cli-stream-{stream_id}"));
    let stream_app = app.clone();
    let stdout_reader = std::thread::spawn(move || {
        let mut raw = String::new();
        let mut last_message = String::new();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            raw.push_str(&line);
            raw.push('\n');
            let (phase, text) = parse_codex_stream_event(&line);
            if let Some(text) = text.as_deref().filter(|value| *value != last_message) {
                last_message = text.to_string();
                if let Some(event_name) = event_name.as_deref() {
                    let _ = stream_app.emit(
                        event_name,
                        AgentCliStreamEvent {
                            phase,
                            text: Some(last_message.clone()),
                        },
                    );
                }
            } else if let (Some(event_name), Some(phase)) = (event_name.as_deref(), phase) {
                let _ = stream_app.emit(
                    event_name,
                    AgentCliStreamEvent {
                        phase: Some(phase),
                        text: None,
                    },
                );
            }
        }
        raw
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut output = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut output);
        output
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AdbError::CommandFailed(format!("Agent CLI failed: {error}")))?
        {
            break status;
        }
        if started.elapsed() >= AGENT_CLI_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(AdbError::CommandFailed(format!(
                "Agent CLI analysis timed out after {}s ({})",
                AGENT_CLI_TIMEOUT.as_secs(),
                command_preview(&invocation.program, &invocation.args)
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    let raw_stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let mut stdout = latest_codex_agent_message(&raw_stdout).unwrap_or(raw_stdout);
    if let Some(output_file) = invocation.output_file.as_ref() {
        if let Ok(last_message) = fs::read_to_string(output_file) {
            if !last_message.trim().is_empty() {
                stdout = last_message;
            }
        }
        let _ = fs::remove_file(output_file);
    }
    Ok(AgentCliAnalysisResult {
        command: command_preview(&invocation.program, &invocation.args),
        exit_code: status.code(),
        stdout,
        stderr,
    })
}

fn parse_codex_stream_event(line: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (None, None);
    };
    let event_type = value
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let phase = match event_type {
        "turn.started" => Some("starting".to_string()),
        "item.started" => Some("working".to_string()),
        "turn.completed" => Some("completed".to_string()),
        _ => None,
    };
    let item = value.get("item");
    let is_agent_message = item
        .and_then(|item| item.get("type"))
        .and_then(|value| value.as_str())
        == Some("agent_message");
    let text = if is_agent_message {
        item.and_then(|item| item.get("text"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
    } else {
        None
    };
    (phase, text)
}

fn latest_codex_agent_message(raw_stdout: &str) -> Option<String> {
    raw_stdout
        .lines()
        .filter_map(|line| parse_codex_stream_event(line).1)
        .last()
        .filter(|message| !message.trim().is_empty())
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
            append_model_override(&mut args, request.model_override.as_deref());
            append_codex_reasoning_effort_override(
                &mut args,
                request.reasoning_effort_override.as_deref(),
            );
            let output_file = temp_output_file("codex-agent-analysis");
            let has_sandbox_override = codex_args_include_sandbox_override(&args);
            args.push("exec".to_string());
            append_codex_isolation_args(&mut args);
            if !has_sandbox_override {
                args.extend(["--sandbox".to_string(), "read-only".to_string()]);
            }
            args.extend([
                "--skip-git-repo-check".to_string(),
                "--ephemeral".to_string(),
                "--color".to_string(),
                "never".to_string(),
                "--json".to_string(),
                "--output-last-message".to_string(),
                output_file.to_string_lossy().to_string(),
                "-".to_string(),
            ]);
            Ok(AgentCliInvocation {
                program: program.to_string(),
                args,
                prompt_mode: PromptMode::Stdin,
                output_file: Some(output_file),
                // The JSON stream is useful for a terminal, but desktop task
                // lifecycle correctness is more important here. Codex may
                // leave a descendant holding stdout open after the turn has
                // completed, which can strand the reader thread in the
                // streaming path. The output-last-message file still gives
                // the UI the final answer without that shutdown race.
                stream_json: false,
            })
        }
        "claude_code" => {
            append_model_override(&mut args, request.model_override.as_deref());
            append_claude_reasoning_effort_override(
                &mut args,
                request.reasoning_effort_override.as_deref(),
            );
            append_claude_isolation_args(&mut args);
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
                stream_json: false,
            })
        }
        _ => Ok(AgentCliInvocation {
            program: program.to_string(),
            args,
            prompt_mode: PromptMode::Stdin,
            output_file: None,
            stream_json: false,
        }),
    }
}

fn append_model_override(args: &mut Vec<String>, override_value: Option<&str>) {
    let Some(model) = override_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if args
        .iter()
        .any(|arg| arg == "--model" || arg == "-m" || arg.starts_with("--model="))
    {
        return;
    }
    args.extend(["--model".to_string(), model.to_string()]);
}

fn append_codex_reasoning_effort_override(args: &mut Vec<String>, override_value: Option<&str>) {
    let Some(effort) = override_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if args
        .iter()
        .any(|arg| arg.contains("model_reasoning_effort"))
    {
        return;
    }
    args.extend([
        "-c".to_string(),
        format!("model_reasoning_effort={effort:?}"),
    ]);
}

fn append_codex_isolation_args(args: &mut Vec<String>) {
    if !args.iter().any(|arg| arg == "--ignore-user-config") {
        args.push("--ignore-user-config".to_string());
    }
    if !args.iter().any(|arg| arg == "--ignore-rules") {
        args.push("--ignore-rules".to_string());
    }
    for feature in ["shell_tool", "apps", "browser_use", "computer_use"] {
        args.extend(["--disable".to_string(), feature.to_string()]);
    }
}

fn append_claude_reasoning_effort_override(args: &mut Vec<String>, override_value: Option<&str>) {
    let Some(effort) = override_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if args
        .iter()
        .any(|arg| arg == "--effort" || arg.starts_with("--effort="))
    {
        return;
    }
    args.extend(["--effort".to_string(), effort.to_string()]);
}

fn append_claude_isolation_args(args: &mut Vec<String>) {
    for flag in [
        "--safe-mode",
        "--disable-slash-commands",
        "--no-session-persistence",
    ] {
        if !args.iter().any(|arg| arg == flag) {
            args.push(flag.to_string());
        }
    }
    if !args.iter().any(|arg| arg == "--tools") {
        args.extend(["--tools".to_string(), "".to_string()]);
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
    use super::{
        build_agent_cli_invocation, latest_codex_agent_message, parse_claude_help,
        parse_claude_runtime_config, parse_codex_model_catalog, parse_codex_runtime_config,
        parse_codex_stream_event, AgentCliAnalysisRequest, PromptMode,
    };

    fn request(kind: &str) -> AgentCliAnalysisRequest {
        AgentCliAnalysisRequest {
            kind: kind.to_string(),
            command: if kind == "claude_code" {
                "claude".to_string()
            } else {
                "codex".to_string()
            },
            args: vec!["--profile".to_string(), "android".to_string()],
            model_override: None,
            reasoning_effort_override: None,
            cwd: None,
            prompt: "Analyze this evidence".to_string(),
            stream_id: None,
        }
    }

    #[test]
    fn codex_cli_uses_bounded_non_stream_exec_with_stdin() {
        let invocation = build_agent_cli_invocation(&request("codex_cli")).unwrap();

        assert_eq!(invocation.prompt_mode, PromptMode::Stdin);
        assert!(invocation.args.contains(&"exec".to_string()));
        assert!(invocation.args.contains(&"read-only".to_string()));
        assert!(!invocation.args.contains(&"--ask-for-approval".to_string()));
        assert!(invocation.args.contains(&"-".to_string()));
        assert!(invocation.output_file.is_some());
        assert!(invocation.args.contains(&"--json".to_string()));
        assert!(!invocation.stream_json);
        assert!(invocation
            .args
            .contains(&"--ignore-user-config".to_string()));
        assert!(invocation.args.contains(&"--ignore-rules".to_string()));
        let exec_index = invocation
            .args
            .iter()
            .position(|arg| arg == "exec")
            .unwrap();
        assert!(invocation
            .args
            .iter()
            .position(|arg| arg == "--ignore-user-config")
            .is_some_and(|index| index > exec_index));
        for feature in ["shell_tool", "apps", "browser_use", "computer_use"] {
            assert!(invocation.args.contains(&feature.to_string()));
        }
    }

    #[test]
    fn codex_cli_adds_explicit_scout_model_and_effort_overrides() {
        let mut codex = request("codex_cli");
        codex.model_override = Some("gpt-5.6-terra".to_string());
        codex.reasoning_effort_override = Some("high".to_string());

        let invocation = build_agent_cli_invocation(&codex).unwrap();

        assert!(invocation
            .args
            .windows(2)
            .any(|pair| pair == ["--model", "gpt-5.6-terra"]));
        assert!(invocation
            .args
            .windows(2)
            .any(|pair| pair == ["-c", "model_reasoning_effort=\"high\""]));
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
        assert!(invocation.args.contains(&"--safe-mode".to_string()));
        assert!(invocation
            .args
            .contains(&"--disable-slash-commands".to_string()));
        assert!(invocation
            .args
            .contains(&"--no-session-persistence".to_string()));
        assert!(invocation
            .args
            .windows(2)
            .any(|pair| pair == ["--tools", ""]));
        assert!(invocation.args.contains(&"--print".to_string()));
        assert!(invocation.args.contains(&"--output-format".to_string()));
        assert!(invocation
            .args
            .contains(&"Analyze this evidence".to_string()));
    }

    #[test]
    fn claude_cli_adds_explicit_scout_model_and_effort_overrides() {
        let mut claude = request("claude_code");
        claude.model_override = Some("sonnet".to_string());
        claude.reasoning_effort_override = Some("xhigh".to_string());

        let invocation = build_agent_cli_invocation(&claude).unwrap();

        assert!(invocation
            .args
            .windows(2)
            .any(|pair| pair == ["--model", "sonnet"]));
        assert!(invocation
            .args
            .windows(2)
            .any(|pair| pair == ["--effort", "xhigh"]));
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

    #[test]
    fn codex_json_stream_uses_only_agent_message_snapshots() {
        let message = r#"{"type":"item.updated","item":{"type":"agent_message","text":"Checking the reference…"}}"#;
        let tool =
            r#"{"type":"item.updated","item":{"type":"command_execution","text":"adb shell"}}"#;
        let (_, streamed) = parse_codex_stream_event(message);
        assert_eq!(streamed.as_deref(), Some("Checking the reference…"));
        assert_eq!(parse_codex_stream_event(tool).1, None);

        let raw = format!("{message}\n{tool}\n");
        assert_eq!(
            latest_codex_agent_message(&raw).as_deref(),
            Some("Checking the reference…")
        );
    }

    #[test]
    fn runtime_config_parsers_only_extract_supported_fields() {
        let codex = parse_codex_runtime_config(
            "model = \"gpt-5.6-terra\"\nmodel_reasoning_effort = \"high\"\napi_key = \"do-not-return\"\n[profiles.fast]\nmodel = \"do-not-return\"",
        );
        assert_eq!(codex.model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(codex.reasoning_effort.as_deref(), Some("high"));

        let claude = parse_claude_runtime_config(
            r#"{"model":"opus","effortLevel":"xhigh","env":{"ANTHROPIC_MODEL":"sonnet","ANTHROPIC_AUTH_TOKEN":"do-not-return"}}"#,
        );
        assert_eq!(claude.model.as_deref(), Some("opus"));
        assert_eq!(claude.reasoning_effort.as_deref(), Some("xhigh"));
    }

    #[test]
    fn codex_model_catalog_parser_keeps_visible_models_and_their_efforts() {
        let catalog = parse_codex_model_catalog(
            r#"{"models":[{"slug":"gpt-visible","display_name":"GPT Visible","visibility":"list","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low","description":"Fast"},{"effort":"high","description":"Deep"}]},{"slug":"gpt-hidden","display_name":"GPT Hidden","visibility":"hide","default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"high","description":"Deep"}]}]}"#,
        );

        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].value, "gpt-visible");
        assert_eq!(catalog[0].label, "GPT Visible");
        assert_eq!(
            catalog[0].default_reasoning_effort.as_deref(),
            Some("medium")
        );
        assert_eq!(catalog[0].reasoning_efforts, ["low", "high"]);
    }

    #[test]
    fn claude_help_parser_extracts_local_aliases_and_effort_choices() {
        let help = parse_claude_help(
            "--effort <level>  Effort level (low, medium, high, xhigh, max)\n--model <model>  Provide an alias (e.g. 'sonnet' or 'opus') or a model's full name",
        );

        assert_eq!(help.model_aliases, ["sonnet", "opus"]);
        assert_eq!(
            help.reasoning_efforts,
            ["low", "medium", "high", "xhigh", "max"]
        );
    }
}
