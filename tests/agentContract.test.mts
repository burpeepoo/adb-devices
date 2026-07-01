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
  assert.match(toolRail, /IconTestPipe/);
  assert.match(toolRail, /performance: IconGauge/);
  assert.match(toolRail, /packages: IconPackage/);
  assert.match(copilot, /IconTestPipe/);
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

test("android device copilot has a persistent contextual drawer entry", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(app, /copilotDrawerOpen/);
  assert.match(app, /<Drawer/);
  assert.match(app, /position="right"/);
  assert.match(app, /keepMounted/);
  assert.match(app, /<IconRobot/);
  assert.match(app, /surface="drawer"/);
  assert.match(app, /drawerOpen=\{copilotDrawerOpen\}/);
  assert.match(app, /contextLabel=\{TAB_LABELS\[activeTab\]\}/);
  assert.match(copilot, /surface = "workspace"/);
  assert.match(copilot, /drawerSurface/);
  assert.match(copilot, /AgentApkStatusCard/);
  assert.match(copilot, /refreshAgentApkStatus/);
  assert.match(copilot, /installAgentApk/);
  assert.match(copilot, /adb_agent_status/);
  assert.match(copilot, /adb_agent_install/);
  assert.match(copilot, /adb_agent_start/);
  assert.match(copilot, /adb_agent_connect/);
  assert.match(copilot, /agentApkMissingLabel/);
  assert.match(copilot, /agentApkInstallAction/);
  assert.match(copilot, /Current ADB Manager context/);
  assert.match(zh.agent.openCopilot, /Copilot/);
  assert.match(en.agent.openCopilot, /Copilot/);
  assert.match(zh.agent.drawerContext, /当前功能/);
  assert.match(en.agent.drawerContext, /Current feature/);
  assert.match(zh.agent.agentApkMissingDescription, /未安装 Agent APK/);
  assert.match(zh.agent.agentApkInstallAction, /安装并启动/);
  assert.match(en.agent.agentApkMissingDescription, /not installed/);
  assert.match(en.agent.agentApkInstallAction, /Install and start/);
});

test("android device copilot is wired to the Cirrus design system", () => {
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const systemCss = readFileSync(new URL("../src/styles/system.css", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const appShellCss = readFileSync(new URL("../src/components/layout/AppShellLayout.css", import.meta.url), "utf8");
  const toolRailCss = readFileSync(new URL("../src/components/layout/ToolRail.css", import.meta.url), "utf8");

  assert.match(indexCss, /@import "\.\/styles\/system\.css";/);
  assert.equal((indexCss.match(/system\.css/g) ?? []).length, 1);
  assert.match(systemCss, /Cirrus/);
  assert.match(systemCss, /--color-sky: #edf2f7/);
  assert.match(systemCss, /--color-cloud: #ffffff/);
  assert.match(systemCss, /--color-ink: #0e1116/);
  assert.match(systemCss, /--radius-pill: 16px/);
  assert.match(systemCss, /--radius-card: 16px/);
  assert.match(systemCss, /--radius-tile: 10px/);
  assert.match(systemCss, /--radius-xl: 18px/);
  assert.doesNotMatch(systemCss, /--radius-pill: 999px/);
  assert.match(systemCss, /--shadow-tier-1: 0 1px 2px rgba\(14, 17, 22, 0\.06\)/);
  assert.match(systemCss, /0 8px 18px -16px rgba\(14, 17, 22, 0\.22\)/);
  assert.doesNotMatch(systemCss, /0 20px 40px -24px/);
  assert.match(indexCss, /all feature pages inherit the Cirrus system/);
  assert.match(indexCss, /Legacy Tailwind palette bridge/);
  assert.doesNotMatch(systemCss, /letter-spacing: -/);
  assert.match(main, /primaryColor: "ink"/);
  assert.match(main, /fontFamily: "var\(--font-sans\)"/);
  assert.match(main, /fontFamilyMonospace: "var\(--font-sans\)"/);
  assert.match(main, /xl: "16px"/);
  assert.match(appShellCss, /var\(--surface-page\)/);
  assert.match(appShellCss, /var\(--color-horizon\)/);
  assert.match(toolRailCss, /rail-card/);
  assert.match(toolRailCss, /var\(--color-ink\)/);
  assert.match(copilot, /className="agent-copilot-system"/);
  assert.match(copilot, /agent-copilot-card agent-copilot-panel/);
  assert.match(copilot, /agent-copilot-card agent-copilot-session-list/);
  assert.match(copilot, /agent-copilot-title-badge/);
  assert.match(copilot, /agent-copilot-evidence-item/);
  assert.match(copilot, /agent-copilot-message-/);
});

test("workspace UI does not reintroduce the previous blue gray shell styling", () => {
  const srcRoot = new URL("../src/", import.meta.url);
  const files = collectFiles(srcRoot).filter((file) => /\.(css|tsx|ts)$/.test(file.pathname));
  const forbiddenPatterns = [
    /Mossforge/,
    /Manrope/,
    /JetBrains/,
    /#111827/,
    /mantine-color-/,
    /letter-spacing:\s*-/,
    /--tracking-tight:\s*-/,
    /--tracking-snug:\s*-/,
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${file.pathname} should not match ${pattern}`);
    }
  }
  assert.equal(existsSync(new URL("../system.css", import.meta.url)), false);
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

  assert.match(copilot, /agent\.evidencePanelTitle/);
  assert.doesNotMatch(copilot, /evidenceChecklistDraftLabel|evidenceStartChecklist|checklistDraft|parseChecklistItems|updateChecklistStatus/);
  assert.match(zh.agent.evidencePanelTitle, /证据记录/);
  assert.match(zh.agent.evidenceStartWalkthrough, /功能走查/);
  assert.match(zh.agent.evidenceStartBugRepro, /Bug 复现/);
  assert.doesNotMatch(zh.agent.evidenceIdleHint, /清单|Checklist/);
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
  assert.match(types, /interface EvidenceScribeState/);
  assert.match(types, /agentActive\?: boolean/);
  assert.match(types, /agentStartedAt\?: number \| null/);
  assert.match(types, /agentStoppedAt\?: number \| null/);
  assert.match(types, /screen_state/);
  assert.match(types, /agent_note/);
  assert.match(types, /interface EvidenceSession/);
  assert.match(types, /scribe\?: EvidenceScribeState/);
  assert.match(copilot, /createEvidenceSession/);
  assert.match(copilot, /buildDefaultEvidenceScribe/);
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
  assert.match(copilot, /attachRemoteAuditSnapshot/);
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
  assert.doesNotMatch(copilot, /convertFileSrc/);
  assert.match(copilot, /openEvidenceArtifactPath/);
  assert.match(copilot, /scribeIntensityOptions/);
  assert.match(copilot, /SegmentedControl/);
  assert.match(copilot, /Scribe: enabled=/);
  assert.match(copilot, /compact timeline/);
  assert.match(copilot, /Last reviewed artifact/);
  assert.match(copilot, /QA Scribe inside ADB Manager/);
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
  assert.match(zh.agent.evidenceTimelineTitle, /已记录内容/);
  assert.match(zh.agent.evidenceArtifactType.note, /备注/);
  assert.match(zh.agent.evidenceArtifactType.screen_state, /屏幕状态/);
  assert.match(zh.agent.evidenceArtifactType.agent_note, /Agent 记录/);
  assert.match(zh.agent.scribeIntensity.key_moments, /关键提醒/);
  assert.match(zh.agent.evidenceQaReport, /QA 走查报告/);
  assert.match(zh.agent.evidenceOpenLocation, /打开位置/);
  assert.match(zh.agent.evidencePreviewLoading, /截图预览/);
  assert.match(zh.agent.evidencePackageExported, /证据包已导出/);
  assert.equal("evidenceEnd" in zh.agent, false);
  assert.equal("evidenceExported" in zh.agent, false);
  assert.match(en.agent.evidenceKind.bug_repro, /Bug/);
  assert.match(en.agent.evidenceHistoryTitle, /Recent records/);
  assert.match(en.agent.evidenceCopyPath, /Copy path/);
  assert.match(en.agent.scribeIntensity.live, /Live/);
  assert.match(en.agent.toolEvidenceRecord, /active evidence record/);
  assert.match(en.agent.evidencePackageExported, /Evidence package exported/);
  assert.equal("evidenceEnd" in en.agent, false);
  assert.equal("evidenceExported" in en.agent, false);
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
  assert.match(copilot, /const \[copilotMode, setCopilotMode\] = useState<CopilotMode>\("chat"\)/);
  assert.match(copilot, /const visibleEvidenceKind = evidenceKindForCopilotMode\(copilotMode\) \?\? "walkthrough"/);
  assert.match(copilot, /const activeEvidenceSessionForDevice = useMemo/);
  assert.match(copilot, /const activeEvidenceSessionForPrompt = copilotMode === "chat" \? activeEvidenceSessionForDevice : activeEvidenceSession/);
  assert.match(copilot, /className="agent-copilot-mode-switch"/);
  assert.match(copilot, /agent\.copilotModeChat/);
  assert.match(copilot, /agent\.copilotModeWalkthrough/);
  assert.match(copilot, /agent\.copilotModeBugRepro/);
  assert.match(copilot, /const chatConversationPanel =/);
  assert.match(copilot, /const scribePanel =/);
  assert.match(copilot, /const scribeActiveStrip =/);
  assert.match(copilot, /agent\.scribeActiveStrip/);
  assert.match(copilot, /agent\.scribeOpenMode/);
  assert.match(copilot, /setCopilotMode\(copilotModeForEvidenceKind\(kind\)\)/);
  assert.match(copilot, /setCopilotMode\(copilotModeForEvidenceKind\(activeEvidenceSessionForDevice\.kind\)\)/);
  assert.match(copilot, /copilotMode === "chat" \? chatConversationPanel : scribePanel/);
  assert.ok(copilot.indexOf("const scribePanel =") < copilot.indexOf("<EvidenceRecordTimeline"));
  assert.ok(copilot.indexOf("const scribeActiveStrip =") < copilot.indexOf("const chatConversationPanel ="));
  assert.match(zh.agent.copilotModeChat, /对话/);
  assert.match(zh.agent.copilotModeWalkthrough, /走查/);
  assert.match(zh.agent.copilotModeBugRepro, /Bug 复现/);
  assert.match(zh.agent.bugReproPanelTitle, /Bug Repro/);
  assert.match(zh.agent.scribeActiveStrip, /记录中/);
  assert.match(zh.agent.scribeOpenMode, /查看/);
  assert.match(en.agent.copilotModeChat, /Chat/);
  assert.match(en.agent.copilotModeWalkthrough, /Walkthrough/);
  assert.match(en.agent.copilotModeBugRepro, /Bug repro/);
  assert.match(en.agent.bugReproPanelTitle, /Bug Repro/);
  assert.match(en.agent.scribeActiveStrip, /recording/i);
  assert.match(en.agent.scribeOpenMode, /View/);
});

test("android device copilot starts and stops QA scribe agent walkthroughs", () => {
  const copilot = readFileSync(new URL("../src/components/AgentCopilot.tsx", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(copilot, /const startScribeAgentRun = useCallback/);
  assert.match(copilot, /const stopScribeAgentRun = useCallback/);
  assert.match(copilot, /buildScribeAgentStartPrompt/);
  assert.match(copilot, /buildScribeAgentStopPrompt/);
  assert.match(copilot, /agentActive/);
  assert.match(copilot, /agentStartedAt/);
  assert.match(copilot, /agentStoppedAt/);
  assert.match(copilot, /agent\.scribeAgentStart/);
  assert.match(copilot, /agent\.scribeAgentStop/);
  assert.match(copilot, /color="blue"/);
  assert.match(copilot, /color="red"/);
  assert.doesNotMatch(copilot, /const sendScribePrompt = useCallback/);
  assert.doesNotMatch(copilot, /const handleScribeAgentKeyDown = useCallback/);
  assert.doesNotMatch(copilot, /agent\.scribeAgentSend/);
  assert.match(copilot, /className="agent-copilot-scribe-scroll"/);
  assert.match(copilot, /className="agent-copilot-scribe-agent-composer"/);
  assert.match(copilot, /setCopilotMode\("chat"\)/);
  assert.match(copilot, /await submitPrompt\(/);
  assert.match(copilot, /await closeEvidenceSession\(updatedSession \?\? sessionForReport\)/);
  assert.match(copilot, /fill=\{Boolean\(activeEvidenceSession\)\}/);
  assert.match(copilot, /<EvidenceRecordHistory sessions=\{recentEvidenceSessions\} locale=\{i18n\.resolvedLanguage\} dense=\{drawerSurface\} fill t=\{t\} \/>/);
  assert.match(copilot, /fill\?: boolean/);
  assert.match(copilot, /maxHeight: fill \? undefined :/);
  assert.match(copilot, /flex: fill \? 1 : undefined/);
  assert.match(zh.agent.scribeAgentStart, /开始 Agent 走查/);
  assert.match(zh.agent.bugReproAgentStart, /开始 Agent 复现/);
  assert.match(zh.agent.scribeAgentStop, /停止并生成报告/);
  assert.match(zh.agent.scribeAgentIdleHint, /持续保存/);
  assert.match(zh.agent.bugReproAgentIdleHint, /复现记录/);
  assert.match(en.agent.scribeAgentStart, /Start Agent walkthrough/);
  assert.match(en.agent.bugReproAgentStart, /Start Agent repro/);
  assert.match(en.agent.scribeAgentStop, /Stop and report/);
  assert.match(en.agent.scribeAgentActiveHint, /QA report/);
  assert.match(en.agent.bugReproAgentActiveHint, /repro report/);
  assert.equal("scribeAgentSend" in zh.agent, false);
  assert.equal("scribeAgentPromptPlaceholder" in en.agent, false);
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

test("agent runtime providers are configured in full settings and probed from copilot health check", () => {
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
  assert.match(copilot, /agent\.runtimeProbeAction/);
  assert.match(copilot, /loading=\{runtimeProbeRunning\}/);
  assert.match(copilot, /onClick=\{\(\) => void runAgentRuntimeProbe\(\)\}/);
  assert.doesNotMatch(copilot, /const visible = drawerSurface \? drawerOpen : true/);
  assert.match(copilot, /agent_cli_probe/);
  assert.match(copilot, /AgentRuntimeProbeModal/);
  assert.match(copilot, /agent\.runtimeProbeTitle/);
  assert.match(copilot, /opened=\{runtimeProbeModalOpen\}/);
  assert.match(lib, /commands::agent_cli::agent_cli_probe/);
  assert.match(agentCliBackend, /pub async fn agent_cli_probe/);
  assert.match(agentCliBackend, /Duration::from_secs\(3\)/);
  assert.match(agentCliBackend, /"--version"/);
  assert.match(zh.settings.agentProviderTitle, /Agent 运行方式/);
  assert.match(zh.settings.agentProviderApiKey, /API Key/);
  assert.match(zh.agent.runtimeProbeTitle, /检测 Agent 运行环境/);
  assert.match(zh.agent.runtimeProbeAction, /健康检测/);
  assert.match(en.settings.agentProviderTitle, /Agent runtime/);
  assert.match(en.settings.agentProviderApiKey, /API Key/);
  assert.match(en.agent.runtimeProbeTitle, /Checking Agent runtime/);
  assert.match(en.agent.runtimeProbeAction, /Health check/);
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
