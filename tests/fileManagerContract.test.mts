import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

test("file manager backend commands are registered and keep remote shell data quoted", () => {
  const moduleIndex = read("../src-tauri/src/commands/mod.rs");
  const lib = read("../src-tauri/src/lib.rs");
  const backend = read("../src-tauri/src/commands/file_manager.rs");

  assert.match(moduleIndex, /pub mod file_manager;/);
  for (const command of [
    "adb_file_capabilities",
    "adb_file_cancel_transfer",
    "adb_file_list",
    "adb_file_push",
    "adb_file_pull",
  ]) {
    assert.match(lib, new RegExp(`commands::file_manager::${command}`));
  }
  assert.match(backend, /fn remote_shell_quote/);
  assert.match(backend, /fn build_remote_shell_command/);
  assert.match(backend, /payload\.split\(\|byte\| \*byte == 0\)/);
  assert.match(backend, /set -o pipefail/);
  assert.match(backend, /FM_LIST_FAILED/);
  assert.match(backend, /fn verify_local_commit/);
  assert.match(backend, /current_destination/);
  assert.match(backend, /processed_items: AtomicUsize/);
  assert.match(backend, /host-io-error/);
  assert.doesNotMatch(backend, /Command::new\(/);
  assert.doesNotMatch(backend, /\[\s*"root"\s*\]/);
});

test("file manager UI covers browse, both transfer directions, host paste, conflicts, and stale requests", () => {
  const component = read("../src/components/FileManager.tsx");

  for (const command of [
    "adb_file_capabilities",
    "adb_file_list",
    "adb_file_push",
    "adb_file_pull",
    "read_clipboard_local_paths",
  ]) {
    assert.match(component, new RegExp(`["]${command}["]`));
  }
  assert.match(component, /onDragDropEvent/);
  assert.match(component, /listen<FileTransferProgress>/);
  assert.match(component, /adb_file_cancel_transfer/);
  assert.match(component, /transferId:/);
  assert.match(component, /const listingRequest = useRef\(0\)/);
  assert.match(component, /requestId !== listingRequest\.current \|\| !isCurrentTarget\(expected\)/);
  assert.match(component, /runPendingTransfer\(true/);
  assert.match(component, /selectedConflictKeys/);
  assert.match(component, /FileTransferDrawer/);
  assert.match(component, /FileDetailsDrawer/);
  assert.match(component, /onContextMenu/);
  assert.match(component, /entryQuery/);
  assert.match(component, /entrySort/);
  assert.match(component, /isCopyableDeviceEntry/);
  assert.match(component, /sharedStorageRoot\(capabilities\)/);
  assert.match(component, /requestCapabilities\(snapshot\)\.then/);
  assert.match(component, /fileManager\.pathNavigation/);
  assert.match(component, /file-manager-breadcrumb-controls/);
  assert.match(component, /file-manager-table-path/);
  assert.match(component, /file-manager-quick-row/);
  assert.match(component, /file-manager-path-form/);
  assert.doesNotMatch(component, /file-manager-current-path|fileManager\.(currentPath|locationControls)/);
  assert.doesNotMatch(component, /file-manager-location-details|file-manager-location-chevron/);
  assert.doesNotMatch(component, /adb_file_copy_to_host_clipboard|stageRemotePaths|copyToComputer/);
  assert.doesNotMatch(component, /file-manager-capability/);
  assert.doesNotMatch(component, /fileManager\.(accessDisclaimer|capabilityLoading|shellAccess|rootAccess|androidUser|androidUserUnknown|buildType)/);
  assert.match(component, /issues: batch\.results\.filter/);
  assert.doesNotMatch(component, /ClipboardStageResult|clipboardReady|stagingPrivacy|stagingPath|transferWarnings/);
  assert.match(component, /deviceSerial: expected\.serial/);
  assert.match(component, /target\.status !== ["]ready["] \|\| !target\.serial/);
  assert.match(component, /active/);
});

test("file manager replacement is reviewed in the transfer center", () => {
  const component = read("../src/components/FileManager.tsx");
  const drawer = read("../src/components/FileTransferDrawer.tsx");
  assert.match(component, /openTransferCenter/);
  assert.match(drawer, /Choose exactly which destinations may be replaced/);
  assert.match(drawer, /selectedConflictKeys/);
  assert.match(drawer, /resultItems\.map/);
  assert.match(drawer, /function progressMessage/);
  assert.doesNotMatch(drawer, /progress\?\.message/);
  assert.match(drawer, /processedItems/);
  assert.doesNotMatch(component, /window\.confirm\(/);
});

test("file manager is a persistent selected-device workspace and device-console shortcut", () => {
  const app = read("../src/App.tsx");
  const shortcuts = read("../src/components/DeviceConsoleShortcuts.tsx");
  const consoleSource = read("../src/components/DeviceConsole.tsx");

  assert.match(app, /import FileManager from ["]\.\/components\/FileManager["]/);
  assert.match(app, /key: ["]files["][\s\S]*?groupLabel: t\(["]layout\.navApps["]\)/);
  assert.match(app, /<FileManager deviceTarget=\{deviceTarget\} active=\{activeTab === ["]files["]\} \/>/);
  assert.match(shortcuts, /["]files["]/);
  assert.match(consoleSource, /key: ["]files["]/);
});

test("file manager locale trees stay complete and structurally identical", () => {
  const en = JSON.parse(read("../src/locales/en-US.json"));
  const zh = JSON.parse(read("../src/locales/zh-CN.json"));
  const enKeys = leafKeys(en.fileManager).sort();
  const zhKeys = leafKeys(zh.fileManager).sort();

  assert.equal(en.tabs.fileManager, "Files");
  assert.equal(zh.tabs.fileManager, "文件管理");
  assert.deepEqual(enKeys, zhKeys);
  for (const required of [
    "permissionDenied",
    "pasteFromComputer",
    "exportSelected",
    "replaceConfirm",
    "directoryReplaceWarning",
    "transferCenter",
    "cancelTransfer",
    "details",
    "searchPlaceholder",
    "transferErrors.protocol-error",
    "transferErrors.invalid-local-directory",
    "transferErrors.unsafe-name",
    "transferErrors.unsupported-name-encoding",
    "transferErrors.permission-denied",
    "transferErrors.not-found",
    "transferErrors.not-directory",
    "transferErrors.read-only",
    "transferErrors.no-space",
    "transferErrors.command-failed",
    "transferErrors.adb-error",
    "transferErrors.task-failed",
    "transferErrors.transfer-state-error",
    "quickLocations",
    "directPath",
    "pathNavigation",
  ]) {
    assert.ok(enKeys.includes(required), `missing fileManager.${required}`);
  }
  assert.equal(en.fileManager.currentPath, undefined);
  assert.equal(en.fileManager.locationControls, undefined);
});

test("file manager styling uses Cirrus tokens, responsive layout, and keyboard focus", () => {
  const css = read("../src/components/FileManager.css");

  assert.match(css, /var\(--color-cloud\)/);
  assert.match(css, /var\(--color-edge\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /\.file-manager-workspace \{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.file-manager-browser \{[^}]*flex:\s*1 0 clamp\([^)]*\)[^}]*min-height:\s*clamp\([^)]*\)/);
  assert.match(css, /\.file-manager-table-scroll \{[^}]*overflow:\s*auto/);
  assert.doesNotMatch(css, /\.file-manager-capability/);
  assert.match(css, /\.file-manager-breadcrumb-row \{/);
  assert.match(css, /\.file-manager-breadcrumb-controls \{/);
  assert.match(css, /\.file-manager-table-path \{/);
  assert.doesNotMatch(css, /\.file-manager-current-path|\.file-manager-location-details/);
  assert.doesNotMatch(css, /summary::after[\s\S]*content:\s*["']\+["']/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /font-size:\s*(?:10|11)px/);
  assert.doesNotMatch(css, /font-size:\s*var\(--fs-xxsmall\)/);
});
