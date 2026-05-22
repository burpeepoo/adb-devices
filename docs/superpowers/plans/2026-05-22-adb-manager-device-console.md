# ADB Manager Device Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-phase Device Console, active-label tool rail, and full-path paste behavior for path-capable Workbench inputs.

**Architecture:** Keep App-level tab and device state in `src/App.tsx`. Add focused UI units for the Device Console and shortcut grid, reuse existing `PairConnect` for connection behavior, and add pure utility functions for tested tab/path logic. Keep tool tabs separate and make console shortcuts switch tabs only.

**Tech Stack:** React 19, TypeScript, Mantine 9, Tauri 2 invoke APIs, Node test runner with `--experimental-strip-types`.

---

### Task 1: Navigation Labels And Tab State

**Files:**
- Modify: `src/tabState.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/ToolRail.tsx`
- Modify: `src/components/layout/AppShellLayout.css`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`
- Test: `tests/tabState.test.mts`

- [ ] **Step 1: Extend the existing tab-state test**

Add assertions to `tests/tabState.test.mts`:

```ts
import { primaryTabKey } from "../src/tabState.ts";

test("pair tab remains the primary device console route", () => {
  assert.equal(primaryTabKey(), "pair");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:tab-state`

Expected: FAIL because `primaryTabKey` is not exported.

- [ ] **Step 3: Add the minimal tab helper**

In `src/tabState.ts`, add:

```ts
export function primaryTabKey(): TabKey {
  return "pair";
}
```

- [ ] **Step 4: Update tab labels**

In both locale files, change `tabs.pairConnect`:

```json
"pairConnect": "Device Console"
```

```json
"pairConnect": "设备控制台"
```

- [ ] **Step 5: Implement active-label rail styling**

Update `ToolRail.tsx` so active tools render a wider button with icon plus text. Inactive tools remain icon-only with tooltip. Keep Settings and GitHub icon-only.

Implementation shape:

```tsx
<button
  type="button"
  className={`tool-rail-item ${active ? "tool-rail-item--active" : ""}`}
  aria-label={tool.label}
  onClick={() => onSelectTool(tool.key)}
>
  <Icon size={20} />
  {active && <span className="tool-rail-item__label">{tool.label}</span>}
</button>
```

Use inline CSS or a component-local CSS file if needed, but keep dimensions stable.

- [ ] **Step 6: Widen the rail**

Update `src/components/layout/AppShellLayout.css`:

```css
.app-shell-layout__body {
  grid-template-columns: 144px 292px minmax(0, 1fr);
}

@media (max-width: 940px) {
  .app-shell-layout__body {
    grid-template-columns: 128px 240px minmax(0, 1fr);
  }
}
```

- [ ] **Step 7: Run the tab test and build**

Run:

```bash
npm run test:tab-state
npm run build
```

Expected: both pass.

### Task 2: Device Console First Phase

**Files:**
- Create: `src/components/DeviceConsole.tsx`
- Create: `src/components/DeviceConsoleShortcuts.tsx`
- Modify: `src/App.tsx`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`

- [ ] **Step 1: Add console locale keys**

Add a `deviceConsole` object to both locale files with:

```json
{
  "title": "Device Console",
  "connectTitle": "Connect a device",
  "connectDesc": "Scan, pair, or manually connect Android wireless debugging devices.",
  "selectedTitle": "Device overview",
  "identity": "Identity",
  "status": "Status",
  "shortcuts": "Quick actions",
  "diagnostics": "Diagnostics",
  "unknown": "Unknown",
  "adbSerial": "ADB serial",
  "deviceSn": "Device SN",
  "model": "Model",
  "product": "Product",
  "connection": "Connection",
  "state": "State",
  "summaryPending": "Detailed status will be added in the next pass."
}
```

Use concise Chinese equivalents in `zh-CN.json`.

- [ ] **Step 2: Create `DeviceConsoleShortcuts.tsx`**

Render shortcut buttons for `install`, `screenshot`, `record`, `mirror`, `imageCast`, `clipboard`, `logcat`, and `packages`. Props:

```ts
interface Props {
  onSelectTool: (tool: TabKey) => void;
}
```

Each button calls `onSelectTool(key)` and uses `toolIcons[key]` plus translated tab labels.

- [ ] **Step 3: Create `DeviceConsole.tsx`**

Props:

```ts
interface Props {
  devices: DeviceInfo[];
  selectedDeviceSerial: string | null;
  onConnected: () => void | Promise<void>;
  onSelectTool: (tool: TabKey) => void;
}
```

Behavior:

- Find selected device by serial.
- If no selected device is found, show a compact connection header and render `<PairConnect devices={devices} onConnected={onConnected} />`.
- If selected device exists, show identity/status cards, shortcut grid, collapsed diagnostics, and a secondary connection section containing `<PairConnect devices={devices} onConnected={onConnected} />`.

- [ ] **Step 4: Wire console into `App.tsx`**

Import `DeviceConsole`. Replace the `pair` branch:

```tsx
if (tab === "pair") {
  return (
    <DeviceConsole
      devices={devices}
      selectedDeviceSerial={selectedDevice}
      onConnected={refresh}
      onSelectTool={handleSelectTab}
    />
  );
}
```

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: PASS.

### Task 3: Full Local Path Paste For Workbench Path Inputs

**Files:**
- Create: `src/pathClipboard.ts`
- Modify: `src/components/AdbWorkbench.tsx`
- Modify: `package.json`
- Test: `tests/pathClipboard.test.mts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/pathClipboard.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractClipboardPaths } from "../src/pathClipboard.ts";

test("extracts full local paths from newline text", () => {
  assert.deepEqual(extractClipboardPaths("/Users/kai/Downloads/app.apk\n"), ["/Users/kai/Downloads/app.apk"]);
});

test("decodes file uri paths without reducing to basename", () => {
  assert.deepEqual(
    extractClipboardPaths("file:///Users/kai/Downloads/My%20Build/app.apk"),
    ["/Users/kai/Downloads/My Build/app.apk"],
  );
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/pathClipboard.test.mts
```

Expected: FAIL because `src/pathClipboard.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/pathClipboard.ts`:

```ts
export function extractClipboardPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .map((line) => {
      if (!line.startsWith("file://")) return line;
      try {
        return decodeURIComponent(new URL(line).pathname);
      } catch {
        return line;
      }
    });
}
```

- [ ] **Step 4: Add test script**

Add to `package.json`:

```json
"test:path-clipboard": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests/pathClipboard.test.mts"
```

- [ ] **Step 5: Wire Workbench paste handling**

In `AdbWorkbench.tsx`, import `extractClipboardPaths`. For path-capable params (`apkPath`, `localPath`, and other local path inputs), add an `onPaste` handler that:

- Reads files from `event.clipboardData.files` and uses each file's full `path` property when available.
- Falls back to `text/uri-list` or `text/plain`.
- Uses the first parsed full path for single-value fields.
- Calls `setParamValue(param.name, parsedPath)` or the existing state updater used by param inputs.

- [ ] **Step 6: Run parser tests and build**

Run:

```bash
npm run test:path-clipboard
npm run build
```

Expected: both pass.

### Task 4: Changelog And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Generated: `graphify-out/GRAPH_REPORT.md`
- Generated: `graphify-out/graph.json`
- Generated: `graphify-out/manifest.json`

- [ ] **Step 1: Update changelog**

Under `## [Unreleased]`, include:

```md
### Added

- Added a first-pass Device Console with selected-device overview and shortcut navigation.
- Added active tab labels in the left tool rail.

### Fixed

- Preserved full local paths when pasting file or folder values into path-capable controls.
```

Keep any existing Unreleased entries and merge headings cleanly.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm run build
npm run test:updater-policy
npm run test:update-notes
npm run test:release-notes
npm run test:tab-state
npm run test:path-clipboard
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo test
cd /Users/kaizhang/Documents/Cozyla/adb_project && graphify update .
```

Expected: all tests pass. Rust may keep pre-existing unused-code warnings; no failures.

- [ ] **Step 3: Review changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only implementation files, tests, changelog, package script, and graphify generated files are modified, plus pre-existing untracked local files remain untracked.
