# Command Map

This map connects user-facing actions to frontend code, Tauri commands, and backend behavior.

## Device And Wireless

| Feature | Frontend | Tauri command | Backend behavior |
| --- | --- | --- | --- |
| List devices | `useDevices.ts` | `adb_devices` | Runs `adb devices -l`, parses rows, enriches SN via `ro.serialno`, infers USB/wireless. |
| Device summary | `DeviceConsole.tsx` | `adb_device_summary` | Runs multiple `getprop`, `dumpsys`, `wm`, `df`, `getenforce`, `uptime` commands and parses summary. |
| mDNS scan | `PairConnect.tsx` | `adb_mdns_discover` | Runs `adb mdns services`, and on macOS falls back to system `dns-sd` when ADB mDNS returns no services. |
| mDNS connect | `PairConnect.tsx` | `adb_auto_connect` | Connects to mDNS connect service address. |
| mDNS auto-connect all | `PairConnect.tsx` | `adb_mdns_auto_connect` | Uses mDNS service output and attempts connection. |
| Pair | `PairConnect.tsx` | `adb_pair` | Runs `adb pair ip:port code`, retries once after a pairing-preserving ADB restart on retriable transport errors, then connects the current mDNS connect port for the same IP. |
| Manual connect | `PairConnect.tsx` | `adb_connect` | Runs `adb connect ip:port`, then falls back to the current mDNS connect port and ADB mDNS auto-connect for same IP. |
| Recent reconnect | `PairConnect.tsx` | `adb_reconnect_endpoint` | Disconnects endpoint, optionally restarts ADB, connects, optionally retries/falls back to mDNS. |
| Restart ADB | `PairConnect.tsx` | `adb_restart_server` | Backs up/removes `adb_known_hosts.pb`, preserves host keys, disconnects, kills server, waits for port 5037 close, force-kills matching server if needed, starts and waits. |
| Repair wireless pairing | `PairConnect.tsx` | `adb_repair_wireless_pairing` | Backs up/removes only `adb_known_hosts.pb`, preserves `adbkey` and `adbkey.pub`, then restarts ADB. |
| Reset host identity | `PairConnect.tsx` | `adb_reset_host_identity` | Backs up/removes `adb_known_hosts.pb`, `adbkey`, `adbkey.pub`, then starts ADB. |
| Disconnect endpoint | `PairConnect.tsx` | `adb_disconnect` | Runs `adb disconnect ip:port`. |
| Local IPs | `PairConnect.tsx` | `get_local_ipv4_addresses` | Reads host private IPv4 addresses for network filtering. |
| TCP probe | `PairConnect.tsx` | `tcp_probe_endpoint` | Attempts socket connect to endpoint. |

## Tool Tabs

| Feature | Frontend | Tauri command | Backend behavior |
| --- | --- | --- | --- |
| APK install | `ApkInstall.tsx` | `adb_install` | Optional uninstall, then `adb install` with install lock. |
| Parse APK package | `ApkInstall.tsx` | `parse_apk_package` | Reads APK zip and binary manifest package name. |
| Resolve APK paths | `ApkInstall.tsx` | `resolve_apk_paths` | Recursively expands folders to `.apk`, dedupes paths. |
| Clipboard APK paths | `ApkInstall.tsx` | `read_clipboard_apk_paths` | Reads macOS file pasteboard or text paths, then resolves APKs. |
| Screenshot | `Screenshot.tsx` | `adb_screenshot` | `screencap` to device temp path, pull local PNG, remove remote temp. |
| Start recording | `ScreenRecord.tsx` | `adb_start_recording` | Spawns `adb shell screenrecord <remote>`, stores child process. |
| Stop recording | `ScreenRecord.tsx` | `adb_stop_recording` | Kills child, pulls MP4, removes remote temp. |
| Mirror availability | `ScreenMirror.tsx` | `check_scrcpy_available` | Checks bundled/system scrcpy path. |
| Install scrcpy | `ScreenMirror.tsx` | `install_scrcpy` | macOS Homebrew install or Windows GitHub zip install. |
| Start mirror | `ScreenMirror.tsx` | `start_screen_mirror` | Verifies device online, refuses root ADB shell (`id -u == 0`) to avoid userdebug reboot risk, then spawns scrcpy and tracks process. |
| Stop mirror | `ScreenMirror.tsx` | `stop_screen_mirror` | Kills tracked scrcpy process. |
| Mirror state | `ScreenMirror.tsx` | `get_screen_mirror_state` | Checks whether tracked scrcpy process is still alive. |
| Navigation key | `ScreenMirror.tsx` | `send_navigation_key` | Sends Back/Home through `input keyevent`. |
| Remote console status | `RemoteControl.tsx` | `remote_control_status` | Reads whether the embedded `/remote` gateway is enabled, plus localhost/LAN/Tailscale addresses, role invite links with QR SVG, trusted devices, sessions, control owner, stream defaults, QR, PIN state, and audit entries. |
| Remote console start | `RemoteControl.tsx` | `remote_control_start` | Starts the embedded HTTP/PWA gateway, preferring the last successful port before falling back to a random port, creates a one-time PIN admin fallback, and generates one-use viewer/operator/admin invite links. |
| Remote console stop | `RemoteControl.tsx` | `remote_control_stop` | Stops the gateway thread and clears the active PIN/token session, role invites, sessions, control owner, frame cache, and audit log. |
| Remote invite claim | `/remote` PWA | `/remote/api/invite/claim` | Exchanges a one-use role invite for an in-memory session token. |
| Remote trusted device management | `RemoteControl.tsx` | `remote_control_trusted_devices`, `remote_control_revoke_trusted_device`, `remote_control_revoke_all_trusted_devices` | Lists or revokes 7-day trusted browsers. Desktop persistence stores token hashes only, not raw trust tokens. |
| Remote PWA trust | `/remote` PWA | `/remote/api/trust/register`, `/trust/claim`, `/trust/devices`, `/trust/revoke`, `/trust/revoke-all` | Registers a browser trust token after session login, exchanges a valid trust token for a same-role session, and lets admin sessions inspect or revoke trusted devices. |
| Remote PWA devices | `/remote` PWA | `/remote/api/devices` | Lists devices through `adb devices -l`; requires token auth. |
| Remote PWA screenshot | `/remote` PWA | `/remote/api/screenshot` | Captures PNG through `exec-out screencap -p`; per-device screenshot refreshes are deduped and do not hold the input lock. |
| Remote PWA HLS stream | `/remote` PWA | `/remote/api/video-stream/start`, `/video-stream/stop`, `/video-stream/status`, `/video-stream/playlist.m3u8`, `/video-stream/segment/*` | Experimental V2.5 stream: pipes `screenrecord --output-format=h264 -` through host ffmpeg, serves token-scoped fMP4 HLS assets (`init.mp4` plus `.m4s` segments), probes playlist/media availability before playback, and stops the pipeline when Remote Control closes or browser playback fails. |
| Remote PWA MJPEG stream | `/remote` PWA | `/remote/api/stream.mjpeg` | Fallback stream: authenticates by token query, reuses recent per-device frames, converts screenshots to JPEG, streams multipart MJPEG, and is selected automatically when HLS startup or browser decode fails. |
| Remote PWA control owner | `/remote` PWA | `/remote/api/control/acquire`, `/control/release` | Lets one operator/admin hold input control; admin may force acquire. |
| Remote PWA input | `/remote` PWA | `/remote/api/tap`, `/swipe`, `/text`, `/clipboard`, `/key` | Sends only whitelisted input/clipboard actions; input actions require control ownership, are serialized, and are audited. |
| Remote PWA sessions | `/remote` PWA | `/remote/api/sessions`, `/sessions/kick` | Admin-only session listing and kick flow; kicking a controller releases control. |
| Remote PWA APK install | `/remote` PWA | `/remote/api/apk/install` | Admin-only single APK upload with size cap; writes temp host file, runs `adb install -r`, then removes temp file. |
| Remote PWA repair | `/remote` PWA | `/remote/api/admin/reconnect`, `/admin/repair-pairing` | Admin-only device reconnect and wireless pairing repair, reusing ADB Manager's ADB path and ADB server lock. |
| Remote PWA templates | `/remote` PWA | `/remote/api/templates`, `/templates/run` | Returns and runs fixed safe command templates; no arbitrary shell route is exposed. |
| App drawer list | `ScreenMirror.tsx` | `adb_list_launchable_apps` | Queries launchable MAIN/LAUNCHER activities, dedupes components, and returns the drawer list quickly. |
| App drawer icon | `ScreenMirror.tsx` | `adb_load_launchable_app_icon` | Returns cached label/icon data immediately when possible; revalidates stale entries, pulls one APK when needed, and parses manifest/resource metadata. |
| App drawer launch | `ScreenMirror.tsx` | `adb_launch_app` | Validates a package/activity component and starts it with `am start -n`. |
| Image preview | `ImageCast.tsx` | `read_image_preview_data_url` | Validates local image type/size and returns a data URL for UI preview without broad asset protocol access. |
| Image push/open | `ImageCast.tsx` | `adb_push_reference_image` | Validates image, creates remote dir, pushes, optional scan/open. |
| Reopen image | `ImageCast.tsx` | `adb_open_reference_image` | Validates remote path/MIME, optional scan, opens with VIEW intent. |
| Clipboard text | `Clipboard.tsx` | `adb_input_text` | Escapes text and runs `adb shell input text`. |
| Logcat snapshot | `Logcat.tsx` | `adb_read_logcat` | Runs `adb logcat -d -v threadtime -t <limit>`, parses lines. |
| Logcat stream start | `Logcat.tsx` | `adb_start_logcat` | Spawns `adb logcat -v threadtime`, emits parsed line events. |
| Logcat stream stop | `Logcat.tsx` | `adb_stop_logcat` | Kills tracked logcat process. |
| Performance stream | `PerformancePanel.tsx` | `adb_performance_stream_start`, `adb_performance_stream_snapshot`, `adb_performance_stream_stop` | Starts one persistent hidden `adb shell` sampler per selected device, parses complete frame markers into the latest in-memory sample, and lets the UI poll cached snapshots without repeatedly spawning host ADB processes; the selected interval controls the device-side fast sampler while slow probes refresh background caches. |
| Performance Agent | `PerformancePanel.tsx` | `adb_agent_status`, `adb_agent_install`, `adb_agent_start`, `adb_agent_connect`, `adb_agent_sample`, `adb_agent_stop` | Optional device-side APK helper installed from bundled resources, updated with `adb install -r` so same-signature upgrades preserve Agent app data, started as a foreground service, connected only through `adb forward tcp:0 localabstract:adb_manager_agent`, and merged with the ADB stream when available; missing APK, update/install/start/connect failures, and permission-limited health all fall back to ADB-only sampling. |
| Performance sample fallback | `PerformancePanel.tsx` | `adb_performance_sample` | Compatibility path for devices where the persistent stream is unavailable; samples foreground app detection plus ADB-only `/proc`, GPU sysfs counters, `dumpsys gpu` memory fallback, `wm`, `df`, thermal, battery, network, and optional `gfxinfo framestats`; the UI computes deltas, stable last-known metric cards, GPU availability diagnostics, configurable cadence, trend charts, warnings, retention, and export. |
| Package names | `PackageNameInput.tsx` | `adb_list_packages` | Runs `pm list packages`, strips `package:` prefix. |
| Package details | `PackageList.tsx` | `adb_list_package_details` | Parses `dumpsys package packages` plus build/SN properties. |
| Package info | `PackageList.tsx` | `adb_package_info` | Reads one package's version info plus build/SN properties. |
| Export package APK | `PackageList.tsx` | `adb_export_package_apk` | Reads `pm path`, pulls one or split APK files to Downloads. |
| Display color control board | `DisplayCalibrationLab.tsx`, `displayCalibration.ts`, `displayCalibrationControls.ts` | `adb_display_calibration_enable_root`, `adb_display_calibration_read_target`, `adb_display_calibration_apply`, `adb_display_calibration_snapshot` | Presents fixed Settings-derived controls for Color Enhance, Color Bright, Contrast, Saturation, Color Temperature value, Color Temperature wheel coordinate, and Smart backlight. Refresh reads each fixed control directly and shows per-row status; Color Bright/Contrast/Saturation use firmware-provided `persist.vendor.display.enhance_*` properties so ADB Manager can read/write the values under userdebug/root builds. Color Temperature value uses `settings system aw_color_temperature_value` and then calls the vendor display helper `setColorTemperature` with the same value for immediate screen refresh. The color wheel uses a clickable ADB Manager color wheel that mirrors Settings' 205-point coordinate space, writes `settings system srgb_color_temperature` as `x,y`, derives and writes the matching `aw_color_temperature_value` ARGB integer, and live-applies that value through `setEnhanceComponent` id `10` / sRGB white point. Empty property readback and Android settings `null` readback are treated as unset, not as valid values. The root action is explicit and warns that `adb root` may restart adbd, reboot the device, or disconnect mirroring on some firmware. Property-backed Bright/Contrast/Saturation writes immediately call the matching vendor display helper so the physical display applies the new value without manually touching the device Settings slider. Remaining vendor-display controls expose their real service/component metadata and run through the packaged display helper, surfacing firmware access-policy denials when the build blocks shell-to-HAL binder calls. |
| Display calibration snapshot | `DisplayCalibrationLab.tsx`, `displayCalibration.ts` | `adb_display_calibration_snapshot` | Resolves an mDNS service-name selection to the matching executable ADB transport when needed, captures settings, properties, display/SurfaceFlinger dumps, likely display services, sysfs candidates, and recent display-related logcat lines for the selected device, then extracts likely color/PQ/backlight candidates for advanced Display Color diagnostics. The primary Refresh Current action does not run this slow scan; Compare captures the current advanced snapshot only when the user asks for diff evidence. Individual probe timeouts are retained as failed probe records so fixed Display Color controls can refresh independently. |
| Display calibration diff | `displayCalibration.ts` | `adb_display_calibration_diff` | Compares two calibration snapshots and returns changed candidate values with writable targets when available; used as advanced evidence, not as the primary control workflow. |
| Display calibration apply | `DisplayCalibrationLab.tsx`, `displayCalibration.ts` | `adb_display_calibration_apply` | Resolves mDNS service-name selections before execution, requires explicit confirmation, validates target metadata and value, writes settings/property/sysfs targets through ADB, requires non-empty readback for system-property success, runs live vendor-display apply hooks for known firmware properties, and does not run the expensive advanced snapshot path after each single-control apply. |
| Display calibration test pattern | `DisplayCalibrationLab.tsx`, `displayCalibration.ts` | `adb_display_calibration_open_test_pattern` | Generates a local PNG with gray ramp, color patches, HSV disc, and edge patterns, pushes it to `/sdcard/Pictures/ADBManager`, media-scans it, and opens it on the device for physical-screen preview. |
| Display calibration export | `DisplayCalibrationLab.tsx`, `displayCalibration.ts` | `adb_display_calibration_build_export` | Builds JSON and Markdown profile payloads for firmware and hardware suppliers, listing fixed Settings-derived controls first and including target paths/service metadata, baseline/desired/readback values, helper notes, visible-effect state, and physical validation notes. |
| Scout Agent conversation | `App.tsx`, `AgentCopilot.tsx` | `agent_cli_analyze`, `agent_cli_probe` | Opens from the Agent Tasks tab. The Scout workspace defaults to Feature Walkthrough, exposes Chat and Bug Repro as peer task choices, and lets either record mode submit a current-record prompt back into the same conversation stream. The CLI/model readiness chip includes a manual runtime health-check action that opens an independent modal, checks configured CLI commands with `--version`, and reports enabled API provider configuration. Each turn sends the user prompt, recent conversation, selected-device context, default device/performance context, current optional evidence shortcut hint, available tool contract, and returned tool results to the selected Agent CLI. Codex uses `codex exec` with read-only sandboxing by default unless the profile args provide `--yolo`, danger bypass, or an explicit sandbox override; Claude uses print mode, and custom CLIs receive the prompt on stdin. |
| Scout Agent APK and control check | `AgentCopilot.tsx` | `adb_agent_status`, `adb_agent_install`, `adb_agent_start`, `adb_agent_connect`, `adb_workbench_execute` | The Agent Tasks console checks the selected device's Agent APK status and shows it as a compact readiness chip. Missing or update-available states show an explicit install/update action; user-approved installation starts and connects the Agent so future default context can include APK sampling. Starting a Walkthrough or Bug Repro record refreshes Agent APK status every time; if the APK is missing, outdated, or failed, Scout asks whether to continue without APK sampling instead of silently downgrading. Scout also reads `enabled_accessibility_services` through the Workbench executor and can open Android Accessibility Settings with `am start -a android.settings.ACCESSIBILITY_SETTINGS` so the user can manually enable the Agent accessibility service. |
| Scout typed tools | `AgentCopilot.tsx` | `adb_device_summary`, `adb_workbench_execute`, `adb_screenshot`, `adb_read_logcat`, `adb_list_packages`, `adb_performance_sample`, `adb_performance_stream_snapshot`, `adb_agent_status`, `adb_agent_sample` | Executes auto-approved read-only tool requests returned by the Agent as structured `toolCalls`, including the local-only `evidence.get_active_record` tool, records results into the conversation, and returns those results to the Agent for the next response. Performance context merges active stream data, ADB one-shot sampling, and Agent APK sampling when available. |
| Scout approval card | `AgentCopilot.tsx` | `adb_workbench_execute` | Renders Agent-requested raw ADB commands as approval cards first. The command is only executed through Workbench after the user chooses allow once; denial is recorded as a command result. |
| Scout evidence record | `AgentCopilot.tsx` | `adb_screenshot`, `read_image_preview_data_url`, `adb_start_recording`, `adb_stop_recording`, `adb_read_logcat`, `remote_control_status`, `export_evidence_package`, `agent_cli_analyze` | Captures walkthrough and Bug repro artifacts into persisted `evidenceSessions`, including screenshots, recordings, issue-time Logcat, Remote audit snapshots, notes, screen-state snapshots, Agent notes, and Markdown report export. Screenshot previews use validated data URLs. Export writes a `.zip` package containing `report.md` plus available local artifact files under `assets/`. Full controls and timelines live in Walkthrough or Bug Repro mode; each mode has its own recent-record list that stretches to the available panel height, while Chat mode shows only a compact active-record strip that links back to the matching mode. The record footer exposes an indigo start / citrus stop Agent control instead of a freeform "send to Agent" footer, and the older separate header End action is not shown. Checklist or test-plan material is uploaded as conversation attachments instead of starting a separate evidence mode. |
| Scout evidence shortcut hint | `AgentCopilot.tsx` | `agent_cli_analyze` | Infers a possible embedded diagnostic template from prompt and attachment context, but passes it only as Agent prompt context. There is no manual run-template card in the conversation UI. |
| Workbench execute | `AdbWorkbench.tsx` | `adb_workbench_execute` | Parses/normalizes ADB subcommand, classifies risk, runs with timeout. |
| Export text | `AdbWorkbench.tsx`, `Logcat.tsx` | `export_text_file` | Opens save dialog and writes text content. |

## Settings And OS

| Feature | Frontend | Tauri command | Backend behavior |
| --- | --- | --- | --- |
| Pick directory | `Settings.tsx` | `select_directory` | Opens folder picker. |
| Default save dir | `App.tsx` | `get_default_save_dir` | Creates/returns Pictures/ADB_Manager. |
| ADB availability | `App.tsx`, `AdbSetup` | `check_adb_available` | Resolves ADB path and executable state. |
| Install ADB | `AdbSetup` | `install_adb` | Downloads/extracts official platform-tools. |
| Reveal path | Multiple tools | `reveal_path` | Finder/Explorer reveal/open behavior. |
| Open file | Multiple tools | `open_file` | OS default opener for a local file. |
| Open external URL | Settings/help links | `open_external_url` | Allows only safelisted URLs. |
| Backend locale | `i18n.ts` | `set_locale` | Sets `rust_i18n` locale to `zh-CN` or `en`. |

## Events

| Event | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `global-screenshot-shortcut` | Tauri global shortcut plugin | `App.tsx` | Trigger screenshot behavior. |
| `global-record-shortcut` | Tauri global shortcut plugin | `App.tsx` | Trigger record start/stop behavior. |
| `adb-install-progress` | `install_adb` | Setup UI | ADB/platform-tools install progress. |
| `scrcpy-install-progress` | `install_scrcpy` | Mirror UI | scrcpy install progress. |
| `adb-logcat-line` | `adb_start_logcat` | Logcat UI | Streaming logcat entry. |

## Shared Backend Helpers

`src-tauri/src/adb.rs`

- Resolves bundled/system/SDK ADB path.
- Ensures Unix executable bit.
- Builds ADB commands with optional `-s <serial>`.
- Applies macOS terminal-like environment.
- Runs commands normally, with timeout, or with extra environment.
- Localizes errors through `AdbError`.

`src-tauri/src/process.rs`

- Creates all app-launched child processes through a shared hidden command helper.
- Applies `CREATE_NO_WINDOW` on Windows so ADB, ffmpeg, scrcpy, `taskkill`, `ipconfig`, Tailscale, Explorer/open helpers, and other host-side child processes do not flash console windows from the GUI app.
- Includes a regression test that rejects direct `Command::new(...)` usage outside the shared helper.

`src-tauri/src/state.rs`

- Holds global mutexes and active child processes.
- Prevents concurrent install, recording, logcat, scrcpy, and ADB server operations where needed.
- Tracks remote-control runtime, token session, role invites, remote sessions, control owner, input serialization, per-device screenshot refresh de-dupe, per-device MJPEG frame cache, and in-memory audit entries.
