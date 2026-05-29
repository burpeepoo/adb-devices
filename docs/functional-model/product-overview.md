# Product Overview

## Product Role

ADB Manager is a desktop Tauri app for local Android/Cozyla device operations. It wraps common ADB workflows into a visual console while still preserving direct command access through an ADB workbench.

The app is optimized for repeated engineering and support workflows:

- Pair and reconnect wireless ADB devices.
- Inspect device status and diagnostics.
- Install APKs and export installed APKs.
- Capture screenshots and recordings.
- Mirror/control the device through scrcpy.
- Push/open reference images on the device.
- Send clipboard text and inspect logcat.
- Package and update the app through signed release artifacts.

## Primary Users

- Cozyla engineers validating firmware/app behavior on physical devices.
- Support or QA users who need repeatable ADB operations without typing every command.
- Release maintainers who package, notarize, publish, and verify the desktop tool.

## Architecture

The app has four main layers:

1. React UI in `src/`
   - Owns layout, tab state, local UI state, i18n, user interaction, and Tauri `invoke` calls.
2. Tauri command layer in `src-tauri/src/commands/`
   - Owns command validation, process lifecycle, OS integration, and ADB/scrcpy orchestration.
3. Shared runtime helpers in `src-tauri/src/adb.rs` and `src-tauri/src/state.rs`
   - Own ADB path resolution, command environment, timeout helpers, serialized process state, and localized errors.
4. External tools and OS services
   - `adb`, `scrcpy`, platform-tools downloads, Homebrew or GitHub release downloads, Finder/Explorer, Tauri updater, GitHub Releases.

## App Shell

`src/App.tsx` is the top-level coordinator.

Startup sequence:

1. Check whether ADB is available through `check_adb_available`.
2. Load settings from Tauri store under `settings`.
3. Resolve default save directory with `get_default_save_dir`.
4. Apply language preference and sync backend locale through `set_locale`.
5. Start device discovery through `useDevices`.
6. Initialize updater through `useAppUpdater`.
7. Register frontend handlers for global screenshot and recording shortcut events.

Navigation:

- The left rail exposes 10 tabs: `pair`, `workbench`, `install`, `screenshot`, `record`, `mirror`, `imageCast`, `clipboard`, `logcat`, `packages`.
- The Settings button opens a modal, not a tab.
- Tabs are lazily mounted and then kept mounted once visited, so long-running tool state is not discarded when switching away.
- The Pair tab is implemented as the device console. It includes the selected device summary, shortcuts to other tools, and an embedded pair/connect panel.
- The Mirror tab combines scrcpy-based interactive mirroring with a selected-device app drawer for launching installed apps.

## Cross-Cutting Principles

Device identity:

- Display identity should prefer `device_sn`, falling back to ADB `serial`.
- Local notes are keyed by `device_sn || serial`, so wireless port changes can still map to the same physical device when SN is available.
- Device history keeps recently seen devices visible as `disconnected`.

ADB command behavior:

- macOS prefers host/system ADB, then SDK ADB, then bundled ADB. This keeps the in-app server closer to the command-line server users repair manually.
- non-macOS prefers bundled ADB, then system ADB, then SDK ADB.
- macOS ADB subprocesses get a terminal-like `PATH`, `LANG`, and home current directory.
- Wireless pair/connect/restart commands are serialized through `AppState.adb_server_operation`.
- ADB restart and wireless repair refresh `adb_known_hosts.pb` while preserving `adbkey` and `adbkey.pub`.

Risk handling:

- The workbench classifies commands as low, medium, or high risk.
- High-risk commands require explicit confirmation before execution.
- Host identity reset is intentionally separated from ordinary ADB restart because it removes `adbkey` and changes this computer's ADB identity.

Persistence:

- Tauri store path: `settings.json`
- Store keys: `settings`, `deviceHistory`, `deviceNotes`, `pairConnect`, `adbStartupRepair`, `workbenchTemplates`, `workbenchHistory`
- Store writes are best-effort in several UI paths so convenience data does not block operations.
- Local image preview goes through a Rust validation command that returns a data URL. Broad `$HOME/**` asset protocol access is not required.

Localization:

- Frontend supports `zh-CN`, `en-US`, and `system` preference.
- Backend locale is synced to `zh-CN` or `en` through `set_locale`.
- Update notes can contain localized sections and are selected by frontend language.

Updates and releases:

- Automatic update checks are enabled by default.
- First silent update check runs 2.5 seconds after startup.
- Repeat automatic checks run every 6 hours while status allows checking.
- The updater feed is GitHub Release `latest.json`; PKG installers are first-install assets, not updater payloads.
