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
- `components/layout/DevicePanel.tsx`
- `DeviceConsole.tsx`
- `DeviceConsoleShortcuts.tsx`

Backend:

- `adb_devices`
- `adb_device_summary`
- `adb_get_authorization_timeout_disabled`
- `adb_set_authorization_timeout_disabled`

Logic:

1. `adb_devices` runs `adb devices -l`, parses rows, infers connection type, and enriches online devices with `ro.serialno`.
2. `useDevices` merges online devices with stored `deviceHistory`; explicit device-list refresh first attempts `adb_mdns_auto_connect` for already trusted wireless devices, then treats the refreshed `adb_devices` result as the source of truth.
3. Historical devices not currently online are shown as `disconnected`.
4. Online devices sort before offline/disconnected devices.
5. The selected device is preserved by ADB serial when possible and by `device_sn || serial` when wireless serial changes.
6. Device console loads `adb_device_summary` when the selected device is online.
7. For online wireless devices, the device list reads Android global setting `adb_allowed_connection_time` from the connected device and reflects the real device state. The local per-device preference is only a reconnect/apply hint; enabling it writes `0` so ADB authorization does not expire automatically, while disabling it restores the default timeout value.

User-visible behavior:

- Device title is `device_sn || serial`.
- Local notes can override the console title while still showing identity as secondary text.
- Notes are local-only and keyed by `device_sn || serial`.
- The device-list refresh button scans trusted wireless devices before refreshing the visible list, so newly available paired devices can move online without opening the wireless pairing panel first.
- Online wireless rows expose a compact ADB no-timeout switch below the note area; USB and offline rows do not show it. The switch prefers the connected device's current setting over the locally stored preference.
- Device console exposes shortcuts to APK install, screenshot, record, mirror, remote console, image cast, clipboard, logcat, and packages.
- The Scout Tasks section on the device console exposes Chat, Feature Walkthrough, and Bug Repro in that order. Each card enters its matching Scout workspace mode, including when the Agent Tasks workspace remains mounted from an earlier visit.
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
- mDNS connect rows are normalized before display by physical device key from the service name, falling back to IP. When Android or Bonjour exposes multiple connect ports for the same device, the UI keeps one row, preferring the exact current ADB transport, then an exact recent endpoint, then same-IP history.
- If local network signature changes, stale mDNS devices are cleared.
- TCP probes can check recent endpoint reachability before reconnect.

Pair logic:

1. User enters IP, pair port, and 6-digit code.
2. `adb_pair` runs `adb pair <ip:port> <code>` with a 25-second timeout.
3. If pairing fails, backend reports the failure without restarting the shared ADB server. This keeps already-connected devices online; ADB repair or restart remains an explicit recovery action.
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
- Explicit restart/reconnect can call `adb_reconnect_endpoint` with `restart_adb = true`; that path restarts the local ADB server while preserving pairing state, then reconnects the endpoint.
- The auto-connect action reports connected count from the refreshed device list after `adb_mdns_auto_connect`, not from the raw auto-connect command output, so duplicate or stale mDNS rows do not claim a device is connected until it appears in current ADB truth.

ADB restart/recovery logic:

- `adb_restart_server_preserving_pairing` disconnects, kills the ADB server, waits for port 5037 to close, force-kills matching ADB server processes if needed, starts the server, and waits for port 5037 to open without changing `.android` pairing files.
- `adb_repair_wireless_pairing` backs up and removes only `adb_known_hosts.pb`, then restarts ADB.
- Repair preserves `adbkey` and `adbkey.pub`, so this computer's ADB host identity is unchanged.
- `adb_reset_host_identity` is the destructive fallback: it stops ADB, backs up and removes `adb_known_hosts.pb`, `adbkey`, and `adbkey.pub`, then starts ADB.
- Pair/connect operations are serialized by `adb_server_operation`.
- The PairConnect UI presents a six-step wireless recovery ladder: network/ADB state, mDNS scan, recent endpoint probe, manual current connect port, safe wireless repair, and host identity reset.
- The recovery ladder recommends recent probes when mDNS is empty but recent endpoints exist, recommends manual current-port entry when a recent endpoint is reachable, and escalates safe repair / host identity reset to recommended or last-fallback states after failures while keeping both actions available in the ladder.
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
- UI layout: Workbench relies on the global current-device header instead of rendering a second target-device card. The command library and command editor share one work area, command preview sits beside the editor actions, command output/history are separated by tabs, and long command libraries scroll inside the picker area so output remains visible without being pushed below the fold.

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
- These labels describe the manual ADB Workbench UI. Fully automatic Scout tasks apply an additional protected-action boundary: permission mutation such as `pm grant` / `pm revoke` is protected regardless of the Workbench's medium label, so Scout returns guided blocker data and never runs it or creates an approval card.

## 4.5. Display Color Control Lab

Goal: move the device Settings display-color controls into ADB Manager so the desktop app is the parameter control surface and the physical device screen is the preview surface.

Frontend:

- `DisplayCalibrationLab.tsx`
- `displayCalibration.ts`

Backend:

- `adb_display_calibration_snapshot`
- `adb_display_calibration_diff`
- `adb_display_calibration_read_target`
- `adb_display_calibration_apply`
- `adb_display_calibration_open_test_pattern`
- `adb_display_calibration_build_export`

Current scope:

- The left rail exposes the tab as `displayCalibration` under diagnostics.
- The primary UI is a fixed device-control board for the Settings display controls: Color Enhance, Color Bright, Contrast, Saturation, Color Temperature value, Color Temperature wheel coordinate, and Smart backlight.
- Each control shows the supplier-facing parameter name, current value when discoverable, desired value, readback value after apply, and the apply action. Per-control explanatory subtitles and the top aggregate metric cards are intentionally hidden in the UI so operators can tune values without reading implementation notes or summary counters.
- Color Temperature value maps to `settings system aw_color_temperature_value`; after a successful write/readback, ADB Manager calls the vendor display helper `setColorTemperature` with the same value so the screen refresh does not depend on opening the device Settings page. The color wheel coordinate maps to `settings system srgb_color_temperature`, is edited through a clickable ADB Manager color wheel that mirrors Settings' 205-point coordinate space, and is exported as `x,y`. Applying the wheel also derives the native Settings ARGB color, writes it back to `aw_color_temperature_value`, and live-applies it through the display helper as `enhanceComponent[10]` / sRGB white point. The UI presents color temperature and color-wheel values as `#RRGGBB` plus `x,y` coordinates, with the signed Settings integer demoted to a "firmware raw value" detail so firmware-facing data is preserved without making the operator workflow look numeric-first. Android `settings get` returns the literal `null` for an unset key, and the UI treats that as unset rather than as a valid value.
- Color Bright, Contrast, and Saturation use firmware-provided `persist.vendor.display.enhance_bright`, `persist.vendor.display.enhance_contrast`, and `persist.vendor.display.enhance_saturation` properties with range `0..100`; empty `getprop` output is treated as unset. Color Enhance and Smart backlight remain modeled from Settings APK evidence as `vendor.display.output.IDisplayOutputManager/default` calls; Color Enhance uses component `0`.
- The UI can open a test pattern, refresh fixed control values directly, apply values after explicit confirmation, read back the applied target, and build Markdown/JSON export payloads. The primary Refresh Current action reads only the fixed control board and does not run the full advanced snapshot. Advanced candidate, selected-parameter, and changed-parameter sections are retained behind an internal feature flag but are hidden from the current operator UI because the fixed Settings-derived controls are the intended workflow.
- Vendor-display controls are visible, exportable, and routed through an ADB Manager display helper packaged with the Agent APK. On the tested production firmware, the helper reaches the binder service but SELinux denies `shell` calling `hal_awdisplayoutput_default`, so live Color Enhance and Smart backlight writes require a firmware allowlist, root/permissive engineering build, or a vendor-provided privileged bridge. The separate root action warns that `adb root` can restart adbd, reboot GC7N10001XL on affected firmware, or disconnect local mirroring.
- Snapshot and diff remain available as an advanced diagnostics surface for discovery, readback evidence, and supplier context.

Control logic:

1. Resolve the selected physical device to an executable ADB serial when the UI selection is an mDNS service-name alias.
2. Refresh fixed control values through `adb_display_calibration_read_target`; use the latest current readback, then reference readback, then snapshot candidates, then fixed defaults. This fast path updates the Current timestamp from fixed-control read completion rather than waiting for a full advanced snapshot.
3. Let the user edit the desired value in ADB Manager; if live apply is enabled, send the new value immediately, otherwise send it when the user clicks apply.
4. Settings-backed controls are written with `settings put` and read back with `settings get`; property-backed controls are written with `setprop` and must read back a non-empty `getprop` value before they count as successful.
5. Known firmware property writes immediately call the matching vendor display helper after readback: Bright/Contrast/Saturation map to `setEnhanceComponent` ids `1`, `2`, and `6`; `settings system aw_color_temperature_value` maps to `setColorTemperature` with the same integer readback.
6. Applying the color wheel coordinate writes `settings system srgb_color_temperature`, derives the Settings-native ARGB value from the same 205-point coordinate, writes that value to `settings system aw_color_temperature_value`, and live-applies it through `setEnhanceComponent` id `10` so the screen can refresh without opening the device Settings page.
7. Vendor-display controls validate the target metadata, run the display helper, and surface the helper/firmware result. If firmware denies the binder call, the UI shows that failure inline on the affected control instead of pretending a generic ADB write can control the real Settings function.
8. After a write attempt, show readback or error immediately on the control row. Do not refresh the advanced snapshot automatically after a single-control apply.

Snapshot logic:

1. Capture settings from `system`, `secure`, and `global`.
2. Capture `getprop`.
3. Capture `dumpsys display`, `dumpsys SurfaceFlinger`, and `cmd color_display`.
4. Capture likely display/PQ service names, bounded display-related sysfs candidates, and a bounded display-related Logcat tail.
5. Extract candidate rows whose key or value contains display/color/PQ/backlight/gamma/saturation/contrast/temperature-style keywords.
6. Mark settings, property, and sysfs candidates as writable targets when they can be represented safely.

Diff logic:

- Compare two snapshots by stable candidate id.
- Return before/after value pairs, source, confidence, and target when available.
- This is an advanced evidence workflow, not the main control workflow. It is used to verify storage locations, inspect firmware behavior, and find additional supplier-relevant parameters. The Compare action captures the current advanced snapshot and computes the diff against the recorded reference.

Apply logic:

- Supports settings, system property, and sysfs targets directly.
- Validates vendor-display targets and reports that helper support is required before writing.
- Validates namespace, key/path, and value before writing.
- Requires explicit confirmation because this path can change device display behavior.
- Reads back the target value after a successful write.

Read logic:

- `adb_display_calibration_read_target` validates the same target model as apply.
- Settings targets use `settings get`; properties use `getprop`; sysfs targets use `cat`.
- Vendor-display targets route through the packaged display helper and return success=false with helper/firmware detail when the production build denies shell-to-HAL calls.

Test pattern logic:

- Generates a local PNG containing gray ramp, RGB/CMY patches, warm skin-like patches, an HSV disc, and edge patterns.
- Pushes it to `/sdcard/Pictures/ADBManager`.
- Opens it through Android `VIEW` intent so physical-screen changes can be inspected after ADB Manager applies parameters.

Export logic:

- Builds JSON and Markdown profile payloads for firmware and hardware suppliers.
- Includes the fixed Settings-derived controls first, then optional selected advanced/diff parameters.
- Includes device identity, target path/key/service, baseline value, desired value, readback value, helper requirement notes, visible-effect confirmation, and physical-validation requirement.
- The export explicitly states that ADB readback proves software-visible values, while final panel color still needs physical-screen validation.

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
- The install queue scrolls inside its own panel, while progress, result, and the primary install action remain in a bottom action area so large multi-APK batches do not push the install button out of reach.

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

Application log collection:

- Each package row exposes `Pull logs`.
- The collection flow first checks standard app external/media log locations and matching folders under `/storage/emulated/0/Documents/cozyla/logs/`; the user can select a detected candidate or replace it with an absolute device path.
- When exactly one high-confidence package path exists, the row action starts collection directly; ambiguous or leaf-only matches open the path picker instead of silently selecting a directory.
- One collection pulls the selected remote file/directory, captures up to 3000 lines of current-process Logcat when the package is running, and writes `metadata.json` with package, device, source path, timestamp, and warnings.
- Output is saved under the host Downloads directory: `ADB_Manager/AppLogs/<package>/logs_<timestamp>` and can be revealed from the result banner.
- Automatic Logcat capture is best-effort and PID-scoped; persisted feature logs from the remote path remain the authoritative artifact.

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
- Start refuses to launch scrcpy when `adb -s <serial> shell id -u` returns `0`; on the reported GC7N userdebug firmware, starting local mirroring while adbd is rooted can reboot the device, so the user must run `adb unroot`, wait for reconnect, and then start mirroring.
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
- `adb_agent_status`
- `adb_agent_install`
- `adb_agent_start`
- `adb_agent_connect`
- `adb_agent_sample`
- `adb_agent_stop`
- `export_text_file`

Sampling behavior:

- Entering the tab with an online selected device starts sampling automatically.
- Fast samples default to 1 second and can be manually set to 0.5, 1, 2, or 5 seconds; slow `dumpsys`/thermal/storage/display probes still run every 10 seconds; `gfxinfo framestats` probes still run every 5 seconds.
- The first automatic sample after start/resume is fast-only so the target package and basic device metrics appear before slower probes run.
- Sampling follows the foreground app by default and can pin the current foreground package as the fixed target app.
- Foreground app detection reads both window focus and resumed-activity sources so customized Android builds can still resolve the target package.
- If foreground app detection is slow or unavailable, sampling still returns system/device metrics instead of blocking the whole sample.
- The default path starts one persistent `adb shell` sampling stream per selected device and keeps the latest complete frame in memory; the UI polls the in-memory snapshot quickly only until the first frame arrives, then follows the selected 0.5/1/2/5 second live-metric cadence.
- Optional Agent mode installs and starts bundled package `com.cozyla.adbmanager.agent` from `src-tauri/resources/agent/adb-manager-agent.apk`, forwards `tcp:0` to `localabstract:adb_manager_agent`, checks `/health`, and then samples `/samples/stream`; if the APK is missing, install fails, permissions are limited, or the socket disconnects, the UI clearly reports the status and keeps using ADB-only sampling.
- Agent status compares the installed/running Agent version and protocol with the bundled desktop APK. If the installed Agent is missing or may be stale, enabling Agent runs `adb install -r` with the bundled APK before start/connect so same-package same-signature upgrades preserve the Agent app data.
- If Android rejects the data-preserving update because of an incompatible signature, inconsistent certificate, or version downgrade, the desktop app reports the failure and does not automatically uninstall the old Agent. Manual uninstall remains a data-loss decision outside the automatic update path.
- `npm run build` first runs `scripts/ensure-agent-apk.mjs`, which rebuilds the bundled APK when local Android SDK/JDK tooling is available and the Agent source is newer; CI/package environments without Android tooling reuse the checked-in APK and fail only if the APK is missing.
- When Agent sampling is active, the frontend merges the Agent app/process/network sample with the latest ADB persistent-stream system sample and marks the source as `Agent + ADB`; Agent-only data never replaces unavailable system GPU, thermal, battery, storage, or `gfxinfo` probes.
- Slow probes run as background cache refreshers inside the same device-side shell so battery/thermal/storage/rendering probes do not block live CPU, memory, network, process, and GPU counter frames.
- Device metrics are tiered: CPU, memory, network, process state, and available GPU sysfs counters refresh on the selected live-metric cadence after the first stream frame; battery, thermal, storage, display, CPU frequency, and `dumpsys gpu` memory fallback remain slow probes at about 10 seconds.
- If the persistent stream cannot start or exits before producing data, the UI falls back to the compatible one-shot `adb_performance_sample` path.
- The compatible backend path returns one read-only sample per command and does not start a long-running device agent.
- The frontend watchdog allows 20 seconds per sample so a 2-second foreground probe plus a 10-second slow/frame probe does not falsely trip the UI timeout on wireless ADB.
- The frontend schedules the next automatic poll after the current sample completes, so slow wireless ADB does not queue overlapping probes.
- Manual "sample now" requests made while an automatic probe is in flight are queued once and run immediately after the active probe finishes; the button does not visually debounce during periodic sampling.

Metrics:

- App/process: package, PID, process state, raw process CPU jiffies, RSS/PSS, thread count.
- Device/system: raw system CPU jiffies, memory, battery, thermal state, CPU frequency, GPU utilization/frequency when exposed by Android sysfs, `dumpsys gpu` memory fallback when sysfs counters are permission-limited, network bytes, `/data` storage, display size/density/refresh.
- Agent: protocol/version/permission status, device timestamp, target package, foreground package when Usage Stats access is available, Agent-visible process memory/thread count, and Agent UID network counters.
- Rendering: attempts `dumpsys gfxinfo <package> framestats`; unsupported packages show the source as unavailable without blocking other metrics.

UI behavior:

- Shows App, Rendering, Device realtime, Device details, Live Trends, and Timeline areas; the four metric overview panels use a two-column desktop layout so dense values stay readable.
- Shows Agent mode status and sample source (`Agent + ADB`, `Agent`, `ADB only`, or `Agent unavailable`) without implying that ordinary APK permissions can unlock restricted system GPU counters.
- Shows stable running/paused state and last sample time without a live countdown.
- Keeps the live-metric interval selector aligned with the toolbar buttons; the selector uses an accessible label instead of a visible stacked label.
- Shows first-sample loading values and pauses auto sampling with a visible timeout if ADB does not return within the frontend watchdog window.
- Metric cards render a last-known display snapshot for cadence-based or permission-limited fields, so fast samples do not briefly clear slow metrics to `-`; Timeline and exports still keep the raw per-sample values.
- Metric cards show the upper limit and current utilization percentage only when the sample exposes a real max/total value: CPU/GPU frequency against max frequency, memory and storage against total capacity, and GPU process memory against total GPU memory when both values are available. Metrics that are already percentages, such as process CPU, system CPU, GPU usage, and jank, remain plain percentages without a synthetic `100%` limit.
- Adds a GPU diagnostics card that explains whether usage counters, frequency counters, GPU memory, and frame stats are available, permission-limited, or missing based only on the existing sample fields and raw probe lines; the card is collapsed by default, expands into a two-row diagnostic layout, and keeps raw probe output behind a second disclosure.
- Keeps a rolling 15-minute sample window in frontend state.
- Computes CPU percentages and network rates from adjacent samples.
- Draws lightweight SVG trend charts for CPU, GPU, RSS, memory, P95 frame time, and network metrics from the same rolling samples.
- Warns on missing target process, elevated thermal state, battery temperature at or above 45 C, and RSS growth over 20% in 5 minutes; jank remains visible as a metric/trend but does not raise a transient warning banner.
- Exports JSON or CSV containing metadata, sampling intervals, and retained samples.

## 15. Scout Agent Tasks

Goal: provide a Scout-branded, session-based Agent task workspace where the AI Agent owns the conversation and task reasoning while ADB Manager provides typed, protected-boundary-aware device tools and automatic local evidence capture.

Frontend:

- `AgentCopilot.tsx`
- `App.tsx`
- `androidAgentSkills.ts`
- `agentCliSettings.ts`
- `Settings.tsx`

Local optional evidence shortcut sources:

- `docs/agent-skills/device-report.md`
- `docs/agent-skills/performance-triage.md`
- `docs/agent-skills/black-screen-triage.md`
- `docs/agent-skills/calendar-sync-triage.md`
- `docs/agent-skills/install-failure-triage.md`
- `docs/agent-skills/wireless-adb-triage.md`
- `docs/agent-skills/input-touch-triage.md`
- `docs/agent-skills/package-state-triage.md`
- `docs/agent-skills/network-triage.md`
- `docs/agent-skills/logcat-crash-triage.md`
- `docs/agent-skills/storage-pressure-triage.md`

Backend commands used:

- `adb_workbench_execute`
- `agent_cli_analyze`
- Performance Agent commands when the user enables Agent mode in the Performance tab.

Behavior:

- The Agent tab is labeled as Agent Tasks and is separate from the Performance tab.
- The Agent Tasks workspace uses a task-console layout: Chat, Feature Walkthrough, and Bug Repro are first-class icon tabs with tab semantics, current-state marking, focus styling, and arrow-key navigation. Recent chats are shown only while Chat is selected; Feature Walkthrough and Bug Repro each show their own recent task-record list in the left task console, and the main evidence panel shows the active task or the selected historical task timeline for that mode. The console also owns compact readiness chips for Agent APK, Scout accessibility control, and Agent runtime/CLI health. The previous numbered task cards and full-width "active task" card are not shown; active task state and controls are visible in the selected Walkthrough or Bug Repro evidence panel, not inside the normal Chat message stream.
- The task-console heading and each Chat, Feature Walkthrough, and Bug Repro tab show only the concise title; explanatory subtitles are intentionally omitted.
- The main Agent Tasks panel does not repeat the Chat/Walkthrough/Bug Repro segmented switch and does not render full-width Agent APK, accessibility, or CLI status cards. Chat and each task draft expose an optional working-directory row; choosing a folder scopes future Agent CLI turns for that mode, clearing it returns to the selected CLI profile cwd, and leaving it blank never blocks sending or starting. Walkthrough and Bug Repro place the goal beside Start. Feature Walkthrough also exposes an optional installed-package picker and reference-link input; missing Figma MCP or Feishu CLI access is advisory rather than a start blocker. There is no execution-permission control: Start always creates a fully automatic task, without an additional explanatory notice in the start area. The start area can wrap instead of shrinking or clipping button text. The app supports automation-friendly tab entry through hashes such as `#agent` and the development-only `VITE_ADB_MANAGER_INITIAL_TAB=agent` environment variable, while default launch still opens the Device Console. Sessions are persisted under `agentCopilotSessions`.
- Scout is available only inside the Agent Tasks workspace. There is no global bottom-right icon or right-side Scout drawer, so Chat, Feature Walkthrough, and Bug Repro all share the same task-console structure and selected-device context.
- Clicking the Scout console runtime chip opens an independent modal overlay that checks configured CLI commands with `agent_cli_probe`, summarizes enabled model API provider configuration, and allows changing the current-device CLI profile before re-running the check.
- The app uses the global Cirrus design system stylesheet from `src/styles/system.css`: warm paper canvas, lavender veil surfaces, indigo primary controls, hairline borders, pill controls, and restrained editorial spacing. Because the app uses Mantine components and has some legacy Tailwind utility pages, `src/index.css` provides a global Mantine skin plus a temporary Tailwind palette bridge so Scout, device management, setup, install, package, media, settings, and other feature surfaces share the same visual language instead of reintroducing a separate blue/gray style.
- The Agent Tasks console checks the selected device's Agent APK install/update/connect status through `adb_agent_status` and surfaces it as a compact readiness chip instead of a full-width card. If the APK is missing or outdated, installing is explicit user action and then starts/connects the Agent so future turns can include APK sampling data. Starting a Walkthrough or Bug Repro record refreshes Agent APK status each time; if the APK is missing, outdated, or failed, Scout asks whether to continue without APK sampling before creating the record. Scout also checks whether the Agent APK accessibility service is enabled by reading `enabled_accessibility_services`; if it is disabled, the console chip can open Android Accessibility Settings for the user to enable ADB Manager Agent manually.
- The Scout task domain lives in `src/scoutTask/`. It owns start gates, active-task resolution, device binding, artifact append checks, report close/failure transitions, and Workbench auto-execute policy. `AgentCopilot.tsx` wires those rules to Tauri commands, Agent CLI, store persistence, screenshots, Logcat, Workbench, and export.
- Each session stores title, timestamps, selected device identity, optional per-session working directory, the most recently inferred evidence shortcut hint, selected CLI profile, message history, and message attachment metadata/text previews. Image attachment thumbnails and local source paths are UI preview metadata only; they are not expanded into the Agent prompt.
- Conversation titles and header badges stay conversational (`New chat` / `Chat`) unless the user prompt supplies a meaningful title; the default evidence shortcut must not appear as the task title or badge.
- Sending a prompt routes the conversation to the selected Agent CLI profile as a normal multi-turn agent prompt. It does not automatically execute a fixed embedded skill or collect evidence first.
- The Agent receives the user message, recent conversation, selected-device context, a default device/performance context only for general Chat and Bug Repro, the current optional evidence shortcut hint, active evidence compact timeline, attachment previews, available read-only tools, and protected-boundary rules. Feature Walkthrough starts without a device-status or performance baseline so the Agent stays focused on functional coverage and UI/behavior comparison. For a supplied Feishu/Lark reference it can use the host user's existing `lark-cli` user identity to read the document; for a supplied Figma reference it checks the host user's global Codex MCP state and offers a Connect Figma action that launches `codex mcp login figma` plus a browser-login link when OAuth is required. These integrations never copy credentials into ADB Manager.
- The Agent may answer directly, ask a follow-up question, or request typed tools by returning a JSON `toolCalls` block.
- Auto-approved read-only tools currently include foreground app/window focus, screenshot capture when a screenshot directory exists, Logcat snapshot, package list, the active evidence record, and performance context that prefers the active performance stream plus Agent APK samples when available. Feature Walkthrough does not request device summary or performance context by default; it escalates to those diagnostics only for an explicit request or an observed performance/reliability symptom.
- Tool calls execute through existing Tauri commands or the Workbench backend, preserving selected-device targeting and existing risk classification.
- Tool results are recorded into the conversation as command/evidence messages and then returned to the Agent for a follow-up response in the same conversation.
- Returned tool results are placed ahead of lower-priority conversation history in the Agent prompt. When the bounded tool-result payload is full, Scout truncates older results first so the latest observation/action result remains available to the next decision and terminal synthesis.
- Long assistant, system, and command messages are collapsed to a compact preview by default, with a one-line expand/collapse control; user messages and active thinking indicators remain fully visible.
- Mutating or expert ADB commands use the `workbench.request_adb_command` path with conservative risk classification. Every new Walkthrough/Bug Repro task is fully automatic: eligible low- and medium-risk requests execute immediately and return their result to the Agent. Protected requests do not produce approval cards; they return a structured blocker containing the blocked step, one required human action, and restart guidance so the Agent can finish remaining safe coverage and conclude with `BLOCKED_NEEDS_HUMAN` only when the boundary prevents completion. General Chat remains outside this autonomous task loop.
- Evidence records are user-facing, local, device-bound task records persisted under `evidenceSessions`. Starting captures the goal, optional Feature Walkthrough package/reference context, optional working directory, and an initial screen state, then binds a task-scoped Agent conversation. Once the task starts, its dialogue shows a compact context card with the original goal, selected package, reference link, and project path; optional omissions use a muted empty state, and a CLI-inherited project path is labeled as the default. Walkthrough screen-state evidence is centered on foreground/window, UI-visible state, and screenshots; performance or memory evidence is added only when diagnostic escalation is justified. In the evidence timeline, routine screen-state cards show a concise summary and keep foreground/window, device identity, Agent APK, and local screenshot paths behind an explicit details action; diagnostic/error states can open those details automatically. New records always normalize to `auto_execute`; older `read_only` / `semi_auto` values are retained only for storage compatibility and migrate to the fully automatic runtime contract when loaded. The active task conversation remains available for questions or correction while the Agent is running, with task-local attachments, device-identity checks, and per-device mutation serialization. Evidence is collected by the Agent through typed tools rather than manual note/capture controls. A validated terminal outcome is appended to the timeline, written as the final report, and closes the record automatically; runtime failures close as `FAILED`. The active-task footer exposes Stop task and Export. Stop remains available when the latest Agent turn has completed but the record is still active; it closes and preserves the record, discards queued turns, ignores late Agent output, and immediately releases the one-active-task gate. Completed history exposes Export. Export uses `export_evidence_package` to write a `.zip` with `report.md` plus available local artifact files under `assets/`; missing files are skipped and reported. Chat may read compact active-task context, but only the task-scoped conversation receives the autonomous execution loop.
- New Scout records start only from the dedicated Feature Walkthrough or Bug Repro mode; General Chat cannot create a record through an approval card. A validated terminal response becomes the report and closes the record automatically; there is no separate Wrap up or Stop-and-report step.
- A Scout start button remains clickable so unmet prerequisites report their precise reason instead of becoming an unexplained disabled control. Walkthrough and Bug Repro are independent concurrent task lanes: each may have one active record for the same selected device, and an active record in one does not block starting or viewing the other. Each lane closes its own record when its Agent reaches a terminal outcome. Pasting a native local file into either the task goal or Walkthrough reference field preserves its full local path rather than Finder's display name.
- Scout prompt rules treat UI reference access as explicit capability. If the goal or user message sounds like a UI/interface/visual/style/prototype/design walkthrough and no reference link or readable visual attachment is available, the Agent should first suggest that the user paste a prototype image, screenshot, Figma link, or Feishu/Lark link, while still allowing the user to continue. If an image attachment is only visible as metadata to the current Agent CLI, the Agent should ask for an accessible screenshot/export or design link before making UI-specific claims. If a Figma link is present, the Agent must not claim to read it unless Figma MCP is available in the current Agent CLI environment. If a Feishu/Lark link is present, the Agent must not claim to read it unless the Feishu CLI is connected and usable. Missing integrations are advisory warnings, not start blockers.
- Feature Walkthrough uses the task-level playbook at `docs/scout-skills/feature-walkthrough-review.md`. Scout establishes available expectations and reference access, maintains coverage as expected-versus-observed evidence, classifies observed issues and severity, distinguishes facts from user reports and inference, and reports covered scope, issues, evidence gaps, and next actions without a formal pass/fail verdict by default. Existing `docs/agent-skills/*` workflows remain optional evidence subroutines rather than mandatory walkthrough steps.
- Task-record proactivity is conservative. `quiet` records evidence only and generates a final report at the end. `key_moments` triggers Agent review on start, issue markers, every three new reviewable artifacts, and end. `live` additionally samples lightweight screen state every 15 seconds and skips unchanged foreground/context snapshots.
- Fully automatic execution depends on Scout control readiness for UI-level actions and never executes protected actions. The Agent has typed `ui.inspect`, `ui.tap`, `ui.swipe`, and `ui.press_back` tools: it reads the current UI hierarchy, performs one controlled navigation action, and immediately captures a fresh hierarchy plus screenshot evidence for the next decision. Before a tap, Scout resolves the request against that fresh hierarchy: valid coordinates select the smallest enabled clickable node, visible child text can resolve to its containing clickable parent, an exact text/content-description/resource-ID target can re-center a node that moved, and coordinates disambiguate repeated labels. Protected-action classification includes the requested target plus labels contained by the resolved clickable node, so parent resolution does not weaken the safety boundary. It may use up to 24 tool-request turns, followed by up to two terminal-only synthesis attempts that must consume the latest results instead of leaving the task at “waiting for results.” Scout accepts a no-tool response as terminal only when it declares `COMPLETED`, `BLOCKED_NEEDS_HUMAN`, or `FAILED` and does not still claim to be waiting; otherwise it retries. If terminal synthesis still misses the contract, Scout may generate a deterministic `COMPLETED` closeout only when a UI action succeeded, its post-action snapshot is non-empty and changed, and a goal-related visible node was observed; otherwise it generates a deterministic `FAILED` closeout from the latest tool summaries. When the Agent emits only repeated `ui.inspect`, Scout may execute one bounded safe overlay or goal-matched fallback, selecting only enabled nodes that are genuinely clickable or resolvable from a visible label/content description; non-clickable resource-ID-only children are excluded, and complete goal-token matches outrank substring matches. When the goal describes a selector, switch, toggle, setting, or mode, control-like resource IDs are preferred while directional IDs such as `*_left`, `*_right`, `*_prev`, or `*_next` are penalized. It also excludes generic package-name matches and targets already attempted without observable UI change; if the latest action still produces no observable page change, it closes as `FAILED` with that evidence instead of looping. If an accessibility snapshot is non-empty but semantically incomplete—for example, it contains repeated unlabeled clickable containers while omitting their text children—Scout falls back to the file-backed ADB UI hierarchy before resolving the next action. If an initial inspection or later UI action result is blocked by an Android ANR/crash dialog, ADB Manager records that state and runs a bounded recovery loop of at most five attempts per incident. Crash detection requires Android system-resource evidence, and each attempt prefers an enabled clickable Close app/关闭应用/确定-style recovery button, falls back to Back when no such button is available, and then reads the UI hierarchy again before deciding whether another attempt is needed. A recovered page continues through the normal task; only an unchanged crash dialog after all five attempts is recorded as a blocker. Missing Feishu/Figma access remains an evidence gap but does not by itself stop accessible device-side coverage. When the Agent APK accessibility service is enabled, node-level clicks, gestures, and Back use that service over its task-local socket. A tap first asks the accessible node or its clickable parent to perform `ACTION_CLICK`; if the vendor control rejects that action, the Agent falls back to an accessibility gesture at the resolved coordinates. When accessibility is unavailable, ADB Manager falls back to display-bounded `uiautomator` inspection and `adb input` interaction. Swipes, Back, ordinary navigation, Submit, Confirm, Continue, search clearing, and filter reset run directly. Destructive/data-loss, payment/purchase, account sign-in/sign-out, authorization/permission, device/settings reset, restart, permission grant/revoke, app-ops mutation, and equivalent targets return a protected-action blocker without an approval card. The blocker identifies the exact step, the single action the user must perform, and how to restart the task.
- For a Walkthrough with a selected target package, Scout launches that package before the first Agent turn and records a screen state, screenshot, and fresh UI snapshot, so an unrelated foreground app cannot be mistaken for the requested target. If the first or later UI snapshot explicitly contains zero nodes (for example, a screensaver surface), Scout treats the state as recoverable instead of terminal. It invokes the typed `app.launch` tool using the selected target package; without a selected package, it can use a unique goal match in the device launcher list (for example, Calendar/日历). The app launch records a screen state, screenshot, and fresh UI snapshot, then returns to the normal observe → act → verify loop. An unavailable or ambiguous target is an evidence gap, never a completed walkthrough.
- Task records do not claim system-wide touch observation. They record only ADB Manager-confirmed evidence such as foreground/window output, screenshots, conditionally collected performance context, Agent APK status, Remote audit entries, Logcat, Agent notes, and saved paths.
- Bug reproduction sessions are selected from the top-level Bug Repro mode and follow the same fully automatic lifecycle. The Agent captures screen state, screenshots, Logcat, and issue evidence when needed; there are no manual recording or issue-marker controls in the task footer.
- Checklist and test-plan files are uploaded as conversation attachments. The Agent can read bounded text previews and guide the walkthrough, but there is no separate Checklist evidence mode, item-status model, or checklist-specific export blocker.
- Embedded skills define bounded ADB evidence steps, trigger keywords, and acceptance criteria in local Markdown and in the app catalog, but the Scout UI no longer exposes a manual "run template" action. The current shortcut is only a hint in the Agent prompt, so the Agent can decide whether it matters.
- The conversation sends on Enter, keeps Shift+Enter for new lines, ignores Enter while an IME composition is active or just committing a candidate, auto-scrolls to the newest message, and renders Agent thinking as an in-thread animated message rather than a top progress bar.
- Switching away from the Agent Tasks workspace keeps visited tabs mounted, so an in-flight Agent turn continues and is visible again when the user returns to Agent Tasks.
- The conversation composer shows five randomly selected practical prompt suggestions from a larger localized scenario pool whenever a new conversation is opened. Clicking a suggestion sends it to the same agentic conversation path as typed prompts.
- The conversation composer accepts multiple attachments from the file picker, direct clipboard file/image paste, and Finder-copied local files resolved through the desktop pasteboard. Image files show compact thumbnails in the composer and message stream, and all attachments can be clicked for a modal preview. Text-like files are stored with bounded previews for skill matching and message context; image thumbnails and large or binary files keep metadata only in the Agent prompt.
- Built-in Codex CLI turns use `codex exec` with ephemeral session state, stdin prompt input, read-only sandboxing, and last-message output capture. Autonomous Scout turns use `medium` when the profile has no explicit effort override; an explicit user-selected model/effort remains authoritative. The desktop backend uses the bounded non-stream completion path for Codex so a descendant holding stdout open cannot strand a task in Running; the final answer still comes from `output-last-message`. During a turn, the desktop backend may forward safe Agent-message snapshots over a task-scoped Tauri event; the active Walkthrough or Bug Repro panel always shows an animated thinking card while the CLI/reviewer turn is live. It never exposes private reasoning. The app adds read-only sandboxing by default, but it does not force an approval policy and respects user-provided Codex profile args such as `--yolo`, `--dangerously-bypass-approvals-and-sandbox`, or an explicit `--sandbox` override. Built-in Claude Code turns use `claude --print --output-format text`; selected Claude model and effort overrides are passed through `--model` and `--effort`. Custom CLI profiles receive the conversation prompt on stdin with the user-configured args.
- If the Agent CLI is unavailable, times out, exits without useful output, or is not configured, Scout surfaces the runtime gap instead of pretending a real agent answered. Built-in stdout/stderr analysis remains available only for explicit evidence shortcut collection.
- Local diagnostic document paths such as `docs/agent-skills/device-report.md` render as clickable links when they appear in messages and open through the desktop app; repo-relative links are resolved against the project root before opening.
- Settings uses a full-screen panel for Agent runtime configuration rather than a small modal. Agent CLI settings are global by default. Built-in profiles are Codex CLI and Claude Code. Their model field is an editable autocomplete populated from local runtime discovery, and their effort field is a clearable dropdown; clearing either follows the local CLI configuration. Codex effort choices follow the selected model. Claude uses CLI aliases/current configuration for model suggestions and accepts a manually entered full model ID. Custom CLI command, args, and working directory remain editable. The custom working directory accepts pasted local paths or `file://` folder URLs and also has a folder picker button.
- Settings also exposes Provider configuration: a default provider selector and local OpenAI-compatible / Anthropic API provider fields for enablement, Base URL, model, and API key. API providers are checked as configuration during manual runtime health checks; direct conversation and Scout task execution remain on the CLI path until model-provider execution is added.
- The Agent Tasks console shows the current-device runtime as a compact chip; clicking it opens the runtime health modal with current-device CLI override selection. Global CLI and model provider settings remain in Settings.

Boundaries:

- The ordinary APK Agent remains an optional helper, not a system app.
- APK-limited data is labeled as such. ADB remains the source for system CPU, thermal, display, GPU, storage, and `gfxinfo` probes.
- Missing device, missing CLI command, unavailable command output, and permission limits are surfaced as evidence gaps.
- Protected actions are not executed by fully automatic Scout tasks. They return a structured guided blocker instead of an approval card. General Chat and the manual ADB Workbench keep their own explicit confirmation policies and do not inherit Scout's autonomous loop.

## 16. Settings, Language, And Updater

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

- Settings opens as a full-screen workspace that reuses the Cirrus app shell language: paper canvas, lavender section surfaces, indigo primary actions, hairline separation, and the same compact card anatomy as the rest of the app.
- Language preference: system, English, Chinese.
- Screenshot directory.
- Recording directory.
- Automatic update checks.
- Agent CLI global default and custom profile fields. Current-device CLI overrides live in the Agent Tasks CLI panel.
- Settings detects local Codex CLI and Claude Code availability, version, allowlisted configured model/effort values, and safe model/effort candidates without returning credentials, API keys, tokens, or arbitrary configuration values. Codex reads its local model catalog and model-specific effort choices. Claude reads locally documented aliases and effort choices; because Claude exposes no full machine-readable model catalog, its model autocomplete remains editable. Empty Scout overrides follow local CLI configuration; non-empty Codex and Claude profile overrides append their matching model and effort arguments.
- Model API provider fields are explicitly experimental configuration only. They do not select or execute the current Scout runtime until a direct provider adapter exists.

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

## 17. OS Integration And External URLs

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
