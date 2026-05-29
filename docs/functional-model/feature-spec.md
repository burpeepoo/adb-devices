# Feature Specification

## 1. ADB Availability And Setup

Goal: ensure the desktop app can run ADB before exposing device workflows.

Entry points:

- Startup check in `App.tsx` through `check_adb_available`.
- Setup UI through `AdbSetup` when ADB is unavailable.
- Install helper through `install_adb`.

Logic:

- `check_adb_available` resolves ADB through `src-tauri/src/adb.rs`.
- macOS path priority is system ADB, SDK ADB, bundled ADB.
- Windows path priority is bundled ADB, system ADB, SDK ADB.
- `install_adb` downloads official Android platform-tools zip, extracts it under the user SDK location, and emits progress events.

Important details:

- macOS ADB subprocesses are launched with a terminal-like `PATH`.
- Installation is OS-specific and only supports macOS and Windows.
- ADB setup is separate from wireless pairing repair.

## 2. Device List And Device Console

Goal: show current and remembered devices, let the user select a device, and inspect useful diagnostics.

Frontend:

- `useDevices.ts`
- `DeviceList.tsx`
- `DeviceConsole.tsx`
- `DeviceConsoleShortcuts.tsx`

Backend:

- `adb_devices`
- `adb_device_summary`

Logic:

1. `adb_devices` runs `adb devices -l`, parses rows, infers connection type, and enriches online devices with `ro.serialno`.
2. `useDevices` merges online devices with stored `deviceHistory`.
3. Historical devices not currently online are shown as `disconnected`.
4. Online devices sort before offline/disconnected devices.
5. The selected device is preserved by ADB serial when possible and by `device_sn || serial` when wireless serial changes.
6. Device console loads `adb_device_summary` when the selected device is online.

User-visible behavior:

- Device title is `device_sn || serial`.
- Local notes can override the console title while still showing identity as secondary text.
- Notes are local-only and keyed by `device_sn || serial`.
- Device console exposes shortcuts to APK install, screenshot, record, mirror, image cast, clipboard, logcat, and packages.
- Device status and diagnostics are loaded on selection, not continuously polled.

## 3. Wireless Pair, Connect, Reconnect, And ADB Recovery

Goal: handle Android wireless debugging with current ports, recent endpoints, mDNS discovery, and explicit repair actions.

Frontend:

- `PairConnect.tsx`
- `pairConnectEndpoints.ts`
- `startupAdbRepair.ts`

Backend:

- `adb_mdns_discover`
- `adb_auto_connect`
- `adb_mdns_auto_connect`
- `adb_pair`
- `adb_connect`
- `adb_reconnect_endpoint`
- `adb_restart_server`
- `adb_repair_wireless_pairing`
- `adb_reset_host_identity`
- `adb_disconnect`
- `get_local_ipv4_addresses`
- `tcp_probe_endpoint`

Local state:

- Pair IP, pair port, pair code
- Connect IP, connect port
- mDNS devices
- Recent connect endpoints, limit 5
- Per-endpoint TCP probe state
- Pair/connect failure count
- Startup repair state

Discovery logic:

- Local IPv4 addresses refresh every 5 seconds.
- mDNS discovery runs every 10 seconds while the pair-code input is not focused and ADB is not busy.
- mDNS rows are filtered to local private networks that match the host IP prefixes.
- If local network signature changes, stale mDNS devices are cleared.
- TCP probes can check recent endpoint reachability before reconnect.

Pair logic:

1. User enters IP, pair port, and 6-digit code.
2. `adb_pair` runs `adb pair <ip:port> <code>` with a 25-second timeout.
3. If pair output has retriable transport errors, backend restarts ADB once and retries.
4. After successful pair, backend attempts `ADB_MDNS_AUTO_CONNECT=adb-tls-connect adb devices -l` to connect automatically.
5. UI records success/failure and may reveal repair controls after repeated failures.

Connect logic:

1. User enters IP and connect port or selects an mDNS/recent endpoint.
2. `adb_connect` runs `adb connect <ip:port>` with a 15-second timeout.
3. If direct connect fails, backend tries mDNS auto-connect for the same IP.
4. On success, endpoint is stored in recent connects.

Recent reconnect logic:

- Recent endpoints can be reconnected without restarting ADB.
- When reconnecting, the app can replace stale port with the current connected port or current mDNS connect port for the same IP.
- Explicit repair can call `adb_reconnect_endpoint` with `restart_adb = true`.

ADB restart/recovery logic:

- `adb_restart_server` disconnects, kills the ADB server, waits for port 5037 to close, force-kills matching ADB server processes if needed, starts the server, and waits for port 5037 to open.
- Before restarting, `adb_restart_server` repairs wireless pairing state by backing up and removing only `adb_known_hosts.pb`.
- `adb_repair_wireless_pairing` exposes that same middle path as a standalone repair command for the UI.
- Both repair paths preserve `adbkey` and `adbkey.pub`, so this computer's ADB host identity is unchanged.
- `adb_reset_host_identity` is the destructive fallback: it stops ADB, backs up and removes `adb_known_hosts.pb`, `adbkey`, and `adbkey.pub`, then starts ADB.
- Pair/connect operations are serialized by `adb_server_operation`.

Startup repair:

- Gated by app version and a 10-minute cooldown.
- Waits 3.5 seconds after launch before attempting.
- If a device is already online, records completion and does not repair.
- If no device is online and recent endpoints exist, attempts a non-visible `restartAdbAndReconnect`.

Important failure signals:

- `protocol fault`
- `couldn't read status message`
- `no route to host`
- `failed to start pairing connection client`

These are treated as candidates for restart/retry or explicit repair. If TCP is reachable but pair keeps returning protocol fault, the device-side wireless pairing dialog/session may be stale and should be refreshed on device.

## 4. ADB Workbench

Goal: offer a structured command library plus direct custom ADB execution.

Frontend:

- `AdbWorkbench.tsx`
- `workbenchCommandRewrite.ts`

Backend:

- `adb_workbench_execute`
- `export_text_file`

Modes:

- Library: built-in catalog of parameterized operations.
- Templates: saved user commands.
- Custom: freeform ADB subcommand or full `adb` command.

Built-in categories:

- Device properties
- Display
- Media
- Files
- Network
- Apps and packages
- Permissions/components
- System settings/properties
- Diagnostics
- Power
- Input
- Logcat

Logic:

- Commands are built as ADB subcommands, then previewed as `adb -s <serial> ...` when a device is selected.
- Custom input may include `adb` and `-s`; backend strips these and applies the currently selected serial.
- The rewrite helper converts batches of `adb shell ...` lines into one quoted `shell '<cmd1>; <cmd2>'` command.
- High-risk commands require a checkbox before execution.
- History keeps the last 30 executions.
- Saved templates keep up to 40 entries.
- Output can be exported as a text file.

Risk classification:

- High: `rm`, `dd`, `reboot`, `uninstall`, `pm clear`.
- Medium: `setprop`, `settings put`, `am force-stop`, `grant`, `revoke`, `install`, `push`.
- Low: all other commands.

## 5. APK Installation

Goal: install one or more local APK files with optional force reinstall.

Frontend:

- `ApkInstall.tsx`
- `PackageNameInput.tsx`
- `pathClipboard.ts`

Backend:

- `adb_install`
- `parse_apk_package`
- `resolve_apk_paths`
- `read_clipboard_apk_paths`
- `adb_list_packages`

Inputs:

- Drag/drop files or folders.
- File picker.
- Clipboard file paths or text paths.
- Manually selected package name for force uninstall.

Logic:

- Folder paths are recursively expanded to `.apk` files and deduped.
- APK package name is parsed from binary `AndroidManifest.xml`.
- Normal install uses `adb install -r`.
- Force mode attempts `adb uninstall <package>` first, then `adb install <apk>` without `-r`.
- A backend install lock prevents concurrent installs.
- Each queue item tracks pending/installing/success/failed status.

Edge cases:

- Uninstall failure is tolerated because the package may not already exist.
- If package parsing fails, the UI can still install but force uninstall may need manual package input.

## 6. Package List And APK Export

Goal: inspect installed packages and pull installed APK files back to the host.

Frontend:

- `PackageList.tsx`
- `PackageNameInput.tsx`

Backend:

- `adb_list_packages`
- `adb_package_info`
- `adb_list_package_details`
- `adb_export_package_apk`

Logic:

- Package list can load all package details from `dumpsys package packages`.
- Package info includes package name, version name, version code, device serial number, and build number.
- APK export runs `pm path <package>`, then `adb pull` for one or many APK paths.
- Split APK packages are exported into a package-specific folder.
- Output folder is under the host Downloads directory: `ADB_Manager/APKs`.
- Filenames are sanitized.

## 7. Screenshot

Goal: capture the selected device screen to a local PNG.

Backend command: `adb_screenshot`

Logic:

1. Run `adb shell screencap -p /sdcard/adb_manager_screenshot_<timestamp>.png`.
2. Pull the file to configured screenshot directory as `screenshot_<timestamp>.png`.
3. Remove the temporary device file.
4. Return local path.

User-facing helpers:

- Open saved file.
- Reveal saved file in folder.
- Global shortcut event can trigger screenshot from the current app state.

## 8. Screen Recording

Goal: start and stop an Android `screenrecord`, then save the MP4 locally.

Backend commands:

- `adb_start_recording`
- `adb_stop_recording`

Logic:

- One recording process is allowed at a time.
- Start spawns `adb shell screenrecord /sdcard/adb_manager_recording_<timestamp>.mp4`.
- Stop kills the process, waits 1 second for device-side finalization, pulls the file, removes the remote temp file, and returns local path.
- UI tracks elapsed time and warns near Android's common 3-minute screenrecord limit.
- Global shortcut event can start/stop recording.

## 9. Screen Mirror

Goal: open and manage a scrcpy session for the selected device.

Frontend: `ScreenMirror.tsx`

Backend:

- `check_scrcpy_available`
- `install_scrcpy`
- `start_screen_mirror`
- `stop_screen_mirror`
- `get_screen_mirror_state`
- `send_navigation_key`
- `adb_list_launchable_apps`
- `adb_load_launchable_app_icon`
- `adb_launch_app`

Logic:

- Prefer bundled scrcpy resources, then system-installed scrcpy.
- Start requires a selected online device and verifies `adb -s <serial> get-state` equals `device`.
- Launches scrcpy with `-s <serial>`, optional `--no-audio`, custom window title, `ADB=<adb path>`, and bundled server path when available.
- If scrcpy exits within 900 ms, show captured output as error.
- UI periodically checks mirror state every 2.5 seconds.
- Navigation commands support Back and Home through `input keyevent`.
- The app drawer loads automatically for the selected online device and reloads when the selected device changes.
- The drawer lists launchable `MAIN` + `LAUNCHER` activities via `cmd package query-activities`, dedupes components, and keeps a stable label/package/activity sort order.
- The drawer groups visible apps by the namespace after `com.` in the package name, displays category titles with an initial capital letter, and treats `com.elclcd.*` as Cozyla.
- App icons load progressively after the drawer list appears. The backend first checks local cache, then uses `pm path <package>`, pulls that APK to a temporary directory, parses `AndroidManifest.xml` and `resources.arsc`, resolves direct PNG/WebP icon resources and adaptive icon XML foreground/bitmap references, and returns app icons as data URLs when available.
- Icon cache is stored under the app cache directory. Cached icons are returned immediately; entries older than 24 hours are revalidated in the background, APK path changes rebuild immediately, and unchanged entries are rebuilt after 7 days.
- Clicking a drawer item launches the component with `am start -n <package>/<activity>`.

scrcpy installation:

- macOS installs Homebrew if missing, then `brew install scrcpy`.
- Windows downloads latest win64 scrcpy zip from Genymobile GitHub release and extracts it under local app data.
- Install progress is emitted through `scrcpy-install-progress`.

## 10. Image Cast

Goal: push a local reference image to the device and optionally open it.

Frontend: `ImageCast.tsx`

Backend:

- `read_image_preview_data_url`
- `adb_push_reference_image`
- `adb_open_reference_image`

Supported input:

- PNG
- JPG/JPEG
- WebP

Logic:

- Local preview is loaded through `read_image_preview_data_url`, which validates image type/size in Rust and returns a data URL. The app does not need broad Tauri asset protocol access to the user's home folder.
- Default remote directory is `/sdcard/Pictures/ADBManager`.
- Backend validates local file, MIME type, remote dir, and remote path.
- Creates remote directory with `mkdir -p`.
- Pushes file with `adb push`.
- Optional media scan sends `android.intent.action.MEDIA_SCANNER_SCAN_FILE`.
- Optional open runs `am start -a android.intent.action.VIEW -d file://... -t <mime>`.
- Last pushed image can be reopened.

## 11. Clipboard Text Input

Goal: send host-side text into the selected Android device as keyboard input.

Frontend: `Clipboard.tsx`

Backend: `adb_input_text`

Logic:

- Text limit is enforced in UI at 2000 characters.
- Backend escapes input for `adb shell input text`.
- Spaces are encoded for ADB input behavior.

## 12. Logcat

Goal: read, filter, stream, and export device logs.

Frontend: `Logcat.tsx`

Backend:

- `adb_read_logcat`
- `adb_start_logcat`
- `adb_stop_logcat`
- `export_text_file`

Snapshot logic:

- Runs `adb logcat -d -v threadtime -t <limit>`.
- Default line limit is 800, clamped from 100 to 3000.
- Optional filter text is split into logcat arguments.

Streaming logic:

- One streaming logcat process is allowed at a time.
- stdout/stderr lines are emitted as `adb-logcat-line`.
- Lines are parsed into timestamp, PID, level, tag, and message.

UI behavior:

- Supports level/tag/PID/text filters.
- Can export visible text.
- Uses periodic refresh for snapshot mode while active.

## 13. Settings, Language, And Updater

Goal: manage app preferences and update flow.

Frontend:

- `Settings.tsx`
- `useAppUpdater.ts`
- `updaterPolicy.ts`
- `updateNotes.ts`
- `i18n.ts`

Backend:

- `select_directory`
- `get_default_save_dir`
- `set_locale`
- `open_file`
- `reveal_path`
- `open_external_url`

Settings:

- Language preference: system, English, Chinese.
- Screenshot directory.
- Recording directory.
- Automatic update checks.

Updater behavior:

- Desktop only. In non-Tauri context, manual check reports unavailable/error.
- Automatic check delay: 2.5 seconds.
- Automatic interval: 6 hours.
- Request timeout: 30 seconds.
- Invalid release feed can be treated as no update.
- Network errors are mapped to localized update network copy.
- Download progress tracks started/progress/finished events.
- Successful install calls Tauri `relaunch`.

Release note localization:

- Release body can contain `en-US`, `en`, `English`, `zh-CN`, `zh`, `中文`, or `Chinese` sections.
- Frontend selects the section matching current language and falls back to English, Chinese, then cleaned full body.

## 14. OS Integration And External URLs

Goal: safely bridge common OS actions.

Rules:

- Directory picker uses Tauri dialog.
- Reveal path:
  - macOS: `open -R <file>` for files, `open <folder>` for folders.
  - Windows: Explorer selection/open behavior.
- Open external URL only allows:
  - `https://brew.sh/`
  - `https://github.com/Genymobile/scrcpy`
  - `https://github.com/burpeepoo/adb-devices`

## 15. Global Shortcuts

Backend registers:

- Screenshot: Ctrl+Shift+0
- Record: Ctrl+Shift+Minus

Events:

- `global-screenshot-shortcut`
- `global-record-shortcut`

Frontend receives these events and delegates to the screenshot/recording component behavior for the currently selected device and configured save directories.
