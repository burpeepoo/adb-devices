import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/PackageList.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/PackageList.css", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/commands/package.rs", import.meta.url), "utf8");
const logcatBackend = readFileSync(new URL("../src-tauri/src/commands/logcat.rs", import.meta.url), "utf8");

test("package list exposes app log collection and output reveal", () => {
  assert.match(source, /adb_detect_package_log_paths/);
  assert.match(source, /adb_pull_package_logs/);
  assert.match(source, /remotePath: path\.trim\(\) \|\| null/);
  assert.match(source, /handleRevealExport\(logsResult\.output_dir\)/);
  assert.match(source, /package-log-dialog/);
  assert.match(source, /<FocusTrap active>/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /restoreLogDialogFocus/);
  assert.match(source, /package-log-path-option/);
  assert.match(source, /automaticPath/);
  assert.match(source, /cozyla-package[\s\S]*app-external[\s\S]*app-media/);
  assert.doesNotMatch(source, /automaticPaths\.length === 1[\s\S]*pullLogs/);
});

test("package list keeps the dense table within its available width", () => {
  assert.match(source, /className="package-list-table"/);
  assert.match(source, /key=\{`\$\{pkg\.device_serial\}:\$\{pkg\.name\}`\}/);
  assert.doesNotMatch(source, /key=\{`[^`]*\$\{index\}/);
  assert.match(source, /<colgroup>/);
  assert.match(css, /table-layout: fixed/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.package-list-actions \{[\s\S]*flex-wrap: wrap/);
});

test("package log backend preserves automatic discovery and manual fallback", () => {
  assert.match(backend, /pub fn adb_detect_package_log_paths/);
  assert.match(backend, /pub fn adb_pull_package_logs/);
  assert.match(backend, /candidate_log_paths/);
  assert.match(backend, /validate_remote_log_path/);
  assert.match(backend, /metadata\.json/);
  assert.match(backend, /logcat\.txt/);
});

test("package log collection accepts a time range and is not limited to the current pid tail", () => {
  assert.match(source, /logcatLookbackSeconds:/);
  assert.match(source, /packageList\.logcatTimeRange/);
  assert.match(backend, /logcat_lookback_seconds/);
  assert.match(backend, /--uid=/);
  assert.match(logcatBackend, /"-T"/);
  assert.doesNotMatch(backend, /"-t",\s*\n\s*"3000"/);
});
