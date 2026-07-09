import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("content surfaces keep a safe inset from rounded borders", () => {
  const remote = source("../src/components/RemoteControl.tsx");
  const performance = source("../src/components/PerformancePanel.tsx");
  const screenshot = source("../src/components/Screenshot.tsx");
  const screenRecord = source("../src/components/ScreenRecord.tsx");
  const pairConnect = source("../src/components/PairConnect.tsx");
  const commandOutput = source("../src/components/common/CommandOutput.tsx");
  const deviceTarget = source("../src/components/common/DeviceTargetBanner.tsx");
  const agent = source("../src/components/AgentCopilot.tsx");
  const appCss = source("../src/index.css");
  const displayCss = source("../src/components/DisplayCalibrationLab.css");
  const logcatCss = source("../src/components/Logcat.css");

  const remoteSummary = remote.slice(remote.indexOf("function RemoteSafetySummaryPanel"));
  assert.match(remoteSummary, /className="remote-safety-summary"/);
  assert.match(remoteSummary, /className="remote-safety-summary__grid"/);
  assert.match(remoteSummary, /className="remote-safety-summary__metric"/);
  assert.doesNotMatch(remoteSummary, /<Paper/);
  assert.doesNotMatch(remoteSummary, /<Badge/);

  assert.match(performance, /<Paper key=\{alert\.key\} withBorder radius="md" p="md" bg="yellow\.0">/);
  assert.match(performance, /function GpuDiagnostics[\s\S]*<Paper withBorder radius="md" p="md">/);
  assert.match(performance, /function TrendCard[\s\S]*<Paper withBorder radius="md" p="md">/);
  assert.doesNotMatch(performance, /<Paper key=\{alert\.key\} withBorder radius="md" p="xs" bg="yellow\.0">/);
  assert.doesNotMatch(performance, /function TrendCard[\s\S]*<Paper withBorder radius="md" p="sm">/);

  assert.match(screenshot, /<Paper withBorder radius="md" p="md" style=\{\{ background: "var\(--surface-sunken\)" \}\}>/);
  assert.match(screenRecord, /<Paper withBorder radius="md" p="md" style=\{\{ background: "var\(--surface-sunken\)" \}\}>/);
  assert.match(componentSlice(pairConnect, "function MdnsRow", "function MdnsNeedsPairRow"), /<Paper withBorder radius="md" p="md">/);
  assert.match(componentSlice(pairConnect, "function ConnectedAdbDeviceRow", "function MdnsPairRow"), /<Paper withBorder radius="md" p="md">/);
  assert.match(componentSlice(pairConnect, "function MdnsPairRow", "function WirelessRecoverySteps"), /<Paper withBorder radius="md" p="md">/);

  assert.match(commandOutput, /component="pre"[\s\S]*p="md"/);
  assert.match(deviceTarget, /px="md"[\s\S]*py="sm"/);
  assert.match(agent, /function RuntimeProbeRow[\s\S]*<Paper withBorder radius="sm" p="md"/);
  assert.match(agent, /className=\{`agent-copilot-message agent-copilot-message-\$\{message\.role\}`\}[\s\S]*p="md"/);

  assert.match(appCss, /\.agent-copilot-goal-panel--compact \{\n  padding: var\(--space-md\);/);
  assert.match(appCss, /\.agent-copilot-start-console__controls \{[\s\S]*padding: var\(--space-sm\);/);
  assert.match(appCss, /\.agent-copilot-runbar-section \{[\s\S]*padding: var\(--space-sm\);/);
  assert.match(appCss, /\.adb-workbench-command-panel \{[\s\S]*padding-top: var\(--space-md\);/);
  assert.match(appCss, /\.adb-workbench-command-preview,\n\.adb-workbench-result-pre,\n\.adb-workbench-result-card__error \{\n  padding: var\(--space-md\);/);
  assert.match(appCss, /\.adb-workbench-output-console__header \{[\s\S]*padding: var\(--space-md\);/);
  assert.match(appCss, /\.adb-workbench-output-console__body \{[\s\S]*padding: var\(--space-md\);/);
  assert.match(appCss, /\.remote-safety-summary__grid \{\n  display: grid;/);
  assert.match(appCss, /\.remote-safety-summary__metric \{\n  min-width: 0;/);
  assert.match(displayCss, /\.display-calibration-metric \{[\s\S]*padding: var\(--space-md\);/);
  assert.match(displayCss, /\.display-calibration-status \{\n  padding: var\(--space-md\);/);
  assert.match(logcatCss, /\.logcat-status \{\n  margin-top: var\(--space-md\);\n  padding: var\(--space-md\);/);
});

function componentSlice(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  assert.ok(end > start, `${endMarker} should appear after ${startMarker}`);
  return source.slice(start, end);
}
