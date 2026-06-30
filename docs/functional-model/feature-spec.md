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
- Windows child processes are created through a shared hidden-window helper so app-launched ADB, ffmpeg, scrcpy, repair, discovery, and OS helper commands do not flash console windows.
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
- Device console exposes shortcuts to APK install, screenshot, record, mirror, remote console, image cast, clipboard, logcat, and packages.
- Device status and diagnostics are loaded on selection, not continuously polled.
- Device-targeting tools share a target-device strip. ADB actions require an explicit online selected device; the UI does not intentionally pass an empty serial to use ADB's default device.
- Screenshot/recording shortcuts, Workbench execution, APK install, image cast, clipboard, Logcat refresh, package export, scrcpy mirror/navigation, and app drawer launch all use the selected online serial and surface target identity in results or exports where practical.

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
- `adb_mdns_discover` first uses `adb mdns services`; on macOS, if ADB returns no services, it falls back to system Bonjour discovery through `dns-sd` and resolves reachable IPv4 endpoints.
- mDNS rows are filtered to local private networks that match the host IP prefixes.
- If local network signature changes, stale mDNS devices are cleared.
- TCP probes can check recent endpoint reachability before reconnect.

Pair logic:

1. User enters IP, pair port, and 6-digit code.
2. `adb_pair` runs `adb pair <ip:port> <code>` with a 25-second timeout.
3. If pair output has retriable transport errors such as `protocol fault`, backend restarts the local ADB server once while preserving existing pairing state, then retries.
4. After successful pair, backend discovers the current `_adb-tls-connect` service for the same IP and explicitly runs `adb connect <ip:current_connect_port>`. If no current port is found, it falls back to `ADB_MDNS_AUTO_CONNECT=adb-tls-connect adb devices -l`.
5. UI records success/failure, saves the refreshed connect port when discovery exposes one, refreshes the device list, and may reveal repair controls after repeated failures.

Connect logic:

1. User enters IP and connect port or selects an mDNS/recent endpoint.
2. `adb_connect` runs `adb connect <ip:port>` with a 15-second timeout.
3. If direct connect fails, backend tries the current mDNS connect port for the same IP, including macOS `dns-sd` fallback when ADB mDNS is empty, then falls back to ADB mDNS auto-connect.
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
- The PairConnect UI presents a six-step wireless recovery ladder: network/ADB state, mDNS scan, recent endpoint probe, manual current connect port, safe wireless repair, and host identity reset.
- The recovery ladder recommends recent probes when mDNS is empty but recent endpoints exist, recommends manual current-port entry when a recent endpoint is reachable, and keeps host identity reset locked behind safe repair visibility.
- Host identity reset requires a confirmation modal that explains it can force all Android devices to authorize or pair this computer again.

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

## 10. Remote Control Console

Goal: let a phone or another computer control ADB-connected devices through ADB Manager without exposing the host desktop or arbitrary shell.

Frontend:

- Desktop entry: `RemoteControl.tsx`
- Browser/PWA entry: `/remote`, served by `remote.rs`

Backend:

- `remote_control_status`
- `remote_control_start`
- `remote_control_stop`
- `remote_control_trusted_devices`
- `remote_control_revoke_trusted_device`
- `remote_control_revoke_all_trusted_devices`
- Internal `/remote/api/*` HTTP routes for invite claim, trust register/claim/revoke, auth, status, device list, screenshot, experimental HLS video stream, MJPEG fallback stream, tap, swipe, text, clipboard, key, control ownership, sessions, APK install, reconnect, pairing repair, templates, and audit log.

Logic:

- Remote control is off by default and starts only after the desktop user enables it.
- Starting opens an embedded HTTP service and first tries the last successful remote-control port. If that port is occupied, it falls back to a random local port and reports the current address set. Localhost, LAN, and Tailscale addresses are shown when available; Tailscale IPv4 and MagicDNS addresses are sorted first for cross-network direct access inside the user's tailnet.
- The desktop status response includes one-time `viewer`, `operator`, and `admin` invite links with QR SVGs. Each invite can be claimed once; after claim, the same role is automatically replenished so the desktop panel stays scannable.
- The desktop UI summarizes service state, network exposure, active role counts, current controller, trusted-device expiry pressure, and stream defaults before the detailed links.
- Desktop role cards use localized labels and state what each role can and cannot do.
- PIN auth remains as a fallback admin path, but role QR cards are the primary flow.
- After a browser session logs in, it can register as a trusted device for 7 days. The browser stores the raw trust token in localStorage; the desktop app persists only the token hash, role, device name, timestamps, and last successful port in `remote-trusted-devices.json`.
- Opening `/remote` with a valid trust token automatically creates a new same-role session. Trust never upgrades permissions; a trusted `viewer` remains view-only, and an `operator` still needs to acquire control before sending input.
- Closing Remote Control clears in-memory sessions, invites, control owner, frame cache, and audit log, but does not delete trusted devices. Desktop admins can revoke one trusted device or clear all trusted devices.
- The stop action is framed as closing a remote support session. The UI explains that current sessions/control are stopped while trusted devices remain until expiry or revocation.
- `viewer` can view devices, screenshots, stream, audit, and download screenshots. `operator` can also acquire control, send input, send clipboard text, and run safe command templates. `admin` can manage sessions, force acquire control, install APKs, reconnect devices, and run wireless pairing repair.
- Multiple remote browsers may watch at once. Only one `operator` or `admin` session can hold control at a time; input actions from non-owners return a clear conflict.
- Remote actions are whitelisted to screenshot, HLS/MJPEG viewing, tap, swipe, text input, clipboard text, Back, Home, Recent, Power, Volume Up, Volume Down, selected safe templates, APK install, reconnect, and pairing repair.
- Remote control does not expose arbitrary shell or the host desktop.
- Input actions are serialized through `remote_control_operation`.
- Screenshot refreshes use `exec-out screencap -p`, allow up to 20 seconds for slow wireless ADB devices, and are deduped per device by `remote_screenshot_in_flight`, so repeated live refreshes do not queue behind each other.
- V2.5 experimental video stream starts `adb exec-out screenrecord --output-format=h264 -`, pipes it through host `ffmpeg`, and serves token-scoped fMP4 HLS assets (`init.mp4` plus `.m4s` media segments) under the authenticated remote API. This avoids the `screencap` path that can stall on slow wireless ADB links while keeping the stream friendlier to mobile browser HLS players. The playlist rewrite keeps media URLs token-scoped and clamps a zero target duration to 1 second because static Android screens can produce very short first fragments.
- Only one experimental HLS stream is active at a time. Starting a stream for a different device stops the previous stream, and closing Remote Control stops any active HLS pipeline. The current POC depends on host `ffmpeg` being available.
- MJPEG stream remains as the first fallback endpoint. It converts cached screencap PNG frames to JPEG, defaults to 5 fps, quality 70, and max width 960. Recent frames are cached per device so multiple viewers do not each trigger ADB screenshots.
- The PWA `Start stream` button first tries the experimental HLS stream and renders it through a browser `<video>` element. Before playback, the PWA probes the playlist and first media asset so failures can distinguish unreachable HLS assets from browser playback rejection. If HLS startup or browser decode fails, the PWA stops the HLS process and automatically switches the same viewer to MJPEG; if MJPEG image loading fails, it falls back to live snapshot refresh.
- Screenshot refreshes do not hold the input action lock. This keeps tap/key/text commands responsive while live snapshot is running.
- The PWA supports live snapshot interval choices and optional delayed refresh after actions; by default, actions return after the input command instead of forcing an immediate screenshot refresh.
- Operator/admin sessions can enable Mouse mode. Mouse mode shows an overlay pointer on the current frame, lets the user move it with a touchpad area, and only sends `input tap` when the user clicks, reducing accidental touches on phones.
- APK uploads are capped and written to a temporary host file, installed with `adb install -r`, then removed.
- Remote reconnect and pairing repair reuse the desktop app's ADB path and ADB server operation lock. Pairing repair restarts the host ADB server while preserving the host key.
- Audit entries keep the last 100 remote actions in memory, including session id, role, action, target serial, result, and message.

## 11. Image Cast

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

## 12. Clipboard Text Input

Goal: send host-side text into the selected Android device as keyboard input.

Frontend: `Clipboard.tsx`

Backend: `adb_input_text`

Logic:

- Text limit is enforced in UI at 2000 characters.
- Backend escapes input for `adb shell input text`.
- Spaces are encoded for ADB input behavior.

## 13. Logcat

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

## 14. Performance Sampling

Goal: sample selected-device and target-app performance during live Android testing.

Frontend: `PerformancePanel.tsx`

Backend:

- `adb_performance_sample`
- `adb_performance_stream_start`
- `adb_performance_stream_snapshot`
- `adb_performance_stream_stop`
- `export_text_file`

Sampling behavior:

- Entering the tab with an online selected device starts sampling automatically.
- Fast samples default to 1 second and can be manually set to 0.5, 1, 2, or 5 seconds; slow `dumpsys`/thermal/storage/display probes still run every 10 seconds; `gfxinfo framestats` probes still run every 5 seconds.
- The first automatic sample after start/resume is fast-only so the target package and basic device metrics appear before slower probes run.
- Sampling follows the foreground app by default and can pin the current foreground package as the fixed target app.
- Foreground app detection reads both window focus and resumed-activity sources so customized Android builds can still resolve the target package.
- If foreground app detection is slow or unavailable, sampling still returns system/device metrics instead of blocking the whole sample.
- The default path starts one persistent `adb shell` sampling stream per selected device and keeps the latest complete frame in memory; the selected 0.5/1/2/5 second cadence controls the device-side fast sampler, while the UI may poll the in-memory snapshot more frequently so it does not miss newly completed frames.
- Slow probes run as background cache refreshers inside the same device-side shell so battery/thermal/storage/rendering probes do not block live CPU, memory, network, process, and GPU counter frames.
- Device metrics are tiered: CPU, memory, network, process state, and available GPU sysfs counters refresh on the selected cadence; battery, thermal, storage, display, CPU frequency, and `dumpsys gpu` memory fallback remain slow probes at about 10 seconds.
- If the persistent stream cannot start or exits before producing data, the UI falls back to the compatible one-shot `adb_performance_sample` path.
- The compatible backend path returns one read-only sample per command and does not start a long-running device agent.
- The frontend watchdog allows 20 seconds per sample so a 2-second foreground probe plus a 10-second slow/frame probe does not falsely trip the UI timeout on wireless ADB.
- The frontend schedules the next automatic poll after the current sample completes, so slow wireless ADB does not queue overlapping probes.
- Manual "sample now" requests made while an automatic probe is in flight are queued once and run immediately after the active probe finishes; the button does not visually debounce during periodic sampling.

Metrics:

- App/process: package, PID, process state, raw process CPU jiffies, RSS/PSS, thread count.
- Device/system: raw system CPU jiffies, memory, battery, thermal state, CPU frequency, GPU utilization/frequency when exposed by Android sysfs, `dumpsys gpu` memory fallback when sysfs counters are permission-limited, network bytes, `/data` storage, display size/density/refresh.
- Rendering: attempts `dumpsys gfxinfo <package> framestats`; unsupported packages show the source as unavailable without blocking other metrics.

UI behavior:

- Shows App, Rendering, Device realtime, Device details, Live Trends, and Timeline areas; the four metric overview panels use a two-column desktop layout so dense values stay readable.
- Shows stable running/paused state and last sample time without a live countdown.
- Keeps the sampling interval selector aligned with the toolbar buttons; the selector uses an accessible label instead of a visible stacked label.
- Shows first-sample loading values and pauses auto sampling with a visible timeout if ADB does not return within the frontend watchdog window.
- Metric cards render a last-known display snapshot for cadence-based or permission-limited fields, so fast samples do not briefly clear slow metrics to `-`; Timeline and exports still keep the raw per-sample values.
- Adds a GPU diagnostics card that explains whether usage counters, frequency counters, GPU memory, and frame stats are available, permission-limited, or missing based only on the existing sample fields and raw probe lines; the card is collapsed by default, expands into a two-row diagnostic layout, and keeps raw probe output behind a second disclosure.
- Keeps a rolling 15-minute sample window in frontend state.
- Computes CPU percentages and network rates from adjacent samples.
- Draws lightweight SVG trend charts for CPU, GPU, RSS, memory, P95 frame time, and network metrics from the same rolling samples.
- Warns on missing target process, elevated thermal state, battery temperature at or above 45 C, and RSS growth over 20% in 5 minutes; jank remains visible as a metric/trend but does not raise a transient warning banner.
- Exports JSON or CSV containing metadata, sampling intervals, and retained samples.

## 15. Settings, Language, And Updater

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

## 16. OS Integration And External URLs

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

## 17. Global Shortcuts

Backend registers:

- Screenshot: Ctrl+Shift+0
- Record: Ctrl+Shift+Minus

Events:

- `global-screenshot-shortcut`
- `global-record-shortcut`

Frontend receives these events and delegates to the screenshot/recording component behavior for the currently selected device and configured save directories.
