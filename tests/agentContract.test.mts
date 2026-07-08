import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  assert.match(accessibilityConfig, /android:canRetrieveWindowContent="true"/);
  assert.match(accessibilityConfig, /android:canPerformGestures="true"/);
  assert.match(buildScript, /aapt2" compile/);
  assert.match(buildScript, /RESOURCE_ARGS/);
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
  const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(consoleSource, /device-console-root/);
  assert.match(consoleSource, /deviceConsole\.scoutTasks/);
  assert.match(consoleSource, /deviceConsole\.taskWalkthroughTitle/);
  assert.match(consoleSource, /deviceConsole\.taskBugReproTitle/);
  assert.match(consoleSource, /onSelectTool\("agent"\)/);
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
  assert.match(zh.deviceConsole.taskWalkthroughTitle, /功能走查/);
  assert.match(zh.deviceConsole.taskBugReproTitle, /Bug 复现/);
  assert.match(zh.deviceConsole.workflowTools, /设备工具/);
  assert.match(en.deviceConsole.scoutTasks, /Scout Tasks/);
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
  assert.match(workbench, /adb-workbench-grid/);
  assert.match(workbench, /adb-workbench-library/);
  assert.match(workbench, /adb-workbench-composer/);
  assert.match(workbench, /adb-workbench-output-console/);
  assert.match(workbench, /workbench-risk-pill/);
  assert.match(styles, /\.adb-workbench-root/);
  assert.match(styles, /\.adb-workbench-command-card\.is-active/);
  assert.match(styles, /\.adb-workbench-command-card__main\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(styles, /\.adb-workbench-command-card__desc\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(styles, /\.adb-workbench-command-card__desc\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.workbench-risk-pill\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(styles, /\.adb-workbench-mode-switch/);
  assert.match(styles, /\.workbench-risk-pill--high/);
  assert.match(styles, /\.adb-workbench-textarea\s*\{[\s\S]*border-radius:\s*22px/);
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
  assert.match(copilot, /const visibleMessages = activeMessages\.filter\(\(message\) => message\.role !== "system"\)/);
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
  assert.match(copilot, /evidence\.start_session/);
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
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(storage, /evidenceSessions/);
  assert.match(types, /type EvidenceSessionKind = "walkthrough" \| "bug_repro"/);
  assert.match(types, /type EvidenceScribeIntensity = "quiet" \| "key_moments" \| "live"/);
  assert.match(types, /type ScoutTaskPermissionLevel = "read_only" \| "semi_auto" \| "auto_execute"/);
  assert.match(types, /interface EvidenceScribeState/);
  assert.match(types, /permissionLevel\?: ScoutTaskPermissionLevel/);
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
  assert.match(copilot, /captureEvidenceScreenshot/);
  assert.match(copilot, /startEvidenceRecording/);
  assert.match(copilot, /stopEvidenceRecording/);
  assert.match(copilot, /markEvidenceIssue/);
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
  assert.match(copilot, /Checkbox/);
  assert.match(copilot, /taskPermissionAutoExecuteToggle/);
  assert.match(copilot, /Task recorder: enabled=.*permission=/);
  assert.match(copilot, /Permission level:/);
  assert.match(copilot, /compact timeline/);
  assert.match(copilot, /Last reviewed artifact/);
  assert.match(copilot, /Scout task reviewer inside ADB Manager/);
  assert.match(copilot, /kind: \\"walkthrough\\" \| \\"bug_repro\\"/);
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
  assert.match(zh.agent.evidenceArtifactType.agent_note, /Agent 记录/);
  assert.match(zh.agent.scribeIntensity.key_moments, /关键提醒/);
  assert.match(zh.agent.taskPermissionLabel, /执行权限/);
  assert.match(zh.agent.taskPermission.read_only, /只读/);
  assert.match(zh.agent.taskPermission.semi_auto, /半自动/);
  assert.match(zh.agent.taskPermission.auto_execute, /自动执行/);
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
  assert.match(en.agent.evidenceCopyPath, /Copy path/);
  assert.match(en.agent.evidenceOpenImagePreview, /Preview image/);
  assert.match(en.agent.evidenceImagePreviewTitle, /Image preview/);
  assert.match(en.agent.scribeIntensity.live, /Live/);
  assert.match(en.agent.taskPermission.semi_auto, /Semi-auto/);
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
  assert.match(en.agent.evidenceStartRecording, /recording/);
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
  assert.match(copilot, /const \[copilotMode, setCopilotMode\] = useState<CopilotMode>\("walkthrough"\)/);
  assert.match(copilot, /const visibleEvidenceKind = evidenceKindForCopilotMode\(copilotMode\) \?\? "walkthrough"/);
  assert.match(copilot, /const activeEvidenceSessionForDevice = useMemo/);
  assert.match(copilot, /const activeEvidenceSessionForPrompt = copilotMode === "chat" \? activeEvidenceSessionForDevice : activeEvidenceSession/);
  assert.match(copilot, /const \[selectedEvidenceHistoryIds, setSelectedEvidenceHistoryIds\] = useState/);
  assert.match(copilot, /const selectedEvidenceHistorySession = useMemo/);
  assert.match(copilot, /const selectEvidenceHistorySession = useCallback/);
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
  assert.match(copilot, /visibleMessages\.map/);
  assert.doesNotMatch(copilot, /activeMessages\.map/);
  assert.match(copilot, /agent-copilot-goal-panel/);
  assert.match(copilot, /agent-copilot-goal-panel--compact/);
  assert.match(copilot, /agent-copilot-runbar-goal/);
  assert.match(copilot, /agent-copilot-start-console/);
  assert.match(copilot, /agent-copilot-auto-execute-shell/);
  assert.match(copilot, /agent\.taskPermissionAutoExecuteHint/);
  assert.match(copilot, /agent-copilot-runbar-section--evidence/);
  assert.match(copilot, /agent-copilot-runbar-section--report/);
  assert.doesNotMatch(copilot, /agent-copilot-scribe-summary/);
  assert.match(copilot, /copilotMode === "chat" \? chatConversationPanel : scribePanel/);
  assert.match(copilot, /copilotMode === "chat" \? chatComposer : scribeFooter/);
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
  assert.equal((copilot.match(/<AgentWorkingDirectoryBar/g) ?? []).length, 3);
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
  assert.match(copilot, /runAgentCliTurn\(cliProfile, firstPrompt, t, workingDirectory\)/);
  assert.match(copilot, /runAgentCliTurn\(cliProfile, secondPrompt, t, workingDirectory\)/);
  assert.match(copilot, /runAgentCliTurn\(cliProfile, prompt, t, session\.workingDirectory\)/);
  assert.match(copilot, /runAgentCliTurn\(cliProfile, prompt, t, activeEvidenceSessionForPrompt\?\.workingDirectory\)/);
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

test("android device copilot starts and stops walkthrough agent tasks", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /const startScribeAgentRun = useCallback/);
  assert.match(copilot, /const stopScribeAgentRun = useCallback/);
  assert.match(copilot, /const ensureAgentApkBeforeTask = useCallback/);
  assert.match(copilot, /const ensureCliRuntimeBeforeTask = useCallback/);
  assert.match(copilot, /const startActiveScribeAgentFromUi = useCallback/);
  assert.match(copilot, /Checkbox/);
  assert.match(copilot, /isAgentApkUsableForScoutTask/);
  assert.match(copilot, /await refreshAgentApkStatus\(\)/);
  assert.match(copilot, /window\.confirm/);
  assert.match(copilot, /agent\.agentApkTaskGateConfirm/);
  assert.match(copilot, /buildScribeAgentStartPrompt/);
  assert.match(copilot, /buildScribeAgentStopPrompt/);
  assert.match(copilot, /agentActive/);
  assert.match(copilot, /agentStartedAt/);
  assert.match(copilot, /agentStoppedAt/);
  assert.match(copilot, /agent\.scribeAgentStart/);
  assert.match(copilot, /agent\.scribeAgentStop/);
  assert.match(copilot, /agent\.taskPermissionAutoExecuteToggle/);
  assert.match(copilot, /evidencePermissionDraft === "auto_execute"/);
  assert.match(copilot, /const cliRuntimeReady = await ensureCliRuntimeBeforeTask\(\)/);
  assert.match(copilot, /if \(!cliRuntimeReady\) return/);
  assert.match(copilot, /setRuntimeProbeModalOpen\(true\)/);
  assert.match(copilot, /await startScribeAgentRun\(createdSession\)/);
  assert.match(copilot, /const resolveActiveEvidenceSessionForPrompt = useCallback/);
  assert.match(copilot, /activeEvidenceSessionForPrompt \?\? resolveActiveEvidenceSessionForPrompt\(\)/);
  assert.match(copilot, /decideScoutToolExecution/);
  assert.match(copilot, /executionDecision\.action === "auto_execute"/);
  assert.match(copilot, /evaluateScoutTaskStartGate/);
  assert.match(copilot, /color="blue"/);
  assert.match(copilot, /color="red"/);
  assert.match(copilot, /disabled=\{running \|\| scribeRunning \|\| runtimeProbeRunning \|\| !cliConfigured\}/);
  assert.doesNotMatch(copilot, /const sendScribePrompt = useCallback/);
  assert.doesNotMatch(copilot, /const handleScribeAgentKeyDown = useCallback/);
  assert.doesNotMatch(copilot, /agent\.scribeAgentSend/);
  assert.match(copilot, /agent-copilot-scribe-scroll/);
  assert.match(copilot, /className="agent-copilot-mode-footer"/);
  assert.match(copilot, /await submitPrompt\(/);
  assert.match(copilot, /await closeEvidenceSession\(updatedSession \?\? sessionForReport\)/);
  const startRunBlock = copilot.slice(copilot.indexOf("const startScribeAgentRun = useCallback"), copilot.indexOf("const stopScribeAgentRun = useCallback"));
  const stopRunBlock = copilot.slice(copilot.indexOf("const stopScribeAgentRun = useCallback"), copilot.indexOf("const handleSuggestedPrompt = useCallback"));
  assert.doesNotMatch(startRunBlock, /setCopilotMode\("chat"\)/);
  assert.doesNotMatch(stopRunBlock, /setCopilotMode\("chat"\)/);
  assert.match(copilot, /fill=\{Boolean\(activeEvidenceSession\)\}/);
  assert.match(copilot, /<EvidenceRecordTimeline[\s\S]*statusBadge=\{[\s\S]*agent\.scoutTaskRunState\.\$\{activeScoutTaskRunState\}[\s\S]*agent\.evidenceArtifactCount[\s\S]*agent\.taskPermission/);
  assert.match(copilot, /selectedEvidenceHistorySession \? \([\s\S]*<EvidenceRecordTimeline[\s\S]*session=\{selectedEvidenceHistorySession\}/);
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
  assert.match(copilot, /<Paper key=\{attachment\.id\} className="agent-copilot-evidence-item" withBorder radius="sm" p="md">/);
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
  const autoExecuteIndex = copilot.indexOf('label={t("agent.taskPermissionAutoExecuteToggle")}', startButtonIndex);
  assert.ok(startButtonIndex >= 0);
  assert.ok(autoExecuteIndex > startButtonIndex);
  assert.match(copilot, /agent-copilot-start-console__actions/);
  assert.match(copilot, /agent-copilot-start-action/);
  assert.match(copilot, /agent-copilot-start-console__hint/);
  assert.match(copilot, /const startTaskGatePreview = evaluateScoutTaskStartGate/);
  assert.match(copilot, /const startTaskBlockedMessage = startTaskGatePreview\.ok \? null : scoutTaskGateMessage/);
  assert.match(copilot, /const startTaskDisabled = Boolean\(startTaskBlockedMessage\) \|\| running \|\| scribeRunning \|\| runtimeProbeRunning/);
  assert.match(copilot, /disabled=\{startTaskDisabled\}/);
  assert.doesNotMatch(copilot, /agent-copilot-start-console__controls"[^>]+wrap="nowrap"/);
  assert.equal(en.agent.evidenceStartWalkthrough, "Start walkthrough");
  assert.equal(en.agent.evidenceStartBugRepro, "Start repro");
  assert.match(zh.agent.scribeAgentStart, /开始 Agent 走查/);
  assert.match(zh.agent.bugReproAgentStart, /开始 Agent 复现/);
  assert.match(zh.agent.scribeAgentStop, /停止并生成报告/);
  assert.match(zh.agent.taskPermissionAutoExecuteToggle, /自动执行/);
  assert.match(zh.agent.scribeAgentIdleHint, /持续保存/);
  assert.match(zh.agent.bugReproAgentIdleHint, /复现记录/);
  assert.match(zh.agent.agentApkTaskGateConfirm, /是否继续/);
  assert.match(en.agent.scribeAgentStart, /Start Agent walkthrough/);
  assert.match(en.agent.bugReproAgentStart, /Start Agent repro/);
  assert.match(en.agent.scribeAgentStop, /Stop and report/);
  assert.match(en.agent.taskPermissionAutoExecuteToggle, /Auto-execute/);
  assert.match(en.agent.scribeAgentActiveHint, /QA report/);
  assert.match(en.agent.bugReproAgentActiveHint, /repro report/);
  assert.match(en.agent.agentApkTaskGateConfirm, /Continue starting/);
  assert.equal("scribeAgentSend" in zh.agent, false);
  assert.equal("scribeAgentPromptPlaceholder" in en.agent, false);
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

  assert.match(copilot, /recommendAndroidAgentSkill/);
  assert.doesNotMatch(copilot, /recommendAndroidAgentSkillCandidate|templateSuggestionSkill|skillSummary\(recommendedSkill/);
  assert.match(copilot, /pendingAttachments/);
  assert.match(copilot, /type="file" multiple hidden/);
  assert.doesNotMatch(copilot, /selectedSkillId/);
  assert.doesNotMatch(copilot, /onChange=\{\(value\) => setSelectedSkillId/);
  assert.match(types, /interface AgentCopilotAttachment/);
  assert.match(types, /attachments\?: AgentCopilotAttachment\[\]/);
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

test("agent runtime providers are configured in full settings and probed from Scout health check", () => {
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
  assert.match(providerSettings, /defaultAgentProviderSettings/);
  assert.match(providerSettings, /normalizeAgentProviderSettings/);
  assert.match(providerSettings, /isAgentApiProviderConfigured/);
  assert.match(providerSettings, /openai_compatible/);
  assert.match(providerSettings, /anthropic_api/);
  assert.match(app, /agentProviders: normalizeAgentProviderSettings/);
  assert.match(settings, /fullScreen/);
  assert.match(settings, /settings\.agentProviderTitle/);
  assert.match(settings, /settings\.agentProviderDefault/);
  assert.match(settings, /settings\.agentProviderApiKey/);
  assert.match(settings, /settings\.agentProviderModel/);
  assert.match(settings, /settings\.agentProviderBaseUrl/);
  assert.match(settings, /PasswordInput/);
  assert.match(settings, /providerOptions/);
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
  assert.match(agentCliBackend, /pub async fn agent_cli_probe/);
  assert.match(agentCliBackend, /Duration::from_secs\(3\)/);
  assert.match(agentCliBackend, /"--version"/);
  assert.match(zh.settings.agentProviderTitle, /Agent 运行方式/);
  assert.match(zh.settings.agentProviderApiKey, /API Key/);
  assert.match(zh.agent.runtimeProbeTitle, /检测 Agent 运行环境/);
  assert.match(zh.agent.runtimeProbeAction, /健康检测/);
  assert.match(zh.agent.runtimeProbeCliCommandMissing, /未找到本机 CLI 命令/);
  assert.match(en.settings.agentProviderTitle, /Agent runtime/);
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
