# Product Overview

## Product Role

ADB Manager is a desktop Tauri app for local Android/Cozyla device operations. It wraps common ADB workflows into a visual console while still preserving direct command access through an ADB workbench.

The app is optimized for repeated engineering and support workflows:

- Pair and reconnect wireless ADB devices.
- Inspect device status and diagnostics.
- Install APKs and export installed APKs.
- Capture screenshots and recordings.
- Mirror/control the device through scrcpy.
- Sample app and device performance through ADB-only foreground, process, system, battery, thermal, network, storage, and frame-stat probes.
- Discover and apply display color/PQ parameters from ADB Manager, then export supplier-facing calibration payloads.
- Run Scout-assisted Agent tasks that use typed ADB evidence tools and keep local evidence history.
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

- The left rail exposes 14 tabs: `pair`, `workbench`, `agent`, `install`, `screenshot`, `record`, `mirror`, `remote`, `imageCast`, `clipboard`, `logcat`, `displayCalibration`, `performance`, `packages`.
- The visible rail groups those tabs into primary destinations, capture/control tools, diagnostics, apps/packages, and utilities, with Device Console and Agent Tasks intentionally promoted above the lower-level tools.
- English navigation uses compact rail-only labels for the longest entries (`Devices`, `Remote`, `ADB Tools`, and `Performance`), while page titles and device-console shortcuts keep the full feature names.
- The Settings button opens a modal, not a tab.
- Tabs are lazily mounted and then kept mounted once visited, so long-running tool state is not discarded when switching away.
- The Pair tab is implemented as the device console. It includes the selected device summary, primary Scout task launchers for Feature Walkthrough and Bug Repro, grouped device-tool shortcuts, and an embedded pair/connect panel.
- The Mirror tab combines scrcpy-based local interactive mirroring with a selected-device app drawer for launching installed apps.
- The Remote tab starts an opt-in browser/PWA gateway for phone or second-computer control, with Tailscale-first direct links, role QR sessions, 7-day trusted browsers, experimental HLS video streaming, screenshot/MJPEG fallback viewing, and whitelisted ADB actions.
- The Agent tab is labeled as Agent Tasks and is the only Scout workspace. It opens as a task console with three primary tasks: Chat, Feature Walkthrough, and Bug Repro. The console owns icon-led, keyboard-navigable task tabs plus compact readiness chips for Agent APK, Scout accessibility control, and Agent runtime/CLI health; clicking the runtime chip opens an independent health modal that can also change the current-device CLI profile. The main task panel stays focused on the selected task instead of repeating mode tabs or full-width runtime status cards. Walkthrough and Bug Repro goals are entered near the bottom start controls, where users are already deciding to start the Agent task. The panel routes normal multi-turn prompts to the selected Agent CLI profile, lets the agent request typed read-only device tools when needed, and keeps embedded Android-agent skills available as optional evidence shortcuts instead of forcing every prompt through a fixed workflow. There is no persistent bottom-right Scout icon or right-side Scout drawer; users enter Scout through Agent Tasks so behavior stays consistent with the rest of the app shell.
- Scout exposes device-bound, fully automatic task records for feature walkthroughs and Bug repros. The Agent captures screenshots, screen-state snapshots, Logcat, performance/device context, Agent notes, and Markdown reports as needed, then shows those artifacts in the selected mode's timeline and recent-record list. Chat, Walkthrough, and Bug Repro keep separate history surfaces; the task-scoped conversation remains available while a task is running, but general Chat does not inherit the autonomous task loop. Before start, the compact task bar contains the goal, Start action, optional working directory, and—for Feature Walkthrough—an optional package picker and reference link. Manual note, screenshot, recording, issue-marker, and permission-choice controls are not shown. An active record exposes Stop task as a lifecycle escape hatch plus Export; Stop closes the record, preserves it in history, and immediately releases the one-active-task gate. Completed history keeps Export, which creates a `.zip` containing `report.md` and available local artifacts under `assets/`. Checklist or test-plan material remains a conversation attachment.
- Fully automatic tasks run reversible operations continuously until the Agent produces a validated `COMPLETED`, `BLOCKED_NEEDS_HUMAN`, or `FAILED` outcome. The terminal assessment becomes the final report and closes the record automatically. Swipes, Back, ordinary navigation, Submit, Confirm, and Continue run directly. Protected actions are limited to destructive/data-loss, payment/purchase, account sign-in/sign-out, authorization/permission, reset/restart, and equivalent boundaries; the report names the blocked step, one required human action, and how to restart instead of showing an approval card or leaving the user to infer what happened.
- The Performance tab samples the selected device with a configurable fast interval, defaults to 1 second, supports a 0.5 second high-frequency mode, follows the foreground app by default, can pin a fixed app package, optionally enables a device-side Agent APK through ADB forward for lower-jitter app/process samples, shows stable last-known CPU/GPU/memory/rendering/network metric cards plus live trend charts, and exports the rolling 15-minute raw sample window.
- The Display Color tab sits under diagnostics. It presents fixed Settings-derived controls for Color Enhance, Color Bright, Contrast, Saturation, Color Temperature value, Color Temperature wheel coordinate, and Smart backlight; ADB Manager owns the desired values while the device screen acts as the preview surface. It opens a device-side test pattern, refreshes fixed readbacks on demand, keeps snapshot/diff as advanced diagnostics, and builds Markdown/JSON parameter exports for firmware and hardware suppliers. Firmware-backed Bright/Contrast/Saturation values use `persist.vendor.display.enhance_*` properties and immediately call the matching vendor display helper after readback so the panel can update without touching the device Settings slider. Color Temperature value uses `settings system aw_color_temperature_value` and then calls `setColorTemperature`; the color wheel mirrors Settings' 205-point coordinate space, writes `settings system srgb_color_temperature`, derives the same native ARGB value into `aw_color_temperature_value`, and live-applies it through the display helper as `enhanceComponent[10]` / sRGB white point. Operator-facing color temperature readouts show `#RRGGBB` plus `x,y` coordinates, while the signed Settings integer remains available as the firmware raw value for supplier handoff. Vendor-display controls expose their real service/component metadata and run through the packaged helper, but production firmware can still deny shell-to-display-HAL calls until firmware or a privileged bridge allows them.

## Cross-Cutting Principles

Device identity:

- Display identity should prefer `device_sn`, falling back to ADB `serial`.
- Local notes are keyed by `device_sn || serial`, so wireless port changes can still map to the same physical device when SN is available.
- Device history keeps recently seen devices visible as `disconnected`.
- Device-targeting tools use a shared `DeviceTargetState` and require an explicit online selected device before invoking ADB. The UI no longer intentionally falls back to ADB's default device selection for screenshots, installs, Workbench execution, clipboard input, Logcat refresh, performance sampling, package export, image cast, or scrcpy actions.

ADB command behavior:

- Every packaged platform selects ADB Manager's bundled platform-tools ADB client first, then falls back to a system or SDK ADB only when the bundled resource is unavailable. A normal installation therefore does not require a global ADB installation.
- The host ADB server remains shared on the standard port instead of starting a competing private server. Startup recovery restarts that shared server with the bundled client only when no device is connected; an existing server with online devices is retained to avoid disconnecting them.
- scrcpy receives the same resolved ADB executable through its `ADB` environment variable instead of selecting its downloaded companion ADB independently.
- macOS ADB subprocesses get a terminal-like `PATH`, `LANG`, and home current directory.
- Wireless pair/connect/restart commands are serialized through `AppState.adb_server_operation`.
- ADB restart preserves existing pairing files; wireless repair refreshes `adb_known_hosts.pb` while preserving `adbkey` and `adbkey.pub`.
- Remote PWA control still uses this desktop app as the only ADB host; remote clients receive scoped API access, not a host desktop session or arbitrary shell.

Risk handling:

- The workbench classifies commands as low, medium, or high risk.
- High-risk commands require explicit confirmation before execution.
- All device actions show a visible target-device strip and record target identity in user-facing results or exports when practical.
- Host identity reset is intentionally separated from ordinary ADB restart because it removes `adbkey` and changes this computer's ADB identity.

Persistence:

- Tauri store path: `settings.json`
- Store keys: `settings`, `deviceHistory`, `deviceNotes`, `pairConnect`, `adbStartupRepair`, `workbenchTemplates`, `workbenchHistory`, `agentCopilotSessions`, `evidenceSessions`
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
