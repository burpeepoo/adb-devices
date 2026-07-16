import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

test("agent commands are registered and exposed through a dedicated backend module", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const commandsMod = readFileSync(new URL("../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");

  assert.match(commandsMod, /pub mod agent;/);
  assert.match(commandsMod, /pub mod agent_attachment;/);
  assert.match(commandsMod, /pub mod agent_cli;/);
  assert.match(commandsMod, /pub mod agent_reference;/);
  assert.match(commandsMod, /pub mod ui_automation;/);
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
  assert.match(lib, /commands::agent_reference::agent_fetch_feishu_reference/);
  assert.match(lib, /commands::agent_reference::agent_get_figma_mcp_status/);
  assert.match(lib, /commands::agent_reference::agent_start_figma_mcp_login/);
  assert.match(lib, /commands::agent_attachment::read_agent_attachment_files/);
  assert.match(lib, /commands::agent_attachment::read_clipboard_agent_attachment_files/);
  assert.match(lib, /commands::agent_attachment::read_clipboard_local_paths/);
  for (const command of ["adb_ui_snapshot", "adb_ui_tap", "adb_ui_swipe", "adb_ui_press_back"]) {
    assert.match(lib, new RegExp(`commands::ui_automation::${command}`));
  }
});

test("non-streaming Agent CLI output cannot deadlock on a full pipe", () => {
  const agentCli = readFileSync(new URL("../src-tauri/src/commands/agent_cli.rs", import.meta.url), "utf8");

  assert.match(agentCli, /temp_output_file\("agent-cli-stdout"\)/);
  assert.match(agentCli, /temp_output_file\("agent-cli-stderr"\)/);
  assert.match(agentCli, /\.stdout\(Stdio::from\(stdout_file\)\)/);
  assert.match(agentCli, /\.stderr\(Stdio::from\(stderr_file\)\)/);
  assert.match(agentCli, /fs::read_to_string\(&stdout_path\)/);
  assert.match(agentCli, /fs::read_to_string\(&stderr_path\)/);
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

test("agent APK exposes a manually enabled accessibility service for Scout control", () => {
  const manifest = readFileSync(new URL("../agent-android/AndroidManifest.xml", import.meta.url), "utf8");
  const service = readFileSync(
    new URL("../agent-android/src/main/java/com/cozyla/adbmanager/agent/AgentAccessibilityService.java", import.meta.url),
    "utf8",
  );
  const accessibilityConfig = readFileSync(
    new URL("../agent-android/src/main/res/xml/agent_accessibility_service.xml", import.meta.url),
    "utf8",
  );
  const buildScript = readFileSync(new URL("../agent-android/build-agent-apk.sh", import.meta.url), "utf8");

  assert.match(manifest, /android:name="\.AgentAccessibilityService"/);
  assert.match(manifest, /android\.permission\.BIND_ACCESSIBILITY_SERVICE/);
  assert.match(manifest, /android\.accessibilityservice\.AccessibilityService/);
  assert.match(manifest, /@xml\/agent_accessibility_service/);
  assert.match(service, /extends AccessibilityService/);
  assert.match(service, /getRootInActiveWindow/);
  assert.match(service, /AccessibilityNodeInfo\.ACTION_CLICK/);
  assert.match(service, /dispatchGesture/);
  assert.match(service, /performGlobalAction\(GLOBAL_ACTION_BACK\)/);
  assert.match(accessibilityConfig, /android:canRetrieveWindowContent="true"/);
  assert.match(accessibilityConfig, /android:canPerformGestures="true"/);
  assert.match(buildScript, /aapt2" compile/);
  assert.match(buildScript, /RESOURCE_ARGS/);
});

test("Scout uses structured UI inspection and controlled actions instead of raw navigation commands", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const uiAutomation = readFileSync(new URL("../src-tauri/src/commands/ui_automation.rs", import.meta.url), "utf8");
  const agentBackend = readFileSync(new URL("../src-tauri/src/commands/agent.rs", import.meta.url), "utf8");

  assert.match(copilot, /case "ui\.inspect"/);
  assert.match(copilot, /case "ui\.tap"/);
  assert.match(copilot, /case "ui\.swipe"/);
  assert.match(copilot, /case "ui\.press_back"/);
  assert.match(copilot, /case "app\.launch"/);
  assert.match(copilot, /adb_list_launchable_apps/);
  assert.match(copilot, /adb_launch_app/);
  assert.match(copilot, /bounded observe → act → verify loop/);
  assert.match(copilot, /invokeAgentUiAction/);
  assert.match(copilot, /isExternalReferenceTool/);
  assert.match(copilot, /orderedToolCalls/);
  assert.match(copilot, /captureScribeScreenState\(evidenceSession, `ui_\$\{action\.action\}`/);
  assert.match(uiAutomation, /validate_point/);
  assert.match(uiAutomation, /agent_ui_request/);
  assert.match(uiAutomation, /adb_uiautomator/);
  assert.match(agentBackend, /POST", path/);
  assert.match(agentBackend, /agent_ui_request/);
});

test("autonomous Scout uses a bounded default CLI effort without overriding explicit choices", () => {
  const cliSettings = readFileSync(new URL("../src/agentCliSettings.ts", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");

  assert.match(cliSettings, /DEFAULT_AUTONOMOUS_SCOUT_REASONING_EFFORT = "medium"/);
  assert.match(cliSettings, /if \(profile\.reasoningEffortOverride\?\.trim\(\)\) return profile/);
  assert.match(cliSettings, /resolveAutonomousScoutCliProfile/);
  assert.match(copilot, /resolveAutonomousScoutCliProfile\(conversationCliProfile\)/);
  assert.match(copilot, /runAgentCliTurn\(autonomousScoutCliProfile/);
});

test("empty Agent accessibility trees fall back to ADB hierarchy evidence", () => {
  const uiAutomation = readFileSync(new URL("../src-tauri/src/commands/ui_automation.rs", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const walkthrough = readFileSync(new URL("../src/scoutTask/featureWalkthroughReview.ts", import.meta.url), "utf8");

  assert.match(uiAutomation, /should_fallback_to_uiautomator/);
  assert.match(uiAutomation, /snapshot\.nodes\.is_empty\(\)/);
  assert.match(uiAutomation, /fallback_attempted/);
  assert.match(copilot, /fallbackAttempted: snapshot\.fallbackAttempted/);
  assert.match(copilot, /source: snapshot\.source/);
  assert.match(walkthrough, /External reference reads are supplemental/);
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

test("scout agent tasks are a dedicated workspace tab", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const tabState = readFileSync(new URL("../src/tabState.ts", import.meta.url), "utf8");
  const toolMetadata = readFileSync(new URL("../src/toolMetadata.ts", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(tabState, /"agent"/);
  assert.match(app, /<AgentCopilot/);
  assert.match(toolMetadata, /agent: IconRobot/);
  assert.match(toolMetadata, /performance: IconActivityHeartbeat/);
  assert.match(toolMetadata, /packages: IconPackages/);
  assert.match(copilot, /toolIcons\.agent/);
  assert.match(copilot, /STORE_KEYS\.agentCopilotSessions/);
  assert.match(copilot, /adb_workbench_execute/);
  assert.match(copilot, /agent-copilot-workspace-task-rail/);
  assert.match(copilot, /agent-copilot-readiness-row/);
  assert.match(copilot, /ScoutReadinessPill/);
  assert.match(copilot, /agent-copilot-task-tabs/);
  assert.match(copilot, /role="tablist"/);
  assert.match(copilot, /role="tab"/);
  assert.match(copilot, /aria-selected=\{active\}/);
  assert.match(copilot, /onKeyDown=\{\(event\) => handleTaskTabKeyDown\(event, option\.mode\)\}/);
  assert.match(copilot, /agent\.workspaceTitle/);
  assert.match(copilot, /agent\.workspaceTaskSwitcherLabel/);
  assert.match(copilot, /agent\.workspaceTaskChatTitle/);
  assert.match(copilot, /agent\.workspaceTaskWalkthroughTitle/);
  assert.match(copilot, /agent\.workspaceTaskBugReproTitle/);
  assert.doesNotMatch(copilot, /workspaceSubtitle|workspaceTaskChatDesc|workspaceTaskWalkthroughDesc|workspaceTaskBugReproDesc/);
  assert.doesNotMatch(copilot, /className="agent-copilot-task-active-card"/);
  assert.doesNotMatch(copilot, /agent-copilot-task-choice/);
  assert.equal(zh.tabs.agent, "Agent 任务");
  assert.equal(en.tabs.agent, "Agent Tasks");
  assert.equal(zh.agent.title, "Agent 任务");
  assert.equal(en.agent.title, "Agent Tasks");
  assert.match(zh.agent.workspaceTitle, /Scout 任务控制台/);
  assert.equal(zh.agent.workspaceTaskSwitcherLabel, "Scout 任务类型");
  assert.match(zh.agent.workspaceTaskChatTitle, /对话/);
  assert.match(zh.agent.workspaceTaskWalkthroughTitle, /功能走查/);
  assert.match(zh.agent.workspaceTaskBugReproTitle, /Bug 复现/);
  assert.equal("workspaceTaskChatIndex" in zh.agent, false);
  assert.equal("workspaceTaskWalkthroughIndex" in zh.agent, false);
  assert.equal("workspaceTaskBugReproIndex" in zh.agent, false);
  assert.match(en.agent.workspaceTitle, /Scout Task Console/);
  assert.equal(en.agent.workspaceTaskSwitcherLabel, "Scout task type");
  assert.match(en.agent.workspaceTaskChatTitle, /Chat/);
  assert.match(en.agent.workspaceTaskWalkthroughTitle, /Feature walkthrough/);
  assert.match(en.agent.workspaceTaskBugReproTitle, /Bug repro/);
  assert.equal("workspaceTaskChatIndex" in en.agent, false);
  assert.equal("workspaceTaskWalkthroughIndex" in en.agent, false);
  assert.equal("workspaceTaskBugReproIndex" in en.agent, false);
  assert.doesNotMatch(zh.tabs.agent, /实验室|Copilot/);
  assert.doesNotMatch(en.tabs.agent, /Lab|Copilot/);
});

test("scout agent tasks keep environment status chips below the task console title row", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const titleIndex = copilot.indexOf('t("agent.workspaceTitle")');
  const badgeRowIndex = copilot.indexOf('className="agent-copilot-readiness-row"');
  const agentApkIndex = copilot.indexOf('agentApkStatusLabel(agentApkStatus');
  const accessibilityIndex = copilot.indexOf('accessibilityStatusLabel(accessibilityStatus');
  const runtimeIndex = copilot.indexOf('value={runtimeReadinessLabel}');

  assert.ok(titleIndex > 0);
  assert.ok(badgeRowIndex > titleIndex);
  assert.ok(agentApkIndex > badgeRowIndex);
  assert.ok(accessibilityIndex > agentApkIndex);
  assert.ok(runtimeIndex > accessibilityIndex);
  assert.match(copilot, /wrap="wrap"/);
});

test("device console prioritizes Scout tasks before grouped utility tools", () => {
  const consoleSource = readFileSync(new URL("../src/components/DeviceConsole.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(consoleSource, /device-console-root/);
  assert.match(consoleSource, /deviceConsole\.scoutTasks/);
  assert.match(consoleSource, /deviceConsole\.taskChatTitle/);
  assert.match(consoleSource, /deviceConsole\.taskWalkthroughTitle/);
  assert.match(consoleSource, /deviceConsole\.taskBugReproTitle/);
  assert.match(consoleSource, /onOpenScout\("chat"\)/);
  assert.match(consoleSource, /onOpenScout\("walkthrough"\)/);
  assert.match(consoleSource, /onOpenScout\("bug_repro"\)/);
  assert.match(consoleSource, /cols=\{\{ base: 1, sm: 2, lg: 3 \}\}/);
  assert.ok(consoleSource.indexOf("deviceConsole.taskChatTitle") < consoleSource.indexOf("deviceConsole.taskWalkthroughTitle"));
  assert.match(app, /handleOpenScoutTask/);
  assert.match(app, /onOpenScout=\{handleOpenScoutTask\}/);
  assert.match(app, /requestedMode=\{agentRequestedMode\}/);
  assert.match(app, /modeRequestId=\{agentModeRequestId\}/);
  assert.match(copilot, /requestedMode/);
  assert.match(copilot, /modeRequestId\?: number/);
  assert.match(copilot, /setCopilotMode\(requestedMode\)/);
  assert.match(consoleSource, /buildToolGroups/);
  assert.match(consoleSource, /device-console-tool-group/);
  assert.doesNotMatch(consoleSource, /DeviceConsoleShortcuts/);
  assert.doesNotMatch(
    consoleSource,
    /deviceConsole\.(scoutTasksDesc|taskWalkthroughDesc|taskBugReproDesc|captureToolsDesc|diagnosticToolsDesc|appToolsDesc)/,
  );
  assert.match(consoleSource, /device-console-tool-grid/);
  assert.match(consoleSource, /justify="flex-start"/);
  assert.match(consoleSource, /mih=\{40\}/);
  assert.doesNotMatch(consoleSource, /\s+h=\{40\}/);
  assert.match(styles, /\.device-console-task-card/);
  assert.match(styles, /\.device-console-tool-group/);
  assert.match(styles, /--device-console-tool-button-max-width:\s*172px/);
  assert.match(styles, /\.device-console-tool-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.device-console-tool-grid\s*\{[\s\S]*max-width:\s*calc\(\(var\(--device-console-tool-button-max-width\) \* 2\) \+ var\(--space-xs\)\)/);
  assert.match(styles, /\.device-console-tool-grid\s*\{[\s\S]*justify-content:\s*start/);
  assert.match(styles, /\.device-console-tool-group \.mantine-Button-root\s*\{[\s\S]*width:\s*100%/);
  assert.match(styles, /\.device-console-tool-group \.mantine-Button-root\s*\{[\s\S]*max-width:\s*var\(--device-console-tool-button-max-width\)/);
  assert.match(styles, /font-size:\s*12px !important/);
  assert.match(styles, /\.device-console-tool-group \.mantine-Button-section/);
  assert.match(styles, /flex:\s*0 0 18px/);
  assert.match(styles, /justify-content:\s*flex-start/);
  assert.match(styles, /text-align:\s*left/);
  assert.match(styles, /white-space:\s*nowrap/);
  const scoutIndex = consoleSource.indexOf("deviceConsole.scoutTasks");
  const workflowIndex = consoleSource.indexOf("deviceConsole.workflowTools");
  assert.ok(scoutIndex >= 0);
  assert.ok(workflowIndex > scoutIndex);
  assert.match(zh.deviceConsole.scoutTasks, /Scout/);
  assert.match(zh.deviceConsole.taskChatTitle, /对话/);
  assert.match(zh.deviceConsole.taskWalkthroughTitle, /功能走查/);
  assert.match(zh.deviceConsole.taskBugReproTitle, /Bug 复现/);
  assert.match(zh.deviceConsole.workflowTools, /设备工具/);
  assert.match(en.deviceConsole.scoutTasks, /Scout Tasks/);
  assert.match(en.deviceConsole.taskChatTitle, /Chat/);
  assert.match(en.deviceConsole.taskWalkthroughTitle, /Feature walkthrough/);
  assert.match(en.deviceConsole.taskBugReproTitle, /Bug repro/);
  assert.match(en.deviceConsole.workflowTools, /Device tools/);
});

test("main navigation groups primary tasks before utility tools", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const rail = readFileSync(new URL("../src/components/layout/ToolRail.tsx", import.meta.url), "utf8");
  const railCss = readFileSync(new URL("../src/components/layout/ToolRail.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(app, /const railTools = \[/);
  assert.match(app, /groupLabel: t\("layout\.navPrimary"\)/);
  assert.match(app, /groupLabel: t\("layout\.navCapture"\)/);
  assert.match(app, /groupLabel: t\("layout\.navDiagnostics"\)/);
  assert.match(app, /groupLabel: t\("layout\.navApps"\)/);
  assert.match(app, /groupLabel: t\("layout\.navUtilities"\)/);
  assert.match(app, /emphasis: "primary"/);
  const pairIndex = app.indexOf('{ key: "pair" as const');
  const agentIndex = app.indexOf('{ key: "agent" as const');
  const screenshotIndex = app.indexOf('{ key: "screenshot" as const');
  const workbenchIndex = app.indexOf('{ key: "workbench" as const');
  assert.ok(pairIndex >= 0);
  assert.ok(agentIndex > pairIndex);
  assert.ok(screenshotIndex > agentIndex);
  assert.ok(workbenchIndex > screenshotIndex);
  assert.match(rail, /tool-rail__section-label/);
  assert.match(rail, /data-emphasis/);
  assert.match(railCss, /\.tool-rail__section-label/);
  assert.match(railCss, /\[data-emphasis="primary"\]/);
  assert.match(zh.layout.navPrimary, /主线/);
  assert.match(zh.layout.navCapture, /采集/);
  assert.match(zh.layout.navDiagnostics, /诊断/);
  assert.match(zh.layout.navApps, /应用/);
  assert.match(en.layout.navPrimary, /Primary/);
  assert.match(en.layout.navCapture, /Capture/);
  assert.match(en.layout.navDiagnostics, /Diagnostics/);
  assert.match(en.layout.navApps, /Apps/);
});

test("scout is only available inside the Agent Tasks workspace", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(app, /if \(tab === "agent"\)/);
  assert.match(app, /<AgentCopilot/);
  assert.doesNotMatch(app, /copilotDrawerOpen/);
  assert.doesNotMatch(app, /<Drawer/);
  assert.doesNotMatch(app, /position="right"/);
  assert.doesNotMatch(app, /surface="drawer"/);
  assert.doesNotMatch(app, /drawerOpen=/);
  assert.doesNotMatch(app, /agent\.openCopilot/);
  assert.doesNotMatch(app, /position: "fixed"/);
  assert.doesNotMatch(copilot, /surface =/);
  assert.doesNotMatch(copilot, /drawerSurface/);
  assert.doesNotMatch(copilot, /AgentApkStatusStrip/);
  assert.doesNotMatch(copilot, /ScoutAccessibilityStrip/);
  assert.doesNotMatch(copilot, /agent-copilot-apk-strip/);
  assert.doesNotMatch(copilot, /agent-copilot-accessibility-strip/);
  assert.doesNotMatch(copilot, /agent-copilot-cli-strip/);
  assert.doesNotMatch(copilot, /agent-copilot-drawer-layout/);
  assert.match(copilot, /agent-copilot-layout/);
  assert.match(copilot, /agent-copilot-panel-header/);
  assert.match(copilot, /agent-copilot-readiness-row/);
  assert.match(copilot, /refreshAgentApkStatus/);
  assert.match(copilot, /installAgentApk/);
  assert.match(copilot, /adb_agent_status/);
  assert.match(copilot, /adb_agent_install/);
  assert.match(copilot, /adb_agent_start/);
  assert.match(copilot, /adb_agent_connect/);
  assert.match(copilot, /enabled_accessibility_services/);
  assert.match(copilot, /android\.settings\.ACCESSIBILITY_SETTINGS/);
  assert.match(copilot, /AGENT_ACCESSIBILITY_COMPONENT/);
  assert.match(copilot, /agentApkMissingLabel/);
  assert.match(copilot, /agentApkNeedsInstall/);
  assert.match(copilot, /void installAgentApk\(\)/);
  assert.match(copilot, /openAccessibilitySettings/);
  assert.match(copilot, /Current ADB Manager context/);
  assert.equal("openCopilot" in zh.agent, false);
  assert.equal("openCopilot" in en.agent, false);
  assert.equal("drawerTitle" in zh.agent, false);
  assert.equal("drawerTitle" in en.agent, false);
  assert.equal("drawerContext" in zh.agent, false);
  assert.equal("drawerContext" in en.agent, false);
  assert.match(zh.agent.agentApkMissingDescription, /未安装 Agent APK/);
  assert.match(zh.agent.agentApkInstallAction, /安装并启动/);
  assert.match(zh.agent.accessibilityCardTitle, /Scout 控制/);
  assert.match(zh.agent.accessibilityOpenSettingsAction, /打开无障碍设置/);
  assert.match(en.agent.agentApkMissingDescription, /not installed/);
  assert.match(en.agent.agentApkInstallAction, /Install and start/);
  assert.match(en.agent.accessibilityEnabledDescription, /control-level UI actions/);
});

test("android device copilot is wired to the Cirrus design system", () => {
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const systemCss = readFileSync(new URL("../src/styles/system.css", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const appShellCss = readFileSync(new URL("../src/components/layout/AppShellLayout.css", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/components/layout/AppShellLayout.tsx", import.meta.url), "utf8");
  const toolRailCss = readFileSync(new URL("../src/components/layout/ToolRail.css", import.meta.url), "utf8");
  const toolRail = readFileSync(new URL("../src/components/layout/ToolRail.tsx", import.meta.url), "utf8");
  const statusBar = readFileSync(new URL("../src/components/layout/StatusBar.tsx", import.meta.url), "utf8");

  assert.match(indexCss, /@import "\.\/styles\/system\.css";/);
  assert.equal((indexCss.match(/system\.css/g) ?? []).length, 1);
  assert.match(systemCss, /Cirrus/);
  assert.match(systemCss, /--color-sky: #edf2f7/);
  assert.match(systemCss, /--color-horizon: #b8d4f1/);
  assert.match(systemCss, /--color-ink: #0e1116/);
  assert.match(systemCss, /--color-signal: #2e7def/);
  assert.match(systemCss, /--font-display: "Inter Tight"/);
  assert.match(systemCss, /--font-serif: "Instrument Serif"/);
  assert.match(systemCss, /--radius-pill: 999px/);
  assert.match(systemCss, /--radius-card: 28px/);
  assert.match(systemCss, /--radius-tile: 20px/);
  assert.match(systemCss, /--radius-xl: 36px/);
  assert.match(systemCss, /0 20px 40px -24px rgba\(14, 17, 22, 0\.18\)/);
  assert.match(systemCss, /0 20px 40px -24px rgba\(14, 17, 22, 0\.22\)/);
  assert.match(indexCss, /all feature pages inherit the Cirrus system/);
  assert.match(indexCss, /Legacy Tailwind palette bridge/);
  assert.match(systemCss, /--tracking-tight: -0\.025em/);
  assert.match(main, /primaryColor: "ink"/);
  assert.match(main, /fontFamily: "var\(--font-sans\)"/);
  assert.match(main, /fontFamilyMonospace: "var\(--font-mono\)"/);
  assert.match(main, /xl: "999px"/);
  assert.match(appShellCss, /var\(--color-horizon\)/);
  assert.match(appShellCss, /var\(--shadow-tier-2\)/);
  assert.match(appShell, /app-shell-layout__status/);
  assert.match(appShellCss, /\.app-shell-layout__status/);
  assert.match(toolRailCss, /rail-card/);
  assert.match(toolRail, /tool-rail__scroll/);
  assert.match(toolRail, /tool-rail__footer/);
  assert.match(toolRailCss, /\.tool-rail__scroll\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(toolRailCss, /\.tool-rail__footer/);
  assert.match(toolRailCss, /var\(--color-ink\)/);
  assert.match(statusBar, /borderRadius: "var\(--radius-pill\)"/);
  assert.match(copilot, /className="agent-copilot-system"/);
  assert.match(copilot, /agent-copilot-card agent-copilot-panel/);
  assert.match(copilot, /agent-copilot-card agent-copilot-session-list/);
  assert.match(copilot, /agent-copilot-title-badge/);
  assert.match(copilot, /agent-copilot-layout/);
  assert.match(copilot, /agent-copilot-panel-header/);
  assert.match(copilot, /agent-copilot-mode-body/);
  assert.match(copilot, /agent-copilot-mode-footer/);
  assert.match(copilot, /agent-copilot-readiness-pill/);
  assert.match(copilot, /agent-copilot-evidence-item/);
  assert.match(copilot, /agent-copilot-message-/);
});

test("workspace UI does not reintroduce the obsolete blue gray shell styling", () => {
  const srcRoot = new URL("../src/", import.meta.url);
  const files = collectFiles(srcRoot).filter((file) => /\.(css|tsx|ts)$/.test(file.pathname));
  const forbiddenPatterns = [
    /Mossforge/,
    /Manrope/,
    /#111827/,
    /mantine-color-/,
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${file.pathname} should not match ${pattern}`);
    }
  }
  assert.equal(existsSync(new URL("../system.css", import.meta.url)), false);
});

test("adb workbench uses the Cirrus workbench layout instead of legacy utility cards", () => {
  const workbench = readFileSync(new URL("../src/components/AdbWorkbench.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  assert.match(workbench, /adb-workbench-root/);
  assert.match(workbench, /adb-workbench-shell/);
  assert.match(workbench, /adb-workbench-grid/);
  assert.match(workbench, /adb-workbench-library/);
  assert.match(workbench, /adb-workbench-composer/);
  assert.match(workbench, /adb-workbench-command-panel/);
  assert.match(workbench, /adb-workbench-result-tabs/);
  assert.match(workbench, /role="tablist"/);
  assert.match(workbench, /aria-selected=\{outputTab === "output"\}/);
  assert.match(workbench, /aria-selected=\{outputTab === "history"\}/);
  assert.match(workbench, /adb-workbench-output-console/);
  assert.match(workbench, /workbench-risk-pill/);
  assert.doesNotMatch(workbench, /DeviceTargetBanner/);
  assert.match(styles, /\.adb-workbench-root/);
  assert.match(styles, /\.adb-workbench-shell,\n\.adb-workbench-output-console/);
  assert.match(styles, /\.adb-workbench-shell\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(styles, /\.adb-workbench-shell\s*\{[\s\S]*height:\s*clamp\(320px, 36vh, 420px\)/);
  assert.match(styles, /\.adb-workbench-grid\s*\{[\s\S]*min-height:\s*0/);
  assert.match(styles, /\.adb-workbench-library__list\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(styles, /\.adb-workbench-library\s*\{[\s\S]*border-right: var\(--border-hairline\)/);
  assert.match(styles, /\.adb-workbench-command-panel\s*\{[\s\S]*border-top: var\(--border-soft\)/);
  assert.match(styles, /\.adb-workbench-output-console\s*\{[\s\S]*overflow: visible/);
  assert.match(styles, /\.adb-workbench-result-tabs button\.is-active\s*\{[\s\S]*background: var\(--color-ink\)/);
  assert.match(styles, /\.adb-workbench-command-card\.is-active/);
  assert.match(styles, /\.adb-workbench-command-card__main\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(styles, /\.adb-workbench-command-card__desc\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.adb-workbench-command-card__desc\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.workbench-risk-pill\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(styles, /\.adb-workbench-mode-switch/);
  assert.match(styles, /\.workbench-risk-pill--high/);
  assert.match(styles, /\.adb-workbench-textarea\s*\{[\s\S]*border-radius:\s*22px/);
  assert.doesNotMatch(styles, /\.adb-workbench-output-console\s*\{[\s\S]*max-height:\s*42%/);
  assert.doesNotMatch(styles, /\.adb-workbench-grid\s*\{[\s\S]*min-height:\s*560px/);
  assert.doesNotMatch(styles, /\.adb-workbench-command-card__desc\s*\{[\s\S]*-webkit-line-clamp/);
  assert.doesNotMatch(workbench, /border-blue-200|bg-blue-50|text-blue-600|text-gray-900|border-gray-200 bg-white/);
});

test("android device copilot keeps conversation titles separate from evidence templates", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /activeConversationTitle/);
  assert.match(copilot, /sessionDisplayTitle/);
  assert.match(copilot, /stripLegacySkillPrefix/);
  assert.match(copilot, /agent\.conversationBadge/);
  assert.doesNotMatch(copilot, /activeSession\?\.title \|\| skillLabel\(recommendedSkill/);
  assert.doesNotMatch(copilot, /skillLabel\(activeSkill, t\)/);
  assert.match(zh.agent.conversationTitle, /新对话/);
  assert.match(zh.agent.conversationBadge, /对话/);
  assert.equal(zh.agent.sessionStarted, "{{device}} · {{cli}}");
  assert.match(en.agent.conversationTitle, /New chat/);
  assert.match(en.agent.conversationBadge, /Chat/);
  assert.equal(en.agent.sessionStarted, "{{device}} · {{cli}}");
});

test("android device copilot uses user-facing evidence without manual template runs", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /agent\.evidenceKind/);
  assert.match(copilot, /agent\.evidenceIdleStatus/);
  assert.doesNotMatch(copilot, /agent\.evidenceIdleHint/);
  assert.doesNotMatch(copilot, /evidenceChecklistDraftLabel|evidenceStartChecklist|checklistDraft|parseChecklistItems|updateChecklistStatus/);
  assert.match(zh.agent.evidencePanelTitle, /证据记录/);
  assert.equal(zh.agent.evidenceStartWalkthrough, "开始走查");
  assert.equal(zh.agent.evidenceStartBugRepro, "开始复现");
  assert.equal("evidenceIdleHint" in zh.agent, false);
  assert.equal("evidenceIdleHint" in en.agent, false);
  assert.doesNotMatch(zh.agent.evidenceNoActive, /Evidence Session/);
  assert.doesNotMatch(copilot, /runSuggestedTemplate|templateSuggestionSkill|agenticPlaybookAction|agenticPlaybookHint/);
  assert.equal("agenticPlaybookAction" in zh.agent, false);
  assert.equal("agenticPlaybookHint" in en.agent, false);
  assert.match(en.agent.evidencePanelTitle, /Evidence record/);
});

test("android device copilot shows five random prompt suggestions that auto-send", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.equal(copilot.includes("const SUGGESTED_PROMPT_LIMIT = 5"), true);
  assert.match(copilot, /agent\.promptSuggestions/);
  assert.match(copilot, /pickRandomPromptSuggestions/);
  assert.match(copilot, /refreshPromptSuggestions/);
  assert.match(copilot, /const showPromptSuggestions =/);
  assert.match(copilot, /const visibleMessages = activeMessages\.filter\(\(message\) => message\.role !== "system" && !message\.contextOnly\)/);
  assert.match(copilot, /visibleMessages\.length === 0/);
  assert.match(copilot, /className="agent-copilot-prompt-suggestions"/);
  assert.match(copilot, /handleSuggestedPrompt/);
  assert.match(copilot, /setDraft\(prompt\)/);
  assert.match(copilot, /submitPrompt\(prompt\)/);
  assert.ok(zh.agent.promptSuggestions.length >= 15);
  assert.ok(en.agent.promptSuggestions.length >= 15);
  assert.ok(zh.agent.promptSuggestions.some((prompt: string) => prompt.includes("Launcher 为什么卡")));
  assert.ok(en.agent.promptSuggestions.some((prompt: string) => prompt.includes("Launcher laggy")));
});

test("android device copilot keeps chat bubbles nameless and shows time only on hover", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));
  const messageBubble = copilot.slice(copilot.indexOf("function MessageBubble"), copilot.indexOf("function AttachmentPreviewCard"));

  assert.match(messageBubble, /const timeLabel = formatAgentMessageTimeLabel/);
  assert.match(messageBubble, /title=\{timeLabel\}/);
  assert.match(messageBubble, /agent-copilot-message-time/);
  assert.doesNotMatch(messageBubble, /<Badge[\s\S]*\{message\.role\}/);
  assert.match(copilot, /hasVisibleThinkingMessage/);
  assert.match(copilot, /key="agent-running-placeholder"/);
  assert.match(copilot, /className="agent-copilot-chat-composer"/);
  assert.match(copilot, /className="agent-copilot-chat-input"/);
  assert.match(css, /\.agent-copilot-message:hover \.agent-copilot-message-time/);
  assert.match(css, /\.agent-copilot-chat-input \.mantine-Textarea-input[\s\S]*\{\n  min-height: 44px;/);
  assert.match(zh.agent.messageSentAt, /发送于/);
  assert.match(zh.agent.messageCompletedAt, /完成于/);
  assert.match(en.agent.messageSentAt, /Sent at/);
  assert.match(en.agent.messageCompletedAt, /Completed at/);
});

test("android device copilot is agent-driven and does not force evidence collection after send", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /runAgentConversation/);
  assert.match(copilot, /buildAgentConversationPrompt/);
  assert.match(copilot, /extractAgentToolRequest/);
  assert.match(copilot, /executeAgentToolCall/);
  assert.match(copilot, /toolCalls/);
  assert.match(copilot, /Tool-call protocol: a tool call is only a request/);
  assert.match(copilot, /formatAgentStreamPreview/);
  assert.match(copilot, /toolCallPending/);
  assert.match(copilot, /collectDefaultAgentContext/);
  assert.match(copilot, /collectPerformanceContextResult/);
  assert.match(copilot, /adb_agent_sample/);
  assert.match(copilot, /adb_performance_stream_snapshot/);
  assert.match(copilot, /mergePerformanceAgentSample/);
  assert.match(copilot, /appendThinkingMessage/);
  assert.match(copilot, /ThinkingIndicator/);
  assert.match(copilot, /viewportRef=\{messageViewportRef\}/);
  assert.match(copilot, /handleComposerKeyDown/);
  assert.match(copilot, /event\.key !== "Enter"/);
  assert.match(copilot, /composerComposingRef/);
  assert.match(copilot, /ignoreNextComposerEnterRef/);
  assert.match(copilot, /nativeEvent\.keyCode === 229/);
  assert.match(copilot, /nativeEvent\.which === 229/);
  assert.match(copilot, /onCompositionStart=\{handleComposerCompositionStart\}/);
  assert.match(copilot, /onCompositionEnd=\{handleComposerCompositionEnd\}/);
  assert.match(copilot, /workbench\.request_adb_command/);
  assert.doesNotMatch(copilot, /evidence\.start_session/);
  assert.match(copilot, /approveAgentCommand/);
  assert.match(copilot, /denyAgentCommand/);
  assert.match(copilot, /approvalAllowOnce/);
  assert.match(types, /interface AgentApprovalRequest/);
  assert.match(types, /evidenceKind\?: EvidenceSessionKind/);
  assert.match(types, /status: "pending" \| "running" \| "approved" \| "denied"/);
  assert.match(types, /thinking\?: boolean/);
  assert.doesNotMatch(copilot, /collectEvidence|runSuggestedTemplate|templateSuggestionSkill|agentProgress|<Progress|EvidenceStepResult/);
  assert.match(copilot, /agent_cli_analyze/);
  assert.match(copilot, /Default device context collected before this turn/);
  assert.doesNotMatch(copilot, /buildEvidenceResultMessage/);
  assert.doesNotMatch(copilot, /t\("agent\.runStarted"/);
  assert.doesNotMatch(copilot, /IconPlayerPlay/);
  assert.doesNotMatch(copilot, /agent\.runSkill/);
  assert.doesNotMatch(copilot, /agent\.runSkillTooltip/);
  assert.match(zh.agent.thinking, /Thinking/);
  assert.match(en.agent.thinking, /Thinking/);
  assert.match(zh.agent.toolPerformanceContext, /性能上下文/);
  assert.match(en.agent.toolPerformanceContext, /performance context/i);
  assert.match(zh.agent.toolCallPending, /等待本轮输出完成后执行/);
  assert.match(en.agent.toolCallPending, /Waiting for this turn to finish/i);
  assert.match(zh.agent.approvalTitle, /授权/);
  assert.match(en.agent.approvalTitle, /Approval/);
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

test("android device copilot supports evidence sessions for walkthroughs and repros", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const evidenceBackend = readFileSync(new URL("../src-tauri/src/commands/evidence.rs", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../src/storage.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(storage, /evidenceSessions/);
  assert.match(types, /type EvidenceSessionKind = "walkthrough" \| "bug_repro"/);
  assert.match(types, /type EvidenceScribeIntensity = "quiet" \| "key_moments" \| "live"/);
  assert.match(types, /type ScoutTaskPermissionLevel = "read_only" \| "semi_auto" \| "auto_execute"/);
  assert.match(types, /interface EvidenceScribeState/);
  assert.match(types, /permissionLevel\?: ScoutTaskPermissionLevel/);
  assert.match(types, /targetPackage\?: string/);
  assert.match(types, /uiReferenceUrl\?: string/);
  assert.match(types, /agentActive\?: boolean/);
  assert.match(types, /agentStartedAt\?: number \| null/);
  assert.match(types, /agentStoppedAt\?: number \| null/);
  assert.match(types, /screen_state/);
  assert.match(types, /agent_note/);
  assert.match(types, /interface EvidenceSession/);
  assert.match(types, /scribe\?: EvidenceScribeState/);
  assert.match(copilot, /createEvidenceSession/);
  assert.match(copilot, /from "\.\.\/scoutTask"/);
  assert.match(copilot, /startScoutTask/);
  assert.match(copilot, /addScoutTaskArtifact/);
  assert.match(copilot, /stopScoutTaskWithReport/);
  assert.match(copilot, /failScoutTaskReport/);
  assert.match(copilot, /ScoutTaskPorts/);
  assert.doesNotMatch(copilot, /buildDefaultEvidenceScribe/);
  assert.match(copilot, /normalizeEvidenceScribe/);
  assert.match(copilot, /captureScribeScreenState/);
  assert.match(copilot, /runEvidenceScribeReview/);
  assert.match(copilot, /maybeRunEvidenceScribeReview/);
  assert.match(copilot, /evidence\.get_active_record/);
  assert.match(copilot, /serializeEvidenceSessionForTool/);
  assert.match(copilot, /buildEvidenceTimelineForPrompt/);
  assert.doesNotMatch(copilot, /captureEvidenceScreenshot/);
  assert.doesNotMatch(copilot, /startEvidenceRecording/);
  assert.doesNotMatch(copilot, /stopEvidenceRecording/);
  assert.doesNotMatch(copilot, /markEvidenceIssue/);
  assert.match(copilot, /adb_read_logcat/);
  assert.match(copilot, /exportEvidenceReport/);
  assert.match(copilot, /export_evidence_package/);
  assert.match(copilot, /buildEvidenceExportAssets/);
  assert.match(copilot, /agent\.evidencePackageExported/);
  assert.doesNotMatch(copilot, /agent\.evidenceEnd/);
  assert.match(copilot, /buildEvidenceSessionReport/);
  assert.match(copilot, /EvidenceRecordTimeline/);
  assert.match(copilot, /EvidenceRecordHistory/);
  assert.match(copilot, /EvidenceArtifactItem/);
  assert.match(copilot, /EvidenceArtifactImagePreview/);
  assert.match(copilot, /artifact\.type === "screen_state"/);
  assert.match(copilot, /screenStateNeedsAttention/);
  assert.match(copilot, /evidenceScreenStateDetails/);
  assert.match(copilot, /evidenceScreenStateHideDetails/);
  assert.match(copilot, /showArtifactPath/);
  assert.match(copilot, /read_image_preview_data_url/);
  assert.match(copilot, /isPreviewableEvidenceImagePath/);
  assert.match(copilot, /className="agent-copilot-image-preview-trigger"/);
  assert.match(copilot, /aria-label=\{t\("agent\.evidenceOpenImagePreview"\)\}/);
  assert.match(copilot, /title=\{t\("agent\.evidenceImagePreviewTitle"\)\}/);
  assert.doesNotMatch(copilot, /convertFileSrc/);
  assert.match(copilot, /openEvidenceArtifactPath/);
  assert.doesNotMatch(copilot, /function evidenceArtifactColor/);
  assert.doesNotMatch(copilot, /<Badge size="xs" color=\{evidenceArtifactColor/);
  assert.match(copilot, /DEFAULT_SCOUT_TASK_PERMISSION_LEVEL/);
  assert.match(copilot, /permissionLevel/);
  assert.match(copilot, /uiReferenceUrl/);
  assert.match(copilot, /targetPackage/);
  assert.match(copilot, /evidenceTargetPackageDraft/);
  assert.match(copilot, /setEvidenceTargetPackageDraft\(""\);[\s\S]*setTargetPackagePickerOpen\(false\);[\s\S]*\}, \[deviceKey\]\)/);
  assert.match(copilot, /ScoutPackagePickerModal/);
  assert.match(copilot, /invoke<string\[\]>\("adb_list_packages"/);
  assert.match(copilot, /agent-copilot-reference-row/);
  assert.match(copilot, /agent-copilot-package-picker/);
  assert.match(copilot, /agent-copilot-package-picker[\s\S]*agent-copilot-ui-reference-input/);
  assert.match(css, /\.agent-copilot-reference-row \{[\s\S]*display: flex;/);
  assert.match(css, /\.agent-copilot-reference-row \{[\s\S]*flex-wrap: wrap;/);
  assert.match(css, /\.agent-copilot-package-picker \{[\s\S]*flex: 0 1 220px;/);
  assert.match(css, /\.agent-copilot-package-option \{[\s\S]*min-height: 44px;/);
  assert.match(copilot, /Target package:/);
  assert.match(copilot, /input\.session\.kind === "walkthrough"[\s\S]*Target package:/);
  assert.match(copilot, /session\.kind === "walkthrough"[\s\S]*Target package:/);
  assert.match(copilot, /evidenceUiReferenceUrlDraft/);
  assert.match(copilot, /FIGMA_REFERENCE_URL_PATTERN/);
  assert.match(copilot, /LARK_REFERENCE_URL_PATTERN/);
  assert.match(copilot, /uiReferenceHintKey/);
  assert.match(copilot, /uiReferenceUrlPlaceholder/);
  assert.match(copilot, /uiReferenceFigmaMcpHint/);
  assert.match(copilot, /uiReferenceFeishuCliHint/);
  assert.match(copilot, /EXTERNAL_REFERENCE_WORKFLOW_RULES/);
  assert.match(copilot, /prototype image, screenshot, Figma link, or Feishu\/Lark link/);
  assert.match(copilot, /Figma MCP/);
  assert.match(copilot, /lark-cli/);
  assert.match(copilot, /reference\.feishu\.fetch/);
  assert.match(copilot, /reference\.figma\.mcp_status/);
  assert.match(copilot, /reference\.figma\.login/);
  assert.match(copilot, /agent_fetch_feishu_reference/);
  assert.match(copilot, /agent_start_figma_mcp_login/);
  assert.match(copilot, /MESSAGE_COLLAPSE_THRESHOLD/);
  assert.match(copilot, /messageExpand/);
  assert.match(copilot, /messageCollapse/);
  assert.match(copilot, /openMessageUrl/);
  assert.match(copilot, /UI reference URL:/);
  assert.match(copilot, /agent-copilot-ui-reference-input/);
  assert.match(copilot, /agent-copilot-ui-reference-hint/);
  assert.match(copilot, /TextInput/);
  assert.match(copilot, /IconLink/);
  assert.doesNotMatch(copilot, /Checkbox/);
  assert.doesNotMatch(copilot, /taskPermissionAutoExecuteToggle/);
  assert.match(copilot, /Task recorder: enabled=.*permission=/);
  assert.match(copilot, /Permission level:/);
  assert.match(copilot, /compact timeline/);
  assert.match(copilot, /Last reviewed artifact/);
  assert.match(copilot, /Scout task reviewer inside ADB Manager/);
  assert.match(copilot, /const kind: EvidenceSessionKind = rawKind === "bug_repro" \? "bug_repro" : "walkthrough"/);
  assert.match(copilot, /rawKind === "checklist" \? "Walkthrough"/);
  assert.doesNotMatch(copilot, /"walkthrough" \| "bug_repro" \| "checklist"/);
  assert.doesNotMatch(copilot, /parseChecklistItems|checklistItemsMissingRequiredEvidence|needs_follow_up/);
  assert.match(copilot, /pendingAttachments/);
  assert.match(copilot, /Current ADB Manager context/);
  assert.match(copilot, /Active evidence record/);
  assert.match(lib, /commands::evidence::export_evidence_package/);
  assert.match(evidenceBackend, /ZipWriter/);
  assert.match(evidenceBackend, /report\.md/);
  assert.match(evidenceBackend, /assets\//);
  assert.match(evidenceBackend, /skipped_assets/);
  assert.match(zh.agent.evidenceKind.walkthrough, /走查/);
  assert.match(zh.agent.evidenceArtifactType.note, /备注/);
  assert.match(zh.agent.evidenceArtifactType.screen_state, /屏幕状态/);
  assert.match(zh.agent.evidenceScreenStateSummary, /页面状态/);
  assert.match(zh.agent.evidenceScreenStateDetails, /详情/);
  assert.match(zh.agent.evidenceArtifactType.agent_note, /Agent 记录/);
  assert.match(zh.agent.scribeIntensity.key_moments, /关键提醒/);
  assert.equal("taskPermissionLabel" in zh.agent, false);
  assert.equal("taskPermission" in zh.agent, false);
  assert.match(zh.agent.uiReferenceUrlLabel, /参考链接/);
  assert.match(zh.agent.targetPackageOptional, /选择包/);
  assert.match(zh.agent.activeTaskContextTitle, /任务信息/);
  assert.match(zh.agent.projectAddressLabel, /项目地址/);
  assert.match(zh.agent.activeTaskContextNotSet, /未提供/);
  assert.match(zh.agent.activeTaskContextInheritedPrefix, /CLI 默认/);
  assert.match(zh.agent.targetPackageInfer, /Agent.*判断/);
  assert.match(zh.agent.uiReferenceUrlPlaceholder, /Figma/);
  assert.match(zh.agent.uiReferenceFigmaMcpHint, /Figma MCP/);
  assert.match(zh.agent.uiReferenceFeishuCliHint, /lark-cli/);
  assert.match(zh.agent.evidenceQaReport, /QA 走查报告/);
  assert.match(zh.agent.evidenceOpenLocation, /打开位置/);
  assert.match(zh.agent.evidencePreviewLoading, /截图预览/);
  assert.match(zh.agent.evidenceOpenImagePreview, /预览图片/);
  assert.match(zh.agent.evidenceImagePreviewTitle, /图片预览/);
  assert.match(zh.agent.evidencePackageExported, /证据包已导出/);
  assert.equal("evidenceEnd" in zh.agent, false);
  assert.equal("evidenceExported" in zh.agent, false);
  assert.match(en.agent.evidenceKind.bug_repro, /Bug/);
  assert.match(zh.agent.evidenceHistoryTitle.walkthrough, /走查记录/);
  assert.match(zh.agent.evidenceHistoryTitle.bug_repro, /复现记录/);
  assert.match(en.agent.evidenceHistoryTitle.walkthrough, /Walkthrough records/);
  assert.match(en.agent.evidenceHistoryTitle.bug_repro, /Repro records/);
  assert.match(en.agent.uiReferenceUrlLabel, /Reference link/);
  assert.match(en.agent.activeTaskContextTitle, /Task context/);
  assert.match(en.agent.projectAddressLabel, /Project path/);
  assert.match(en.agent.activeTaskContextNotSet, /Not provided/);
  assert.match(en.agent.activeTaskContextInheritedPrefix, /CLI default/);
  assert.match(en.agent.targetPackageOptional, /Select package/);
  assert.match(en.agent.targetPackageInfer, /Agent.*infer/i);
  assert.match(en.agent.uiReferenceUrlPlaceholder, /Feishu\/Lark/);
  assert.match(en.agent.uiReferenceFigmaMcpHint, /Figma MCP/);
  assert.match(en.agent.uiReferenceFeishuCliHint, /lark-cli/);
  assert.match(en.agent.evidenceCopyPath, /Copy path/);
  assert.match(en.agent.evidenceOpenImagePreview, /Preview image/);
  assert.match(en.agent.evidenceImagePreviewTitle, /Image preview/);
  assert.match(en.agent.scribeIntensity.live, /Live/);
  assert.equal("taskPermission" in en.agent, false);
  assert.match(en.agent.toolEvidenceRecord, /active evidence record/);
  assert.match(en.agent.evidencePackageExported, /Evidence package exported/);
  assert.equal("evidenceEnd" in en.agent, false);
  assert.equal("evidenceExported" in en.agent, false);
  assert.equal("evidenceActiveStatus" in zh.agent, false);
  assert.equal("evidenceTimelineTitle" in zh.agent, false);
  assert.equal("evidenceSessionMeta" in zh.agent, false);
  assert.equal("scribeNextAction" in zh.agent, false);
  assert.equal("evidenceActiveStatus" in en.agent, false);
  assert.equal("evidenceTimelineTitle" in en.agent, false);
  assert.equal("evidenceSessionMeta" in en.agent, false);
  assert.equal("scribeNextAction" in en.agent, false);
  assert.match(zh.agent.evidenceIssueLogcat, /Logcat/);
  assert.equal("checklist" in zh.agent.evidenceKind, false);
  assert.equal("checklistStatus" in zh.agent, false);
  assert.equal("evidenceChecklistMissingNotes" in en.agent, false);
});

test("android device copilot separates chat, walkthrough, and bug repro modes", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /type CopilotMode = "chat" \| "walkthrough" \| "bug_repro"/);
  assert.match(copilot, /function evidenceKindForCopilotMode/);
  assert.match(copilot, /function copilotModeForEvidenceKind/);
  assert.match(copilot, /requestedMode\?: CopilotMode/);
  assert.match(copilot, /modeRequestId\?: number/);
  assert.match(copilot, /requestedMode = "walkthrough"/);
  assert.match(copilot, /const \[copilotMode, setCopilotMode\] = useState<CopilotMode>\(requestedMode\)/);
  assert.match(copilot, /useEffect\(\(\) => \{\s*setCopilotMode\(requestedMode\);\s*\}, \[requestedMode, modeRequestId\]\)/);
  assert.match(copilot, /const visibleEvidenceKind = evidenceKindForCopilotMode\(copilotMode\) \?\? "walkthrough"/);
  assert.match(copilot, /const activeEvidenceSessionForDevice = useMemo/);
  assert.match(copilot, /const activeEvidenceSessionForPrompt = copilotMode === "chat" \? activeEvidenceSessionForDevice : activeEvidenceSession/);
  assert.match(copilot, /const \[selectedEvidenceHistoryIds, setSelectedEvidenceHistoryIds\] = useState/);
  assert.match(copilot, /const NEW_EVIDENCE_DRAFT_ID = "__new_evidence_draft__"/);
  assert.match(copilot, /const newEvidenceDraftSelected\s*=\s*selectedEvidenceHistoryIds\[visibleEvidenceKind\] === NEW_EVIDENCE_DRAFT_ID/);
  assert.match(copilot, /const selectedEvidenceHistorySession = useMemo/);
  assert.match(copilot, /if \(selectedId === NEW_EVIDENCE_DRAFT_ID\) return null/);
  assert.match(copilot, /const selectEvidenceHistorySession = useCallback/);
  assert.match(copilot, /const startNewWorkspaceItem = useCallback/);
  assert.match(copilot, /copilotMode === "chat"[\s\S]*await createSession\(recommendedSkill\)/);
  assert.match(copilot, /\[kind\]: NEW_EVIDENCE_DRAFT_ID/);
  assert.match(copilot, /const newWorkspaceItemLabel =/);
  assert.match(copilot, /aria-label=\{newWorkspaceItemLabel\}/);
  assert.match(copilot, /onClick=\{\(\) => void startNewWorkspaceItem\(\)\}/);
  assert.doesNotMatch(copilot, /onClick=\{\(\) => void createSession\(recommendedSkill\)\}/);
  assert.doesNotMatch(copilot, /className="agent-copilot-mode-switch"/);
  assert.match(copilot, /agent\.workspaceTaskChatTitle/);
  assert.match(copilot, /agent\.workspaceTaskWalkthroughTitle/);
  assert.match(copilot, /agent\.workspaceTaskBugReproTitle/);
  assert.match(copilot, /mode: "chat"/);
  assert.match(copilot, /mode: "walkthrough"/);
  assert.match(copilot, /mode: "bug_repro"/);
  assert.match(copilot, /onClick=\{\(\) => setCopilotMode\(option\.mode\)\}/);
  assert.match(copilot, /handleTaskTabKeyDown/);
  assert.match(copilot, /role="tabpanel"/);
  assert.doesNotMatch(copilot, /copilotModeSwitch/);
  assert.doesNotMatch(copilot, /className="agent-copilot-runtime-section"/);
  assert.match(copilot, /const chatConversationPanel =/);
  assert.match(copilot, /const scribePanel =/);
  assert.match(copilot, /const chatComposer =/);
  assert.match(copilot, /const scribeFooter =/);
  assert.match(copilot, /const activeEvidenceGoalPanel =/);
  assert.match(copilot, /const activeTaskContextPanel = activeEvidenceSession \?/);
  assert.match(copilot, /activeTaskContextPanel \|\| activeTaskConversationMessages\.length/);
  assert.match(copilot, /function AgentTaskContextField/);
  assert.match(copilot, /agent\.projectAddressLabel/);
  assert.match(copilot, /visibleMessages\.map/);
  assert.doesNotMatch(copilot, /activeMessages\.map/);
  assert.match(copilot, /agent-copilot-goal-panel/);
  assert.match(copilot, /agent-copilot-goal-panel--compact/);
  assert.match(copilot, /agent-copilot-runbar-goal/);
  assert.match(copilot, /agent-copilot-start-console/);
  assert.doesNotMatch(copilot, /agent-copilot-automatic-notice/);
  assert.doesNotMatch(copilot, /agent\.automaticExecutionNotice/);
  assert.doesNotMatch(copilot, /agent\.taskStartSectionTitle/);
  assert.doesNotMatch(copilot, /agent-copilot-start-console__hint/);
  assert.doesNotMatch(copilot, /agent-copilot-runbar-section--evidence/);
  assert.doesNotMatch(copilot, /agent-copilot-runbar-section--report/);
  assert.doesNotMatch(copilot, /agent-copilot-scribe-summary/);
  assert.match(copilot, /copilotMode === "chat" \? chatConversationPanel : scribePanel/);
  assert.match(copilot, /copilotMode === "chat" \? chatComposer : scribeFooter/);
  assert.match(copilot, /newEvidenceDraftSelected \?/);
  assert.match(copilot, /className="agent-copilot-mode-body"/);
  assert.match(copilot, /className="agent-copilot-mode-footer"/);
  assert.match(copilot, /<EvidenceTaskHistoryList[\s\S]*sessions=\{recentEvidenceSessions\}[\s\S]*kind=\{visibleEvidenceKind\}/);
  assert.match(copilot, /function EvidenceTaskHistoryList/);
  assert.match(copilot, /onSelect\(session\)/);
  assert.doesNotMatch(copilot, /<Button size="compact-xs" variant="subtle" onClick=\{\(\) => setCopilotMode\("chat"\)\}>/);
  const evidenceTaskHistoryListBlock = copilot.slice(copilot.indexOf("function EvidenceTaskHistoryList"), copilot.indexOf("function EvidenceRecordTimeline"));
  assert.doesNotMatch(evidenceTaskHistoryListBlock, /evidenceArtifactCount", \{ count: sessions\.length \}/);
  const goalPanelRenderIndex = copilot.indexOf("{activeEvidenceGoalPanel}");
  assert.ok(goalPanelRenderIndex >= 0);
  assert.ok(goalPanelRenderIndex > copilot.indexOf("const scribePanel ="));
  assert.ok(goalPanelRenderIndex < copilot.indexOf("const scribeFooter ="));
  const conversationPanelBlock = copilot.slice(copilot.indexOf("const conversationPanel ="), copilot.indexOf("const runtimeProbeModal ="));
  assert.doesNotMatch(conversationPanelBlock, /\{activeEvidenceGoalPanel\}/);
  assert.doesNotMatch(conversationPanelBlock, /scribeActiveStrip/);
  assert.doesNotMatch(conversationPanelBlock, /agent-copilot-context-strip/);
  assert.ok(copilot.indexOf("const scribePanel =") < copilot.indexOf("<EvidenceRecordTimeline"));
  assert.equal("copilotModeChat" in zh.agent, false);
  assert.equal("copilotModeScribe" in zh.agent, false);
  assert.equal("copilotModeWalkthrough" in zh.agent, false);
  assert.equal("copilotModeBugRepro" in zh.agent, false);
  assert.match(zh.agent.scribePanelTitle, /功能走查/);
  assert.match(zh.agent.bugReproPanelTitle, /Bug 复现/);
  assert.match(zh.agent.scribeGoalLabel, /走查目标/);
  assert.match(zh.agent.bugReproGoalLabel, /复现目标/);
  assert.match(zh.agent.evidenceGoalEdit, /编辑/);
  assert.match(zh.agent.evidenceGoalSet, /填写目标/);
  assert.match(zh.agent.newEvidenceDraft, /新建/);
  assert.match(zh.agent.newEvidenceDraftBlocked, /先停止当前/);
  assert.match(zh.agent.evidenceGoalDraftHelper, /任务目标/);
  assert.match(zh.agent.evidenceGoalActiveHelper, /当前证据记录/);
  assert.equal("copilotModeChat" in en.agent, false);
  assert.equal("copilotModeScribe" in en.agent, false);
  assert.equal("copilotModeWalkthrough" in en.agent, false);
  assert.equal("copilotModeBugRepro" in en.agent, false);
  assert.match(en.agent.scribePanelTitle, /Feature Walkthrough/);
  assert.match(en.agent.bugReproPanelTitle, /Bug Repro/);
  assert.match(en.agent.scribeGoalLabel, /Walkthrough goal/);
  assert.match(en.agent.bugReproGoalLabel, /Repro goal/);
  assert.match(en.agent.evidenceGoalEdit, /Edit/);
  assert.match(en.agent.evidenceGoalSet, /Set goal/);
  assert.match(en.agent.newEvidenceDraft, /New/);
  assert.match(en.agent.newEvidenceDraftBlocked, /Stop the current/);
  assert.match(en.agent.evidenceGoalDraftHelper, /task goal/);
  assert.match(en.agent.evidenceGoalActiveHelper, /active evidence record/);
});

test("android device copilot lets each agent mode choose an optional working directory", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(types, /interface AgentCopilotSession[\s\S]*workingDirectory\?: string \| null/);
  assert.match(types, /interface EvidenceSession[\s\S]*workingDirectory\?: string \| null/);
  assert.match(copilot, /type CopilotWorkingDirectoryDrafts = Record<CopilotMode, string>/);
  assert.match(copilot, /const DEFAULT_WORKING_DIRECTORIES/);
  assert.match(copilot, /const \[draftWorkingDirectories, setDraftWorkingDirectories\] = useState<CopilotWorkingDirectoryDrafts>/);
  assert.match(copilot, /function AgentWorkingDirectoryBar/);
  assert.equal((copilot.match(/<AgentWorkingDirectoryBar/g) ?? []).length, 2);
  assert.match(copilot, /workingDirectory=\{explicitWorkingDirectory\}/);
  assert.match(copilot, /fallbackWorkingDirectory=\{fallbackWorkingDirectory\}/);
  assert.match(copilot, /inherited=\{workingDirectoryIsInherited\}/);
  assert.match(copilot, /onSelect=\{\(\) => void selectCurrentWorkingDirectory\(\)\}/);
  assert.match(copilot, /onClear=\{\(\) => void clearCurrentWorkingDirectory\(\)\}/);
  assert.match(copilot, /invoke<string \| null>\("select_directory"\)/);
  assert.match(copilot, /setDraftWorkingDirectories\(\(current\) => \(\{ \.\.\.current, chat: workingDirectory \}\)\)/);
  assert.match(copilot, /setDraftWorkingDirectories\(\(current\) => \(\{ \.\.\.current, \[visibleEvidenceKind\]: workingDirectory \}\)\)/);
  assert.match(copilot, /workingDirectory: normalizeWorkingDirectory\(session\.workingDirectory\) \|\| null/);
  assert.match(copilot, /workingDirectory: normalizeWorkingDirectory\(\(session as \{ workingDirectory\?: unknown \}\)\.workingDirectory\) \|\| null/);
  assert.match(copilot, /workingDirectory: options\?\.workingDirectory \?\? null/);
  assert.match(copilot, /workingDirectory: draftWorkingDirectories\[kind\]/);
  assert.match(copilot, /runAgentCliTurn\(conversationCliProfile, turnPrompt, t, workingDirectory, handleSessionStreamEvent\)/);
  assert.match(copilot, /runAgentCliTurn\(cliProfile, prompt, t, session\.workingDirectory, handleReviewStreamEvent\)/);
  assert.match(copilot, /runAgentCliTurn\(cliProfile, prompt, t, activeEvidenceSessionForPrompt\?\.workingDirectory, handleScribeStreamEvent\)/);
  assert.match(copilot, /const cwd = normalizeWorkingDirectory\(workingDirectory\) \|\| normalizeWorkingDirectory\(cliProfile\.cwd\)/);
  assert.match(copilot, /cwd: cwd \|\| null/);
  assert.match(copilot, /Current working directory/);
  assert.match(copilot, /Working directory: \$\{normalizeWorkingDirectory\(input\.session\.workingDirectory\)/);
  const startGateBlock = copilot.slice(copilot.indexOf("const startTaskGatePreview = evaluateScoutTaskStartGate"), copilot.indexOf("const startTaskBlockedMessage ="));
  assert.doesNotMatch(startGateBlock, /workingDirectory/);
  assert.match(css, /\.agent-copilot-working-directory \{/);
  assert.match(css, /\.agent-copilot-working-directory__path \{[\s\S]*min-width: 0/);
  assert.match(css, /\.agent-copilot-working-directory \.mantine-Button-root/);
  assert.equal(zh.agent.workingDirectoryLabel, "目录");
  assert.equal(zh.agent.workingDirectoryNotSet, "未指定目录");
  assert.match(zh.agent.workingDirectoryInherited, /CLI 默认/);
  assert.equal(en.agent.workingDirectoryLabel, "Directory");
  assert.equal(en.agent.workingDirectoryNotSet, "No directory");
  assert.match(en.agent.workingDirectoryInherited, /CLI default/);
});

test("android device copilot runs Scout tasks automatically and closes them at the Agent terminal outcome", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /const startScribeAgentRun = useCallback/);
  assert.match(copilot, /const ensureAgentApkBeforeTask = useCallback/);
  assert.match(copilot, /const ensureCliRuntimeBeforeTask = useCallback/);
  assert.match(copilot, /isAgentApkUsableForScoutTask/);
  assert.match(copilot, /await refreshAgentApkStatus\(\)/);
  assert.doesNotMatch(copilot, /window\.confirm/);
  assert.doesNotMatch(copilot, /agent\.agentApkTaskGateConfirm/);
  assert.equal("agentApkTaskGateConfirm" in zh.agent, false);
  assert.equal("agentApkTaskGateConfirm" in en.agent, false);
  assert.match(copilot, /buildScribeAgentStartPrompt/);
  assert.match(copilot, /agentActive/);
  assert.match(copilot, /agentStartedAt/);
  assert.match(copilot, /agentStoppedAt/);
  assert.match(copilot, /permissionLevel: "auto_execute"/);
  assert.match(copilot, /const cliRuntimeReady = await ensureCliRuntimeBeforeTask\(\)/);
  assert.match(copilot, /if \(!cliRuntimeReady\) return/);
  assert.match(copilot, /skipInitialReview: true/);
  assert.match(copilot, /if \(!options\?\.skipInitialReview\)/);
  assert.match(copilot, /const prepareWalkthroughTargetSurface = useCallback/);
  assert.match(copilot, /scout_start_preflight/);
  assert.match(copilot, /await prepareWalkthroughTargetSurface\(createdSession\)/);
  assert.match(copilot, /setRuntimeProbeModalOpen\(true\)/);
  assert.match(copilot, /await startScribeAgentRun\(preparedSession\)/);
  assert.match(copilot, /const resolveActiveEvidenceSessionForPrompt = useCallback/);
  assert.match(copilot, /activeEvidenceSessionForPrompt \?\? resolveActiveEvidenceSessionForPrompt\(\)/);
  assert.match(copilot, /decideScoutToolExecution/);
  assert.match(copilot, /executionDecision\.action === "auto_execute"/);
  assert.match(copilot, /evaluateScoutTaskStartGate/);
  assert.match(copilot, /color="blue"/);
  assert.match(copilot, /await closeEvidenceSession\(refreshedEvidenceSession, \{ reportBody: finalMessage \}\)/);
  assert.match(copilot, /activeEvidenceSession \?\? resolveActiveScoutTaskForMode\(evidenceSessionsRef\.current/);
  assert.match(copilot, /activeEvidenceSession && \(activeTaskRunning \|\| activeScribeRunning\)/);
  assert.match(copilot, /activeTaskConversationMessages\.map\(\(message\) => \([\s\S]*showApproval=\{false\}/);
  assert.match(copilot, /showApproval && message\.approval/);
  assert.match(copilot, /agent\.scribeThinking/);
  assert.match(copilot, /agent-copilot-scribe-stream/);
  assert.match(copilot, /agent\.scribeStreamWaiting/);
  assert.match(copilot, /const scribeViewportRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(copilot, /viewportRef=\{scribeViewportRef\}/);
  assert.match(copilot, /latestEvidenceArtifact\?\.id/);
  assert.match(copilot, /AGENT_AUTONOMOUS_TOOL_TURN_LIMIT/);
  assert.match(copilot, /const isAutonomousScoutTask = taskScopedConversation && Boolean\(evidenceSessionForConversation\)/);
  assert.match(copilot, /auto_execute.*?bounded autonomous.*?loop/is);
  assert.match(copilot, /turn < totalTurnLimit/);
  assert.match(copilot, /terminalOnly/);
  assert.match(copilot, /AGENT_TERMINAL_SYNTHESIS_RETRY_LIMIT/);
  assert.match(copilot, /buildAutonomousTerminalFallback/);
  assert.match(copilot, /isScoutTerminalOutcomeResponse/);
  assert.match(copilot, /\$\{terminalOutcomeLabel\}: COMPLETED \| BLOCKED_NEEDS_HUMAN \| FAILED/);
  assert.match(copilot, /older tool results truncated/);
  assert.match(copilot, /const COMPACT_UI_NODE_LIMIT = 20/);
  assert.match(copilot, /nodeCount: snapshot\.nodes\.length/);
  assert.match(copilot, /actionableNodeCount: actionable\.length/);
  assert.match(copilot, /const labeledActionable = actionable\.filter/);
  assert.match(copilot, /\[\.\.\.labeledActionable, \.\.\.actionable, \.\.\.labeled\]/);
  assert.match(copilot, /nodesTruncated: selected\.length < snapshot\.nodes\.length/);
  assert.doesNotMatch(copilot, /nodes: snapshot\.nodes\.slice\(0, 80\)/);
  const conversationPromptBlock = copilot.slice(
    copilot.indexOf("function buildAgentConversationPrompt"),
    copilot.indexOf("function buildEvidenceScribePrompt"),
  );
  assert.match(conversationPromptBlock, /UI snapshots are intentionally compact/);
  assert.match(conversationPromptBlock, /AUTHORITATIVE SCOUT TASK CONTEXT/);
  assert.match(conversationPromptBlock, /never report that the current goal is empty/);
  assert.match(copilot, /function trimAgentConversationPrompt/);
  assert.match(copilot, /middle context truncated; authoritative task context and current task message are preserved/);
  assert.match(copilot, /function suggestAutonomousFallbackToolCall/);
  assert.match(copilot, /safe, reversible target after the Agent returned no tool request/);
  assert.match(copilot, /const visibleLabel = \[node\.text, node\.contentDesc\]/);
  assert.match(copilot, /const resourceSuffix = cleanNodeValue\(node\.resourceId\)\.split\("\/"\)\.pop/);
  assert.match(copilot, /const canResolveToAction = Boolean\(value\.clickable\)/);
  assert.match(copilot, /\|\| Boolean\(text\);/);
  assert.doesNotMatch(copilot, /Boolean\(text\) && !resourceId/);
  assert.doesNotMatch(copilot, /Boolean\(value\.clickable\) \|\| Boolean\(value\.resourceId\) \|\| Boolean\(value\.contentDesc\)/);
  assert.match(copilot, /const visibleTokens = visibleLabel\.split/);
  assert.match(copilot, /const exactVisible = goalTokens\.some\(\(token\) => visibleTokens\.includes\(token\)\)/);
  assert.match(copilot, /sort\(\(left, right\) => right\.score - left\.score\)/);
  assert.match(copilot, /const goalRequestsControl = \/\\b\(selector\|switch\|toggle\|select\|setting\|mode\|view\)\\b\/i\.test\(goal\)/);
  assert.match(copilot, /const controlLike = \/\(mode\|view\|selector\|switch\|toggle\|tab\|radio\)\/i\.test\(resourceSuffix\)/);
  assert.match(copilot, /const directional = \/\(left\|right\|prev\|next\|arrow\|back\)\/i\.test\(resourceSuffix\)/);
  assert.match(copilot, /excludedTargets\.has\(target\)/);
  assert.match(copilot, /autonomousFallbackAttempts >= 3/);
  assert.ok(
    conversationPromptBlock.indexOf('"Tool results already returned:"') <
      conversationPromptBlock.indexOf('"Recent conversation:"'),
    "returned tool results must precede lower-priority conversation history",
  );
  assert.match(copilot, /toolProtectedActionBlocked/);
  assert.match(copilot, /executionDecision\.action === "block"/);
  assert.match(copilot, /isProtectedScoutUiTarget/);
  assert.doesNotMatch(copilot, /If a high-risk action is needed, request approval/);
  assert.match(copilot, /await appendEvidenceArtifact\(evidenceSessionForTool\.id/);
  assert.match(copilot, /const activeEvidenceSession = activeEvidenceSessionForSelectedMode/);
  assert.doesNotMatch(copilot, /setCopilotMode\(copilotModeForEvidenceKind\(activeEvidenceSessionForDevice\.kind\)\)/);
  assert.match(copilot, /runningTask: activeEvidenceSession,/);
  assert.match(copilot, /const activeEvidenceSession = activeEvidenceSessionForSelectedMode/);
  assert.match(copilot, /const startTaskDisabled = runtimeProbeRunning/);
  assert.match(copilot, /read_clipboard_local_paths/);
  assert.match(copilot, /onPaste=\{\(event\) => handleEvidencePathPaste\(event, setEvidenceGoalDraft\)\}/);
  assert.match(copilot, /onPaste=\{\(event\) => handleEvidencePathPaste\(event, setActiveEvidenceGoalDraft\)\}/);
  assert.match(copilot, /onPaste=\{\(event\) => handleEvidencePathPaste\(event, setEvidenceUiReferenceUrlDraft\)\}/);
  assert.doesNotMatch(copilot, /const sendScribePrompt = useCallback/);
  assert.doesNotMatch(copilot, /const handleScribeAgentKeyDown = useCallback/);
  assert.doesNotMatch(copilot, /agent\.scribeAgentSend/);
  assert.match(copilot, /agent-copilot-scribe-scroll/);
  assert.match(copilot, /className="agent-copilot-mode-footer"/);
  assert.match(copilot, /await submitPrompt\(/);
  assert.match(copilot, /await closeEvidenceSession\(refreshedEvidenceSession, \{ reportBody: finalMessage \}\)/);
  const startRunBlock = copilot.slice(copilot.indexOf("const startScribeAgentRun = useCallback"), copilot.indexOf("const startEvidenceFromUi = useCallback"));
  assert.doesNotMatch(startRunBlock, /setCopilotMode\("chat"\)/);
  assert.doesNotMatch(copilot, /const stopScribeAgentRun = useCallback/);
  assert.match(copilot, /fill=\{Boolean\(activeEvidenceSession\)\}/);
  assert.match(copilot, /<EvidenceRecordTimeline[\s\S]*statusBadge=\{[\s\S]*agent\.scoutTaskRunState\.\$\{activeScoutTaskRunState\}[\s\S]*agent\.evidenceArtifactCount/);
  assert.match(copilot, /selectedEvidenceHistorySession \? \([\s\S]*<EvidenceRecordTimeline[\s\S]*session=\{selectedEvidenceHistorySession\}/);
  assert.match(copilot, /const deleteEvidenceHistorySession = useCallback/);
  assert.match(copilot, /onDelete=\{deleteEvidenceHistorySession\}/);
  assert.match(copilot, /className="agent-copilot-evidence-history-delete"/);
  assert.match(copilot, /session\.status !== "active"/);
  assert.match(copilot, /className="agent-copilot-evidence-history-status"/);
  assert.match(css, /\.agent-copilot-evidence-history-status[\s\S]*flex: 0 0 112px/);
  assert.match(css, /\.agent-copilot-evidence-history-delete[\s\S]*opacity: 1/);
  assert.match(copilot, /<EvidenceRecordHistory[\s\S]*sessions=\{recentEvidenceSessions\}[\s\S]*statusBadge=\{[\s\S]*agent\.evidenceIdleStatus/);
  assert.match(copilot, /statusBadge\?: ReactNode/);
  assert.match(copilot, /function EvidenceRecordTimeline[\s\S]*t\(`agent\.evidenceHistoryTitle\.\$\{session\.kind\}`\)[\s\S]*\{statusBadge\}/);
  assert.match(copilot, /<Group gap=\{6\} wrap="nowrap" align="center">[\s\S]*t\(`agent\.evidenceHistoryTitle\.\$\{kind\}`\)[\s\S]*\{statusBadge\}/);
  assert.match(copilot, /copilotMode === "chat" \? \(/);
  assert.match(copilot, /copilotMode === "chat" \? \(\s*<Badge color="gray" variant="light">/);
  assert.match(copilot, /copilotMode === "chat" \? \(\s*<Text size="xs" c="dimmed" lineClamp=\{1\}>[\s\S]*agent\.contextLine/);
  assert.doesNotMatch(copilot, /copilotMode === "chat" \? t\("agent\.conversationBadge"\) : t\(`agent\.evidenceKind\.\$\{visibleEvidenceKind\}`\)/);
  assert.match(copilot, /t\(`agent\.evidenceHistoryTitle\.\$\{kind\}`\)/);
  assert.doesNotMatch(copilot, /\.slice\(0, 3\)/);
  assert.doesNotMatch(copilot, /<Stack gap=\{5\} style=\{\{ maxHeight: dense \? 120 : 180, overflowY: "auto"/);
  const evidenceRecordTimelineBlock = copilot.slice(copilot.indexOf("function EvidenceRecordTimeline"), copilot.indexOf("function EvidenceRecordHistory"));
  const evidenceRecordHistoryBlock = copilot.slice(copilot.indexOf("function EvidenceRecordHistory"), copilot.indexOf("function EvidenceArtifactItem"));
  const evidenceArtifactItemBlock = copilot.slice(copilot.indexOf("function EvidenceArtifactItem"), copilot.indexOf("function EvidenceArtifactImagePreview"));
  assert.doesNotMatch(evidenceRecordTimelineBlock, /overflowY: "auto"/);
  assert.doesNotMatch(evidenceRecordTimelineBlock, /maxHeight: fill \? undefined : dense/);
  assert.doesNotMatch(evidenceRecordHistoryBlock, /overflowY: "auto"/);
  assert.doesNotMatch(evidenceRecordHistoryBlock, /maxHeight: fill \? undefined : dense/);
  assert.doesNotMatch(evidenceArtifactItemBlock, /overflowY: expanded \? undefined : "auto"/);
  assert.doesNotMatch(evidenceArtifactItemBlock, /maxHeight: expanded \? undefined : compact/);
  assert.match(evidenceRecordTimelineBlock, /expanded=\{!dense\}/);
  assert.match(copilot, /expanded \? artifact\.body : trimForPrompt/);
  assert.match(copilot, /<Paper className="agent-copilot-evidence-item" withBorder radius="sm" p="md">/);
  assert.match(copilot, /<AttachmentPreviewCard key=\{attachment\.id\} attachment=\{attachment\} t=\{t\} \/>/);
  const imagePreviewStart = copilot.indexOf("function EvidenceArtifactImagePreview");
  const imagePreviewEnd = copilot.indexOf("function isPreviewableEvidenceImagePath");
  assert.ok(imagePreviewStart >= 0 && imagePreviewEnd > imagePreviewStart);
  const imagePreviewBlock = copilot.slice(imagePreviewStart, imagePreviewEnd);
  assert.match(imagePreviewBlock, /className="agent-copilot-evidence-item"[\s\S]*p="md"[\s\S]*minHeight: previewMaxHeight/);
  assert.match(copilot, /padding: "var\(--space-md\)"/);
  assert.doesNotMatch(copilot, /<Paper className="agent-copilot-evidence-item" withBorder radius="sm" p="xs">/);
  assert.doesNotMatch(copilot, /<Paper key=\{attachment\.id\} className="agent-copilot-evidence-item" withBorder radius="sm" p=\{6\}>/);
  assert.doesNotMatch(imagePreviewBlock, /p="sm"/);
  assert.doesNotMatch(copilot, /padding: 8/);
  assert.match(css, /\.agent-copilot-evidence-session,\n\.agent-copilot-evidence-item \{\n  overflow: hidden;/);
  assert.match(copilot, /const EVIDENCE_IMAGE_PREVIEW_MAX_HEIGHT = 144/);
  assert.match(copilot, /const EVIDENCE_IMAGE_PREVIEW_COMPACT_MAX_HEIGHT = 96/);
  assert.doesNotMatch(copilot, /maxHeight: expanded \? undefined : compact \? 120 : 180/);
  assert.match(copilot, /maxHeight: previewMaxHeight/);
  assert.match(copilot, /fill\?: boolean/);
  assert.match(copilot, /flex: fill \? 1 : undefined/);
  const startButtonIndex = copilot.indexOf("{evidenceModeStartLabel}");
  assert.ok(startButtonIndex >= 0);
  assert.doesNotMatch(copilot, /agent\.automaticExecutionNotice/);
  assert.doesNotMatch(copilot, /taskPermissionAutoExecuteToggle/);
  assert.match(copilot, /agent-copilot-start-console__actions/);
  assert.match(copilot, /agent-copilot-start-action/);
  assert.doesNotMatch(copilot, /agent-copilot-start-console__hint/);
  assert.match(css, /\.agent-copilot-chat-input \.mantine-Textarea-input/);
  assert.match(css, /\.agent-copilot-goal-input \.mantine-Textarea-input/);
  assert.match(css, /\.agent-copilot-ui-reference-input \.mantine-Input-input/);
  assert.match(css, /\.agent-copilot-chat-input \.mantine-Textarea-input,\n\.agent-copilot-goal-input \.mantine-Textarea-input,\n\.agent-copilot-ui-reference-input \.mantine-Input-input \{\n  min-height: 44px;/);
  assert.match(css, /\.agent-copilot-start-console__goal-stack \{/);
  assert.match(css, /\.agent-copilot-ui-reference-hint/);
  assert.match(css, /\.agent-copilot-start-action\.mantine-Button-root \{\n  flex: 0 0 auto;\n  min-width: max-content;\n  height: 44px;/);
  assert.doesNotMatch(css, /\.agent-copilot-automatic-notice/);
  assert.match(copilot, /const startTaskDisabled = runtimeProbeRunning/);
  assert.match(copilot, /disabled=\{startTaskDisabled\}/);
  assert.doesNotMatch(copilot, /agent-copilot-start-console__controls"[^>]+wrap="nowrap"/);
  assert.equal(en.agent.evidenceStartWalkthrough, "Start walkthrough");
  assert.equal(en.agent.evidenceStartBugRepro, "Start repro");
  assert.match(zh.agent.scribeAgentStart, /开始 Agent 走查/);
  assert.match(zh.agent.bugReproAgentStart, /开始 Agent 复现/);
  assert.match(en.agent.scribeAgentStart, /Start Agent walkthrough/);
  assert.match(en.agent.bugReproAgentStart, /Start Agent repro/);
  for (const obsoleteKey of [
    "scribeAgentStop",
    "scribeAgentIdleHint",
    "bugReproAgentIdleHint",
    "scribeAgentActiveHint",
    "bugReproAgentActiveHint",
    "evidenceCaptureScreenshot",
    "evidenceStartRecording",
    "evidenceStopRecording",
    "evidenceMarkIssue",
    "evidenceAddNote",
    "evidenceNotePlaceholder",
    "evidenceNoteHelper",
    "automaticExecutionNotice",
    "automaticProtectionSummary",
  ]) {
    assert.equal(obsoleteKey in zh.agent, false);
    assert.equal(obsoleteKey in en.agent, false);
  }
  assert.equal("scribeAgentSend" in zh.agent, false);
  assert.equal("scribeAgentPromptPlaceholder" in en.agent, false);
});

test("walkthrough thinking reflects a live run instead of persisted task lifecycle state", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const scribePanelBlock = copilot.slice(
    copilot.indexOf("const scribePanel ="),
    copilot.indexOf("const modeFooter ="),
  );
  const startRunBlock = copilot.slice(
    copilot.indexOf("const startScribeAgentRun = useCallback"),
    copilot.indexOf("const stopScribeAgentRun = useCallback"),
  );
  const conversationBlock = copilot.slice(
    copilot.indexOf("const runAgentConversation = useCallback"),
    copilot.indexOf("const submitPrompt = useCallback"),
  );

  assert.doesNotMatch(scribePanelBlock, /activeEvidenceScribe\?\.agentActive/);
  assert.match(startRunBlock, /finally[\s\S]*agentActive: false/);
  assert.match(conversationBlock, /isBlockingSystemUiSnapshot/);
  assert.match(conversationBlock, /attempt <= SCOUT_CRASH_RECOVERY_LIMIT/);
  assert.match(conversationBlock, /planScoutCrashRecoveryAction\(recoverySnapshot\)/);
  assert.match(conversationBlock, /tool: recoveryAction\.tool/);
  assert.match(conversationBlock, /recoverBlockingSystemUi\(initialUiSnapshot\.data, "initial"\)/);
  assert.match(conversationBlock, /recoverBlockingSystemUi\(result\.data, `turn-\$\{turn\}-tool-\$\{index\}`\)/);
  assert.match(conversationBlock, /evidenceCrashRecoveryExhausted/);
  assert.match(conversationBlock, /shouldRecoverScoutEmptyUiSurface/);
  assert.match(conversationBlock, /SCOUT_EMPTY_UI_RECOVERY_LIMIT/);
  assert.match(conversationBlock, /resolveScoutWalkthroughLaunchApp/);
  assert.match(conversationBlock, /recoverEmptyWalkthroughSurface\(initialUiSnapshot\.data, "initial"\)/);
  assert.match(conversationBlock, /recoverEmptyWalkthroughSurface\(result\.data, `turn-\$\{turn\}-tool-\$\{index\}`\)/);
  assert.match(conversationBlock, /recoverEmptySurfaceWithSafeInput/);
  assert.match(conversationBlock, /KEYCODE_WAKEUP/);
  assert.match(conversationBlock, /KEYCODE_BACK/);
  assert.match(conversationBlock, /forcedInspection/);
  assert.match(conversationBlock, /if \(!toolRequest\.calls\.length\)[\s\S]*appendEvidenceArtifact/);
  assert.match(copilot, /safe ADB input fallback/);
  assert.match(copilot, /shell input keyevent/);
  assert.match(conversationBlock, /catch \(error\)[\s\S]*agent-unexpected-failure/);
  assert.match(conversationBlock, /Walkthrough outcome: FAILED/);
});

test("active Scout tasks keep Agent conversation and expose stop plus export as lifecycle actions", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(types, /contextOnly\?: boolean/);
  assert.match(types, /agentSessionId\?: string \| null/);
  assert.match(copilot, /contextOnly: true/);
  assert.match(copilot, /activeTaskAgentSession/);
  assert.match(copilot, /activeTaskConversationMessages/);
  assert.match(copilot, /className="agent-copilot-active-task-conversation"/);
  assert.match(copilot, /const activeTaskContextPanel = activeEvidenceSession \?/);
  assert.match(copilot, /activeTaskContextPanel \|\| activeTaskConversationMessages\.length/);
  assert.match(copilot, /function AgentTaskContextField/);
  assert.match(copilot, /agent\.projectAddressLabel/);
  assert.match(css, /\.agent-copilot-active-task-context__field\.is-empty/);
  assert.match(css, /\.agent-copilot-active-task-context__field\.is-inherited/);
  assert.doesNotMatch(copilot, /className="agent-copilot-active-task-composer"/);
  assert.match(copilot, /activeTaskConversationMessages\.map/);
  assert.match(copilot, /runningSessionIdsRef/);
  assert.match(copilot, /queuedAgentTurnsRef/);
  assert.match(copilot, /liveAgentStreams/);
  assert.match(copilot, /resolveEvidenceSessionForAgentSession/);
  assert.match(copilot, /evidenceSessionOverride/);
  assert.match(types, /scope\?: "chat" \| "scout_task"/);
  assert.match(copilot, /const chatSessions = useMemo/);
  assert.match(copilot, /session\.scope !== "scout_task"/);
  assert.match(copilot, /ready: queueReady/);
  assert.match(copilot, /queuedAgentMessageIdsRef/);
  assert.doesNotMatch(types, /queued\?: boolean/);
  assert.match(copilot, /const sessionDeviceMatches/);
  assert.match(copilot, /taskDeviceChanged/);
  assert.match(copilot, /ensureEvidenceAgentSessionPromisesRef/);
  assert.match(copilot, /const withDeviceMutationLock/);
  assert.match(copilot, /deviceMutationChainsRef/);
  assert.match(copilot, /const taskScopedConversation/);
  assert.match(copilot, /isAutonomousScoutTask \? "auto_execute" : "read_only"/);
  assert.match(copilot, /executionPermission: isAutonomousScoutTask \? "auto_execute" : "read_only"/);
  assert.doesNotMatch(copilot, /evidence\.start_session/);
  assert.match(copilot, /value=\{draft\}/);
  const scribeFooterBlock = copilot.slice(
    copilot.indexOf("const scribeFooter ="),
    copilot.indexOf("const conversationPanel ="),
  );
  assert.match(scribeFooterBlock, /agent\.evidenceExport/);
  assert.match(scribeFooterBlock, /agent\.evidenceStopTask/);
  assert.match(scribeFooterBlock, /stopActiveEvidenceTask/);
  assert.match(copilot, /stoppedEvidenceSessionIdsRef/);
  assert.match(copilot, /artifact\.metadata\?\.taskStoppedByUser === true/);
  assert.doesNotMatch(scribeFooterBlock, /evidenceCaptureScreenshot|evidenceStartRecording|evidenceStopRecording|evidenceMarkIssue|evidenceAddNote|scribeAgentStop/);
  const finalizerStart = copilot.indexOf("const finalizeAgentTurn = async");
  const finalizerBlock = copilot.slice(
    finalizerStart,
    copilot.indexOf("let emptyUiRecoveryAttempts = 0", finalizerStart),
  );
  assert.match(finalizerBlock, /closeEvidenceSession\(refreshedEvidenceSession, \{ reportBody: finalMessage \}\)/);
  assert.match(copilot, /recordAgentRuntimeFailure/);
  assert.match(copilot, /terminalOutcome: "FAILED"/);
  assert.match(copilot, /const currentSession = evidenceSessionsRef\.current\.find/);
  assert.match(copilot, /item\.name/);
  assert.match(copilot, /item\.arguments/);
  assert.match(copilot, /exportEvidenceReport\(selectedEvidenceHistorySession\)/);
  assert.doesNotMatch(copilot, /activeTaskPendingAttachments|activeTaskFileInputRef|submitActiveTaskPrompt/);
  assert.doesNotMatch(css, /\.agent-copilot-active-task-composer/);
  assert.match(zh.agent.activeTaskConversationTitle, /Agent 对话/);
  assert.match(zh.agent.activeTaskConversationPlaceholder, /Agent/);
  assert.match(en.agent.activeTaskConversationTitle, /Agent conversation/);
  assert.match(en.agent.activeTaskConversationPlaceholder, /Agent/);
  assert.equal(zh.agent.evidenceStopTask, "停止任务");
  assert.equal(en.agent.evidenceStopTask, "Stop task");
});

test("feature walkthrough uses a coverage-based review playbook", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const playbook = readFileSync(new URL("../src/scoutTask/featureWalkthroughReview.ts", import.meta.url), "utf8");
  const playbookDoc = readFileSync(
    new URL("../docs/scout-skills/feature-walkthrough-review.md", import.meta.url),
    "utf8",
  );

  assert.equal(
    copilot.match(/featureWalkthroughReviewPromptRules\(input\.session\.kind\)/g)?.length,
    2,
  );
  assert.equal(
    copilot.match(/featureWalkthroughExternalReferenceRules\(input\.session\.kind\)/g)?.length,
    2,
  );
  assert.match(copilot, /kind === "walkthrough" \? EXTERNAL_REFERENCE_WORKFLOW_RULES : \[\]/);
  assert.match(playbook, /kind !== "walkthrough"/);
  assert.match(playbook, /expected vs observed/i);
  assert.match(playbook, /coverage matrix/i);
  assert.match(playbook, /visible UI/i);
  assert.match(playbook, /Do not collect device summaries/i);
  const screenStateBlock = copilot.slice(
    copilot.indexOf("const captureScribeScreenState"),
    copilot.indexOf("const runEvidenceScribeReview"),
  );
  assert.doesNotMatch(screenStateBlock, /performance\.sample|collectPerformanceContextResult/);
  assert.match(copilot, /featureWalkthroughReviewPromptRules\("walkthrough"\)/);
  assert.match(copilot, /if \(!options\.scoutTask\)/);
  assert.match(copilot, /\{ scoutTask: Boolean\(evidenceSessionForConversation\) \}/);
  assert.match(playbook, /severity/i);
  assert.match(playbook, /evidence gaps/i);
  assert.match(playbook, /reference.*access|access.*reference/i);
  assert.match(playbook, /functional.*UX.*visual.*copy.*state.*permission.*performance.*reliability/is);
  assert.match(playbookDoc, /Expected.*Observed.*Evidence.*Severity/is);
  for (const sharedContract of [
    /blocker/i,
    /major/i,
    /minor/i,
    /observation/i,
    /verified facts/i,
    /user-reported actions/i,
    /Scout inference/i,
    /missing evidence.*gap/is,
    /protected actions.*blocked_needs_human/is,
    /zero-node|zero node/i,
  ]) {
    assert.match(playbook, sharedContract);
    assert.match(playbookDoc, sharedContract);
  }
  assert.match(playbookDoc, /does not produce a formal pass\/fail verdict/i);
});

test("image previews are clickable across image surfaces", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const imageCast = readFileSync(new URL("../src/components/ImageCast.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /className="agent-copilot-image-preview-trigger"/);
  assert.match(copilot, /setPreviewOpen\(true\)/);
  assert.match(copilot, /opened=\{previewOpen\}/);
  assert.match(copilot, /isPreviewableEvidenceImagePath/);
  assert.match(imageCast, /className="image-cast-preview-trigger"/);
  assert.match(imageCast, /setPreviewOpen\(true\)/);
  assert.match(imageCast, /title=\{t\("imageCast\.previewTitle"\)\}/);
  assert.match(css, /\.agent-copilot-image-preview-trigger/);
  assert.match(css, /\.image-cast-preview-trigger/);
  assert.match(zh.imageCast.openPreview, /预览图片/);
  assert.match(en.imageCast.openPreview, /Preview image/);
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
  assert.match(catalog, /recommendAndroidAgentSkillCandidate/);
  assert.match(catalog, /return bestScore > 0 \? best : null/);
  assert.match(catalog, /ordinary APK cannot read system GPU counters|SurfaceFlinger/);
});

test("agent chooses skills automatically and supports attachments", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../src-tauri/src/commands/agent_attachment.rs", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /recommendAndroidAgentSkill/);
  assert.doesNotMatch(copilot, /recommendAndroidAgentSkillCandidate|templateSuggestionSkill|skillSummary\(recommendedSkill/);
  assert.match(copilot, /pendingAttachments/);
  assert.match(copilot, /type="file" multiple hidden/);
  assert.match(copilot, /onPaste=\{handleComposerPaste\}/);
  assert.match(copilot, /read_clipboard_agent_attachment_files/);
  assert.match(copilot, /read_agent_attachment_files/);
  assert.match(copilot, /AttachmentPreviewCard/);
  assert.match(copilot, /agent-copilot-attachment-card__thumb/);
  assert.match(copilot, /Modal[\s\S]*opened=\{previewOpen\}/);
  assert.doesNotMatch(copilot, /selectedSkillId/);
  assert.doesNotMatch(copilot, /onChange=\{\(value\) => setSelectedSkillId/);
  assert.match(types, /interface AgentCopilotAttachment/);
  assert.match(types, /attachments\?: AgentCopilotAttachment\[\]/);
  assert.match(types, /previewKind\?: "image"/);
  assert.match(types, /previewDataUrl\?: string/);
  assert.match(backend, /read_clipboard_agent_attachment_files/);
  assert.match(backend, /MAX_IMAGE_PREVIEW_BYTES/);
  assert.match(backend, /read_clipboard_file_paths/);
  assert.equal(zh.agent.openAttachmentPreview, "预览附件：{{name}}");
  assert.equal(en.agent.openAttachmentPreview, "Preview attachment: {{name}}");
});

test("agent cli settings support global defaults while device overrides live in Agent Tasks", () => {
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
  assert.match(copilot, /agent\.cliSettings/);
  assert.match(copilot, /value=\{runtimeReadinessLabel\}/);
  assert.doesNotMatch(copilot, /onOpenSettings/);
});

test("settings discovers safe CLI runtime configuration and keeps direct API providers experimental", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/components/Settings.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const providerSettings = readFileSync(new URL("../src/agentProviderSettings.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/types/index.ts", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const agentCliBackend = readFileSync(new URL("../src-tauri/src/commands/agent_cli.rs", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(types, /type AgentApiProviderKind = "openai_compatible" \| "anthropic_api"/);
  assert.match(types, /interface AgentApiProviderConfig/);
  assert.match(types, /interface AgentProviderSettings/);
  assert.match(types, /agentProviders\?: AgentProviderSettings/);
  assert.match(types, /modelOverride\?: string/);
  assert.match(types, /reasoningEffortOverride\?: string/);
  assert.match(providerSettings, /defaultAgentProviderSettings/);
  assert.match(providerSettings, /normalizeAgentProviderSettings/);
  assert.match(providerSettings, /isAgentApiProviderConfigured/);
  assert.match(providerSettings, /openai_compatible/);
  assert.match(providerSettings, /anthropic_api/);
  assert.match(app, /agentProviders: normalizeAgentProviderSettings/);
  assert.match(settings, /fullScreen/);
  assert.match(settings, /settings\.agentProviderTitle/);
  assert.match(settings, /agent_runtime_discover/);
  assert.match(settings, /settings\.agentRuntimeDetected/);
  assert.match(settings, /settings\.agentRuntimeFollowCli/);
  assert.match(settings, /settings\.agentRuntimeModelOverride/);
  assert.match(settings, /settings\.agentRuntimeReasoningOverride/);
  assert.match(settings, /Autocomplete/);
  assert.match(settings, /modelOptions/);
  assert.match(settings, /reasoningEffortOptions/);
  assert.doesNotMatch(settings, /providerOptions/);
  assert.doesNotMatch(settings, /settings\.agentProviderDefault/);
  assert.match(settings, /settings\.agentProviderApiKey/);
  assert.match(settings, /settings\.agentProviderModel/);
  assert.match(settings, /settings\.agentProviderBaseUrl/);
  assert.match(settings, /PasswordInput/);
  assert.doesNotMatch(copilot, /agentRuntimeProbeOpenedRef/);
  assert.match(copilot, /runAgentRuntimeProbe/);
  assert.match(copilot, /agent\.cliSettings/);
  assert.match(copilot, /loading=\{runtimeProbeRunning\}/);
  assert.match(copilot, /onClick=\{\(\) => void runAgentRuntimeProbe\(\)\}/);
  assert.match(copilot, /const deviceCliOverrideValue =/);
  assert.match(copilot, /const deviceCliOptions = useMemo/);
  assert.doesNotMatch(copilot, /const visible = drawerSurface \? drawerOpen : true/);
  assert.match(copilot, /agent_cli_probe/);
  assert.match(copilot, /AgentRuntimeProbeModal/);
  assert.match(copilot, /agent\.runtimeProbeTitle/);
  assert.match(copilot, /opened=\{runtimeProbeModalOpen\}/);
  assert.match(copilot, /cliValue=\{deviceCliOverrideValue\}/);
  assert.match(copilot, /cliOptions=\{deviceCliOptions\}/);
  assert.match(copilot, /onCliChange=\{updateCurrentDeviceProfile\}/);
  assert.match(copilot, /label=\{t\("agent\.deviceCliOverride"\)\}/);
  assert.match(copilot, /AGENT_RUNTIME_PROBE_MODAL_Z_INDEX = 1200/);
  assert.match(copilot, /zIndex=\{AGENT_RUNTIME_PROBE_MODAL_Z_INDEX\}/);
  assert.doesNotMatch(copilot, /closeOnClickOutside=\{!running\}/);
  assert.doesNotMatch(copilot, /closeOnEscape=\{!running\}/);
  assert.doesNotMatch(copilot, /<Button onClick=\{onClose\} disabled=\{running\}>/);
  assert.match(copilot, /buildAgentRuntimeProbeCliMissingMessage\(String\(error\), t\)/);
  assert.match(lib, /commands::agent_cli::agent_cli_probe/);
  assert.match(lib, /commands::agent_cli::agent_runtime_discover/);
  assert.match(agentCliBackend, /pub async fn agent_cli_probe/);
  assert.match(agentCliBackend, /pub async fn agent_runtime_discover/);
  assert.match(agentCliBackend, /configured_model/);
  assert.match(agentCliBackend, /model_options/);
  assert.match(agentCliBackend, /reasoning_effort_options/);
  assert.match(agentCliBackend, /model_override/);
  assert.match(agentCliBackend, /reasoning_effort_override/);
  assert.match(agentCliBackend, /"--model"/);
  assert.match(agentCliBackend, /"--effort"/);
  assert.match(agentCliBackend, /"debug", "models"/);
  assert.match(agentCliBackend, /model_reasoning_effort/);
  assert.match(agentCliBackend, /Duration::from_secs\(3\)/);
  assert.match(agentCliBackend, /"--version"/);
  assert.match(zh.settings.agentProviderTitle, /Agent 运行方式/);
  assert.match(zh.settings.agentRuntimeDetected, /检测到的本机运行时/);
  assert.match(zh.settings.agentRuntimeFollowCli, /跟随本机 CLI/);
  assert.match(zh.settings.agentProviderApiKey, /API Key/);
  assert.match(zh.agent.runtimeProbeTitle, /检测 Agent 运行环境/);
  assert.match(zh.agent.runtimeProbeAction, /健康检测/);
  assert.match(zh.agent.runtimeProbeCliCommandMissing, /未找到本机 CLI 命令/);
  assert.match(en.settings.agentProviderTitle, /Agent runtime/);
  assert.match(en.settings.agentRuntimeDetected, /Detected local runtimes/);
  assert.match(en.settings.agentRuntimeFollowCli, /Follow local CLI/);
  assert.match(en.settings.agentProviderApiKey, /API Key/);
  assert.match(en.agent.runtimeProbeTitle, /Checking Agent runtime/);
  assert.match(en.agent.runtimeProbeAction, /Health check/);
  assert.match(en.agent.runtimeProbeCliCommandMissing, /local CLI command was not found/);
});

function collectFiles(root: URL): URL[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) {
      files.push(...collectFiles(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}
