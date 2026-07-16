import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/PackageList.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/PackageList.css", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/commands/package.rs", import.meta.url), "utf8");

test("package list exposes app log collection and output reveal", () => {
  assert.match(source, /adb_detect_package_log_paths/);
  assert.match(source, /adb_pull_package_logs/);
  assert.match(source, /remotePath: path\.trim\(\) \|\| null/);
  assert.match(source, /handleRevealExport\(logsResult\.output_dir\)/);
  assert.match(source, /package-log-dialog/);
  assert.match(source, /package-log-path-option/);
  assert.match(source, /automaticPath/);
  assert.match(source, /cozyla-package[\s\S]*app-external[\s\S]*app-media/);
});

test("package list keeps the dense table within its available width", () => {
  assert.match(source, /className="package-list-table"/);
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
