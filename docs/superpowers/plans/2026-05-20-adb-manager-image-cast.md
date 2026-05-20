# ADB Manager 图片投屏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ADB Manager 中新增“图片投屏 / Image Cast”，把本地导出的 Figma 参考图推送到 Android 设备并用系统图片查看器打开，用于在封闭固件的大屏设备上快速检查颜色和视觉表现。

**Architecture:** v1 不直接集成 Figma API，只处理用户已经导出的本地图片文件。前端新增独立工具页负责选图、预览、目标路径和操作反馈；Rust 后端新增 ADB 命令模块，负责校验文件、推送、触发媒体扫描、启动系统 VIEW intent。现有“投屏控制 / Screen Mirror”只改展示命名为“远程控制 / Remote Control”，保留底层 `mirror` tab key 和 `ScreenMirror` 组件名以降低改动风险。

**Tech Stack:** Tauri 2, React, TypeScript, Mantine, Tabler Icons, Rust, ADB.

---

## Review Status

This document is for review before implementation. No code should be changed until the plan is approved.

Recommended MVP:
- Rename existing tab text from `投屏控制 / Screen Mirror` to `远程控制 / Remote Control`.
- Add a new tab immediately after Remote Control: `图片投屏 / Image Cast`.
- Let the user pick a local PNG/JPG/WebP file exported from Figma.
- Push the image to the selected Android device.
- Run media scan, then open it with Android's system image viewer through an ADB intent.
- Surface command output and explain when the device has no image viewer capable of handling the intent.

Out of scope for v1:
- Direct Figma OAuth/API integration.
- Automated Figma node export.
- Pixel-perfect color calibration or color-management validation.
- A custom Android viewer app, unless system gallery/viewer support proves unavailable on target firmware.

## Feasibility Assessment

The proposed command flow is feasible on many Android devices:

```bash
adb push ~/figma_ref.png /sdcard/Download/
adb shell am start -a android.intent.action.VIEW -d "file:///sdcard/Download/figma_ref.png" -t image/png
```

But it is not guaranteed on every closed firmware build. The success depends on these device-side capabilities:

- `/sdcard/Download/` or another shared-storage path must be writable through ADB.
- The firmware must include a system Gallery, Photos, file manager, media viewer, or another exported Activity that handles `android.intent.action.VIEW` for `image/png`.
- The viewer must accept a `file://` URI launched by `adb shell am start`. Some Android builds are stricter about file URI handling.
- The current Android user/profile must be able to see the pushed file.

The feature should treat the ADB flow as a best-effort system capability, not as a guaranteed rendering pipeline. If the intent fails, the app should keep the file on device and show the exact ADB error output so the operator can see whether the problem is "no Activity found", permission-related, or storage-related.

## Recommended ADB Flow

Use a slightly more robust sequence than the initial one-liner:

1. Push into an app-specific media folder under shared storage:

```bash
adb -s <serial> shell mkdir -p /sdcard/Pictures/ADBManager
adb -s <serial> push <local_file> /sdcard/Pictures/ADBManager/<safe_name>_<timestamp>.<ext>
```

2. Ask Android media storage to index the new file:

```bash
adb -s <serial> shell am broadcast \
  -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Pictures/ADBManager/<safe_name>_<timestamp>.<ext>
```

3. Open the image through the system viewer:

```bash
adb -s <serial> shell am start \
  -a android.intent.action.VIEW \
  -d file:///sdcard/Pictures/ADBManager/<safe_name>_<timestamp>.<ext> \
  -t image/png
```

Why `/sdcard/Pictures/ADBManager` instead of `/sdcard/Download`:
- Pictures is more likely to be watched by media/gallery apps.
- The app-owned subfolder keeps repeated reference pushes easier to identify and clean.
- Download can still be offered as an advanced option if target firmware handles it better.

Implementation detail: build ADB arguments as an array in Rust through the existing `adb::run_adb` helper. Do not build a shell string with unescaped user input.

## Product Behavior

### Navigation and Naming

Existing tab:
- Current Chinese: `投屏控制`
- New Chinese: `远程控制`
- Current English: `Screen Mirror`
- New English: `Remote Control`

New tab:
- Chinese: `图片投屏`
- English: `Image Cast`
- Placement: immediately after `mirror` in the `TAB_LABELS` object, so it appears after Remote Control in the rail.

Icon intent:
- Remote Control should use the phone + desktop style icon currently used by mirroring (`IconDevicesPc`).
- Screen recording keeps the current recording/video icon.
- Image Cast should use an image/photo upload style icon, for example `IconPhotoUp`, `IconPhotoShare`, or the closest available Tabler icon.

### Image Cast Page

The page should include:

- File picker / drag-and-drop area for PNG, JPG, JPEG, WebP.
- Local preview with image dimensions and file size.
- Destination path display, defaulting to `/sdcard/Pictures/ADBManager`.
- Toggle: `Open after push` enabled by default.
- Toggle: `Run media scan before open` enabled by default.
- Primary action: `Push and Open`.
- Secondary action: `Push Only`.
- Secondary action after successful push: `Open Last Pushed`.
- Result area using the existing result/command-output pattern.

Important UX details:
- Disable actions when no online device is selected.
- Disable actions while a push/open operation is running.
- Preserve the selected file after an operation so the user can retry on another device.
- Use timestamped remote filenames by default to avoid overwriting references during repeated checks.

## Edge Cases

- No selected device: show the same selected-device expectation used by other tools.
- File does not exist or cannot be read: reject before running ADB.
- Unsupported extension: accept only `.png`, `.jpg`, `.jpeg`, `.webp`.
- Filename contains spaces, quotes, Chinese characters, or shell metacharacters: generate a safe ASCII remote filename from the local basename plus timestamp.
- `adb push` succeeds but `am start` fails: report that the file is already on device and show the remote path.
- `am start` returns "No Activity found": explain that the firmware does not expose a compatible system image viewer.
- Media scanner broadcast fails: allow opening anyway, because some viewers can open direct file URIs without media indexing.
- Multiple connected devices: always use the selected device serial when available; otherwise use default ADB behavior only if no selected device exists.

## File Map

Create:
- `src/components/ImageCast.tsx` - React UI for selecting, previewing, pushing, and opening a reference image.
- `src-tauri/src/commands/image_cast.rs` - Rust Tauri commands for image validation, push, media scan, and VIEW intent launch.

Modify:
- `src/types/index.ts` - add `imageCast` to `TabKey`.
- `src/App.tsx` - insert `imageCast` after `mirror` in `TAB_LABELS`, import and render `ImageCast`.
- `src/components/layout/ToolRail.tsx` - add icon mapping for `imageCast`; keep `mirror` using phone + desktop icon.
- `src/locales/zh-CN.json` - rename `tabs.screenMirror`, add `tabs.imageCast`, add `imageCast.*` UI copy.
- `src/locales/en-US.json` - rename `tabs.screenMirror`, add `tabs.imageCast`, add `imageCast.*` UI copy.
- `src-tauri/src/commands/mod.rs` - expose `image_cast`.
- `src-tauri/src/lib.rs` - register new Tauri commands in `invoke_handler`.
- `src-tauri/locales/zh-CN.yml` - add backend image-cast error/success strings.
- `src-tauri/locales/en.yml` - add backend image-cast error/success strings.

No rename required in v1:
- `src/components/ScreenMirror.tsx`
- `src-tauri/src/commands/mirror.rs`
- `mirror` tab key

Keeping these names avoids churn in state tracking and scrcpy command code while still changing user-visible naming.

## Backend Command Contract

Use one combined command for the common workflow, plus one open-only command for retry:

```ts
type ImageCastResult = {
  remote_path: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  pushed: boolean;
  scanned: boolean;
  opened: boolean;
  message: string;
};
```

Tauri commands:

```rust
#[tauri::command(async)]
pub fn adb_push_reference_image(
    app: AppHandle,
    local_path: String,
    device_serial: Option<String>,
    remote_dir: Option<String>,
    open_after_push: bool,
    scan_media: bool,
) -> Result<ImageCastResult, AdbError>
```

```rust
#[tauri::command(async)]
pub fn adb_open_reference_image(
    app: AppHandle,
    remote_path: String,
    mime_type: String,
    device_serial: Option<String>,
    scan_media: bool,
) -> Result<ImageCastResult, AdbError>
```

Validation helpers inside `image_cast.rs`:
- `mime_type_for_path(path: &Path) -> Result<&'static str, AdbError>`
- `safe_remote_filename(path: &Path, timestamp: DateTime<Local>) -> Result<String, AdbError>`
- `validate_remote_dir(remote_dir: Option<String>) -> String`
- `file_uri(remote_path: &str) -> String`

Default remote dir:

```text
/sdcard/Pictures/ADBManager
```

Generated remote filename format:

```text
figma_ref_YYYYMMDD_HHMMSS.<ext>
```

If the local basename is useful after sanitization, use:

```text
<sanitized_basename>_YYYYMMDD_HHMMSS.<ext>
```

## Implementation Tasks

### Task 1: Backend image-cast command module

**Files:**
- Create: `src-tauri/src/commands/image_cast.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/locales/zh-CN.yml`
- Modify: `src-tauri/locales/en.yml`

- [ ] Add `pub mod image_cast;` to `src-tauri/src/commands/mod.rs`.
- [ ] Register `commands::image_cast::adb_push_reference_image` and `commands::image_cast::adb_open_reference_image` in `src-tauri/src/lib.rs`.
- [ ] Implement file validation before running ADB.
- [ ] Run `adb shell mkdir -p <remote_dir>`.
- [ ] Run `adb push <local_path> <remote_path>`.
- [ ] If `scan_media` is true, run `adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://<remote_path>`.
- [ ] If `open_after_push` is true, run `adb shell am start -a android.intent.action.VIEW -d file://<remote_path> -t <mime>`.
- [ ] Add backend locale strings for invalid file, unsupported format, mkdir failure, push failure, scan failure, open failure, and open success.

Expected ADB argument shape:

```rust
adb::run_adb(&app, &["shell", "mkdir", "-p", remote_dir], serial)?;
adb::run_adb(&app, &["push", &local_path, &remote_path], serial)?;
adb::run_adb(
    &app,
    &[
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        &file_uri,
        "-t",
        mime_type,
    ],
    serial,
)?;
```

### Task 2: Frontend Image Cast page

**Files:**
- Create: `src/components/ImageCast.tsx`
- Modify: `src/App.tsx`
- Modify: `src/types/index.ts`
- Modify: `src/components/layout/ToolRail.tsx`

- [ ] Add `imageCast` to `TabKey` after `mirror`.
- [ ] Import `ImageCast` in `src/App.tsx`.
- [ ] Add `imageCast: t("tabs.imageCast")` after `mirror: t("tabs.screenMirror")`.
- [ ] Render `<ImageCast deviceSerial={selectedDevice} />` when `activeTab === "imageCast"`.
- [ ] Add a Tabler photo/upload icon mapping for `imageCast` in `ToolRail`.
- [ ] Implement file selection, preview, push/open toggles, and command result state.
- [ ] Use `invoke<ImageCastResult>("adb_push_reference_image", ...)` and `invoke<ImageCastResult>("adb_open_reference_image", ...)`.

Minimal component state:

```ts
const [selectedPath, setSelectedPath] = useState("");
const [previewUrl, setPreviewUrl] = useState<string | null>(null);
const [remoteDir, setRemoteDir] = useState("/sdcard/Pictures/ADBManager");
const [openAfterPush, setOpenAfterPush] = useState(true);
const [scanMedia, setScanMedia] = useState(true);
const [lastResult, setLastResult] = useState<ImageCastResult | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

### Task 3: Localization and visible naming

**Files:**
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] Change `tabs.screenMirror` in Chinese from `投屏控制` to `远程控制`.
- [ ] Change `tabs.screenMirror` in English from `Screen Mirror` to `Remote Control`.
- [ ] Add `tabs.imageCast`.
- [ ] Add `imageCast` text keys for title, description, file picker, remote path, toggles, buttons, and result states.
- [ ] Keep existing `screenMirror.*` keys unless implementation also updates the visible copy inside `ScreenMirror.tsx`.

Suggested labels:

```json
{
  "tabs": {
    "screenMirror": "远程控制",
    "imageCast": "图片投屏"
  },
  "imageCast": {
    "title": "图片投屏",
    "description": "将本地参考图推送到设备并用系统图片查看器打开",
    "pushAndOpen": "推送并打开",
    "pushOnly": "仅推送",
    "openLast": "打开上次推送图片"
  }
}
```

```json
{
  "tabs": {
    "screenMirror": "Remote Control",
    "imageCast": "Image Cast"
  },
  "imageCast": {
    "title": "Image Cast",
    "description": "Push a local reference image to the device and open it with the system image viewer",
    "pushAndOpen": "Push and Open",
    "pushOnly": "Push Only",
    "openLast": "Open Last Image"
  }
}
```

### Task 4: Tests and verification

**Files:**
- Modify or create tests in `src-tauri/src/commands/image_cast.rs` under `#[cfg(test)]`.

- [ ] Add Rust unit tests for MIME detection:

```rust
assert_eq!(mime_type_for_extension("png").unwrap(), "image/png");
assert_eq!(mime_type_for_extension("jpg").unwrap(), "image/jpeg");
assert_eq!(mime_type_for_extension("jpeg").unwrap(), "image/jpeg");
assert_eq!(mime_type_for_extension("webp").unwrap(), "image/webp");
assert!(mime_type_for_extension("gif").is_err());
```

- [ ] Add Rust unit tests for remote filename sanitization:

```rust
let name = sanitize_basename("Figma ref @ 100%.png");
assert_eq!(name, "Figma_ref_100");
```

- [ ] Add Rust unit tests for remote directory validation:

```rust
assert_eq!(validate_remote_dir(None), "/sdcard/Pictures/ADBManager");
assert_eq!(
    validate_remote_dir(Some("/sdcard/Download".to_string())),
    "/sdcard/Download"
);
```

- [ ] Run:

```bash
npm run build
```

- [ ] Run:

```bash
cd src-tauri && cargo fmt -- --check
```

- [ ] Run:

```bash
cd src-tauri && cargo test
```

- [ ] Run:

```bash
graphify update .
```

Manual verification with a connected target Android device:

- [ ] Select device in ADB Manager.
- [ ] Open Image Cast.
- [ ] Choose a PNG exported from Figma.
- [ ] Click Push and Open.
- [ ] Confirm image opens on the device.
- [ ] Repeat with JPG and WebP if the target firmware supports them.
- [ ] Try a device without compatible gallery/viewer and confirm the app reports the failure clearly.

## Review Decisions Needed

Before implementation, confirm these points:

1. Default device folder: use `/sdcard/Pictures/ADBManager` instead of `/sdcard/Download`.
2. English name: use `Image Cast`.
3. v1 source scope: local exported image only, no direct Figma integration.
4. Remote filenames: timestamped filenames by default, no overwrite.
5. Keep underlying component names `ScreenMirror` and `mirror` in v1 while changing only user-visible text to Remote Control.

Recommended answers are the defaults above.
