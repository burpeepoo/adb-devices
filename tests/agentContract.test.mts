import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

test("agent commands are registered and exposed through a dedicated backend module", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const commandsMod = readFileSync(new URL("../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");

  assert.match(commandsMod, /pub mod agent;/);
  assert.match(commandsMod, /pub mod agent_cli;/);
  for (const command of [
    "adb_agent_status",
    "adb_agent_install",
    "adb_agent_start",
    "adb_agent_connect",
    "adb_agent_stop",
    "adb_agent_sample",
  ]) {
    assert.match(lib, new RegExp(`commands::agent::${command}`));
  }
  assert.match(lib, /commands::agent_cli::agent_cli_analyze/);
});

test("agent APK is configured as a bundled Tauri resource", () => {
  const tauriConfig = readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");
  const parsed = JSON.parse(tauriConfig);

  assert.ok(parsed.bundle.resources.includes("resources/agent"));
  assert.ok(statSync(new URL("../src-tauri/resources/agent/adb-manager-agent.apk", import.meta.url)).size > 0);
});

test("desktop build workflow ensures the Agent APK before frontend build", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const ensureScript = readFileSync(new URL("../scripts/ensure-agent-apk.mjs", import.meta.url), "utf8");
  const buildScript = readFileSync(new URL("../agent-android/build-agent-apk.sh", import.meta.url), "utf8");

  assert.match(packageJson.scripts.build, /ensure:agent-apk/);
  assert.equal(packageJson.scripts["build:agent"], "bash agent-android/build-agent-apk.sh");
  assert.match(ensureScript, /adb-manager-agent\.apk/);
  assert.match(buildScript, /--v4-signing-enabled false/);
});

test("agent starts through an exported bootstrap activity while service stays private", () => {
  const manifest = readFileSync(new URL("../agent-android/AndroidManifest.xml", import.meta.url), "utf8");
  const agentBackend = readFileSync(new URL("../src-tauri/src/commands/agent.rs", import.meta.url), "utf8");

  assert.match(manifest, /android:name="\.AgentBootstrapActivity"[\s\S]*android:exported="true"/);
  assert.match(manifest, /android:name="\.AgentService"[\s\S]*android:exported="false"/);
  assert.match(agentBackend, /AGENT_BOOTSTRAP_ACTIVITY/);
  assert.match(agentBackend, /"start", "-n", AGENT_BOOTSTRAP_ACTIVITY/);
});

test("agent connect retries health while the bootstrap service is warming up", () => {
  const agentBackend = readFileSync(new URL("../src-tauri/src/commands/agent.rs", import.meta.url), "utf8");

  assert.match(agentBackend, /read_agent_health_with_retry/);
  assert.match(agentBackend, /Duration::from_secs\(3\)/);
  assert.match(agentBackend, /Duration::from_millis\(200\)/);
});

test("agent updates use data-preserving install and do not auto-uninstall on signature mismatch", () => {
  const agentBackend = readFileSync(new URL("../src-tauri/src/commands/agent.rs", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/PerformancePanel.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");

  assert.match(agentBackend, /AgentStatusKind::UpdateAvailable/);
  assert.match(agentBackend, /\["install", "-r", &apk_path_string\]/);
  assert.match(agentBackend, /agent_install_requires_manual_data_migration/);
  assert.doesNotMatch(agentBackend, /\["uninstall", AGENT_PACKAGE\]/);
  assert.match(panel, /nextStatus\.apk_available/);
  assert.match(panel, /agentStatusUpdateAvailable/);
  assert.match(types, /"update_available"/);
  assert.match(types, /bundled_version_name/);
  assert.match(types, /update_available/);
});

test("agent start attempts usage stats app-op without making it mandatory", () => {
  const agentBackend = readFileSync(new URL("../src-tauri/src/commands/agent.rs", import.meta.url), "utf8");

  assert.match(agentBackend, /grant_agent_usage_stats/);
  assert.match(agentBackend, /"appops",\s*"set",\s*AGENT_PACKAGE,\s*"GET_USAGE_STATS",\s*"allow"/);
});

test("performance panel contains the optional Agent mode controls and source display", () => {
  const source = readFileSync(new URL("../src/components/PerformancePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /adb_agent_status/);
  assert.match(source, /adb_agent_install/);
  assert.match(source, /adb_agent_start/);
  assert.match(source, /adb_agent_connect/);
  assert.match(source, /performance\.agentMode/);
  assert.match(source, /performance\.sampleSource/);
});

test("android device copilot is a dedicated experimental workspace tab", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const tabState = readFileSync(new URL("../src/tabState.ts", import.meta.url), "utf8");
  const toolRail = readFileSync(new URL("../src/components/layout/ToolRail.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");

  assert.match(tabState, /"agent"/);
  assert.match(app, /<AgentCopilot/);
  assert.match(toolRail, /IconRobot/);
  assert.match(copilot, /STORE_KEYS\.agentCopilotSessions/);
  assert.match(copilot, /adb_workbench_execute/);
  assert.match(copilot, /agent\.lab/);
});

test("android device copilot keeps lab badge below the title row", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const titleIndex = copilot.indexOf('t("agent.title")');
  const badgeRowIndex = copilot.indexOf('className="agent-copilot-badge-row"');
  const labIndex = copilot.indexOf('t("agent.lab")');

  assert.ok(titleIndex > 0);
  assert.ok(badgeRowIndex > titleIndex);
  assert.ok(labIndex > badgeRowIndex);
  assert.match(copilot, /wrap="wrap"/);
});

test("android device copilot shows five random prompt suggestions that auto-send", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.equal(copilot.includes("const SUGGESTED_PROMPT_LIMIT = 5"), true);
  assert.match(copilot, /agent\.promptSuggestions/);
  assert.match(copilot, /pickRandomPromptSuggestions/);
  assert.match(copilot, /refreshPromptSuggestions/);
  assert.match(copilot, /className="agent-copilot-prompt-suggestions"/);
  assert.match(copilot, /handleSuggestedPrompt/);
  assert.match(copilot, /setDraft\(prompt\)/);
  assert.match(copilot, /submitPrompt\(prompt\)/);
  assert.ok(zh.agent.promptSuggestions.length >= 15);
  assert.ok(en.agent.promptSuggestions.length >= 15);
  assert.ok(zh.agent.promptSuggestions.some((prompt: string) => prompt.includes("Launcher 为什么卡")));
  assert.ok(en.agent.promptSuggestions.some((prompt: string) => prompt.includes("Launcher laggy")));
});

test("android device copilot auto-runs evidence collection after send with progress", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /const collectEvidence = useCallback/);
  assert.match(copilot, /await collectEvidence\(session\.id, skill, prompt\)/);
  assert.match(copilot, /agentProgress/);
  assert.match(copilot, /<Progress/);
  assert.match(copilot, /EvidenceStepResult/);
  assert.match(copilot, /buildEvidenceAnalysisMessage/);
  assert.match(copilot, /agent_cli_analyze/);
  assert.match(copilot, /buildAgentCliAnalysisPrompt/);
  assert.match(copilot, /analysisCliUnavailable/);
  assert.match(copilot, /buildDeviceReportAnalysis/);
  assert.match(copilot, /parseDataStorage/);
  assert.match(copilot, /parsePackageInventory/);
  assert.doesNotMatch(copilot, /buildEvidenceResultMessage/);
  assert.doesNotMatch(copilot, /t\("agent\.runStarted"/);
  assert.doesNotMatch(copilot, /IconPlayerPlay/);
  assert.doesNotMatch(copilot, /agent\.runSkill/);
  assert.doesNotMatch(copilot, /agent\.runSkillTooltip/);
  assert.match(zh.agent.progressStep, /正在采集证据/);
  assert.match(en.agent.progressStep, /Collecting evidence/);
  assert.match(zh.agent.progressAnalyzing, /正在分析证据/);
  assert.match(en.agent.progressAnalyzing, /analyzing the evidence/);
  assert.match(zh.agent.analysisTitle, /Agent 分析结果/);
  assert.match(en.agent.analysisTitle, /Agent Analysis/);
  assert.doesNotMatch(zh.agent.runFinished, /已完成|结果预览|诊断模板|技能来源/);
  assert.doesNotMatch(en.agent.runFinished, /Finished|Result preview|Diagnostic template|Skill source/);
});

test("android device copilot renders local document links in conversation messages", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");

  assert.match(copilot, /function MessageText/);
  assert.match(copilot, /messageDocumentParts/);
  assert.match(copilot, /openMessageDocument/);
  assert.match(copilot, /invoke\("open_file"/);
  assert.match(copilot, /invoke\("reveal_path"/);
  assert.match(copilot, /docs\|agent-android\|graphify-out/);
});

test("android agent skills exist locally and are embedded into the app catalog", () => {
  const catalog = readFileSync(new URL("../src/androidAgentSkills.ts", import.meta.url), "utf8");
  const docs = [
    "docs/agent-skills/device-report.md",
    "docs/agent-skills/performance-triage.md",
    "docs/agent-skills/black-screen-triage.md",
    "docs/agent-skills/calendar-sync-triage.md",
    "docs/agent-skills/install-failure-triage.md",
    "docs/agent-skills/wireless-adb-triage.md",
    "docs/agent-skills/input-touch-triage.md",
    "docs/agent-skills/package-state-triage.md",
    "docs/agent-skills/network-triage.md",
    "docs/agent-skills/logcat-crash-triage.md",
    "docs/agent-skills/storage-pressure-triage.md",
  ];

  for (const id of [
    "device_report",
    "performance_triage",
    "black_screen_triage",
    "calendar_sync_triage",
    "install_failure_triage",
    "wireless_adb_triage",
    "input_touch_triage",
    "package_state_triage",
    "network_triage",
    "logcat_crash_triage",
    "storage_pressure_triage",
  ]) {
    assert.match(catalog, new RegExp(`id: "${id}"`));
  }
  for (const doc of docs) {
    assert.equal(existsSync(new URL(`../${doc}`, import.meta.url)), true, `${doc} should exist`);
  }
  assert.match(catalog, /requiresAgentApk: true/);
  assert.match(catalog, /triggerKeywords/);
  assert.match(catalog, /recommendAndroidAgentSkill/);
  assert.match(catalog, /ordinary APK cannot read system GPU counters|SurfaceFlinger/);
});

test("agent chooses skills automatically and supports attachments", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");

  assert.match(copilot, /recommendAndroidAgentSkill/);
  assert.match(copilot, /pendingAttachments/);
  assert.match(copilot, /type="file" multiple hidden/);
  assert.doesNotMatch(copilot, /selectedSkillId/);
  assert.doesNotMatch(copilot, /onChange=\{\(value\) => setSelectedSkillId/);
  assert.match(types, /interface AgentCopilotAttachment/);
  assert.match(types, /attachments\?: AgentCopilotAttachment\[\]/);
});

test("agent cli settings support global defaults while device overrides live in Agent Lab", () => {
  const settings = readFileSync(new URL("../src/components/Settings.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const cliSettings = readFileSync(new URL("../src/agentCliSettings.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");

  assert.match(types, /interface AgentCliSettings/);
  assert.match(types, /perDeviceProfileIds/);
  assert.match(cliSettings, /codex_cli/);
  assert.match(cliSettings, /claude_code/);
  assert.match(cliSettings, /CUSTOM_AGENT_CLI_PROFILE_ID/);
  assert.match(settings, /agentCliGlobalProfile/);
  assert.match(settings, /placeholder="\/path\/to\/android-project"/);
  assert.match(settings, /handleSelectCustomCwd/);
  assert.match(settings, /select_directory/);
  assert.match(settings, /handleCustomCwdPaste/);
  assert.match(settings, /extractClipboardPaths/);
  assert.match(settings, /isLikelyLocalPath/);
  assert.doesNotMatch(settings, /agentCliDeviceOverrides/);
  assert.doesNotMatch(settings, /updateDeviceProfile/);
  assert.match(copilot, /deviceCliOverride/);
  assert.match(copilot, /updateCurrentDeviceProfile/);
  assert.doesNotMatch(copilot, /globalCliSettings/);
  assert.doesNotMatch(copilot, /agent\.cliSettings/);
  assert.doesNotMatch(copilot, /onOpenSettings/);
});
