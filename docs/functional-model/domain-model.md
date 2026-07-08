# Domain Model

## Core Device Types

`DeviceInfo`

| Field | Meaning |
| --- | --- |
| `serial` | ADB serial. USB devices use a hardware-looking serial; wireless devices usually use `ip:port` or mDNS-style serial. |
| `device_sn` | Device-reported `ro.serialno`, cached by backend when possible. Preferred identity for display and notes. |
| `state` | `device`, `offline`, `unauthorized`, or local-only `disconnected`. |
| `model` | Parsed from `adb devices -l` or previously stored history. |
| `product` | Parsed from `adb devices -l` or history. |
| `connection_type` | Inferred as `usb`, `wireless`, or `unknown`. |

`DeviceSummary`

Collected on demand for the selected online device:

- Android version and API level
- Build tags, verified boot, vbmeta state, bootloader state
- Battery level/status
- Display size, density, and physical size in mm
- Storage summary
- Foreground app
- Security patch, SELinux, uptime, CPU ABI, build fingerprint

`DeviceHistoryItem`

Extends `DeviceInfo` with `lastSeen`. Online devices update history; historical devices are shown as `disconnected` when absent from current `adb devices -l`.

## Wireless Types

`MdnsDevice`

| Field | Meaning |
| --- | --- |
| `service_name` | mDNS service name reported by `adb mdns services`. |
| `service_type` | Usually pair or connect service type. |
| `ip` | Device IP. |
| `port` | Current pair/connect port. |
| `address` | `ip:port`. |
| `connectable` | True for connect service, false for pair service. |

`RecentConnectEndpoint`

| Field | Meaning |
| --- | --- |
| `ip` | Last known wireless device IP. |
| `port` | Last known connect port. May be refreshed from current mDNS or connected devices. |
| `lastConnectedAt` | Local timestamp used for sorting and display. |

Recent endpoint rules:

- Limit is 5.
- Endpoints are deduped by `ip:port`.
- Current connected wireless devices can teach new recent endpoints.
- Reconnect can replace a stale port with the current mDNS connect port for the same IP.

## Settings And Store Keys

Tauri store path: `settings.json`.

| Key | Data | Owner |
| --- | --- | --- |
| `settings` | `AppSettings` | `App.tsx`, `Settings.tsx` |
| `deviceHistory` | `DeviceHistoryItem[]` | `useDevices.ts` |
| `deviceNotes` | `Record<deviceIdentityKey, note>` | `DevicePanel.tsx`, `DeviceConsole.tsx` |
| `pairConnect` | `PairConnectSettings` | `PairConnect.tsx` |
| `adbStartupRepair` | `AdbStartupRepairState` | `startupAdbRepair.ts`, `PairConnect.tsx` |
| `workbenchTemplates` | Saved workbench templates | `AdbWorkbench.tsx` |
| `workbenchHistory` | Last 30 workbench executions | `AdbWorkbench.tsx` |
| `agentCopilotSessions` | `AgentCopilotSession[]` | `AgentCopilot.tsx` |
| `evidenceSessions` | `EvidenceSession[]` | `AgentCopilot.tsx` |

`AppSettings`

- `screenshotDir`
- `recordingDir`
- `recentApkDir`
- `languagePreference`: `system`, `en-US`, or `zh-CN`
- `autoCheckUpdates`: default enabled unless explicitly false
- `agentCli`: global Agent CLI profile settings, custom CLI fields, and current-device profile overrides edited from Agent Tasks
- `agentProviders`: default Agent runtime provider plus enabled model API provider configuration

`AgentCliSettings`

- `globalProfileId`: default profile for all devices.
- `profiles`: built-in Codex CLI / Claude Code profiles plus an editable custom CLI profile.
- `perDeviceProfileIds`: optional overrides keyed by `device_sn || serial`; these are stored in settings and edited from the Agent Tasks runtime health modal, while global CLI profiles remain in Settings.

`AgentProviderSettings`

- `defaultProviderId`: default runtime provider id shown in Settings. It may point to a CLI profile or a configured model API provider.
- `apiProviders`: local model API provider configs for OpenAI-compatible and Anthropic-style APIs, including enabled state, base URL, model, and API key. These are local settings; current conversational execution still uses the CLI runtime path until direct model-provider execution is implemented.

`AgentCopilotSession`

- `id`, `title`, `createdAt`, `updatedAt`
- `deviceKey`, `deviceSerial`
- `skillId`: the most recently inferred embedded evidence shortcut hint for the conversation. Normal chat is agent-driven and does not show or automatically run this template.
- `cliProfileId`
- `workingDirectory`: optional per-conversation Agent CLI working directory. When unset, execution falls back to the selected CLI profile working directory.
- `messages`: user, assistant, system, and command evidence messages. User messages may include attachment metadata and bounded text previews.

`EvidenceSession`

- `id`, `kind`, `status`, `title`, `createdAt`, `updatedAt`, optional `closedAt`
- `deviceKey`, `deviceSerial`: binds the evidence session to the selected device when available.
- `workingDirectory`: optional per-task Agent CLI working directory shared by Walkthrough or Bug Repro turns. It does not participate in the start gate and falls back to the selected CLI profile working directory when unset.
- `capturePolicy`: screenshot, Remote audit snapshot, and issue-time Logcat behavior.
- `scribe`: optional task-recorder state with enabled flag, proactive intensity (`quiet`, `key_moments`, `live`), execution permission (`read_only`, `semi_auto`, `auto_execute`), goal, last reviewed artifact id, summaries, and next action. The field name remains `scribe` for historical record compatibility; missing `scribe` means a historical plain evidence record.
- `artifacts`: screenshot, recording, Logcat, note, issue marker, Remote audit, screen-state, and Agent note evidence.
- Checklist or test-plan files are represented as `AgentCopilotAttachment` context, not as `EvidenceSession` fields.

`ScoutTask` bounded context

- Implemented in `src/scoutTask/`; it is a frontend bounded context around the persisted `EvidenceSession` record rather than a replacement store schema.
- Public commands: `StartTask`, `AddArtifact`, `RunAgentTurn`, `RequestTool`, `AutoExecuteTool`, `RequestApproval`, `StopAndGenerateReport`, and `CloseTask`.
- Public events: `ScoutTaskStarted`, `ArtifactAdded`, `AgentRunStarted`, `ToolAutoExecuted`, `ApprovalRequested`, `FinalReportGenerated`, `ScoutTaskClosed`, and `ScoutTaskFailed`.
- `ScoutTaskRunState` is derived for UI as `not_started`, `running`, `generating_report`, `completed`, or `failed`; the persisted `EvidenceSession.status` remains `active | closed` for compatibility.
- Start gates require a selected device, available Agent CLI runtime, configured screenshot/artifact directory, non-empty goal, and no other running task. Model API provider settings are probe/configuration metadata until a direct execution adapter exists.
- The optional task working directory is task context, not readiness: it is persisted when provided, included in Scout prompts, and passed as the Agent CLI cwd, but leaving it blank never blocks start.
- Artifact append checks the active task device identity (`device_sn || serial`) and rejects evidence from a different current device.
- Report generation failure emits `ScoutTaskFailed`, keeps the task active, stores a retry-oriented `scribe.nextAction`, and lets the user retry instead of silently closing the record.

## Selection Model

Device selection is resolved by `resolveVisibleSelectedDevice`.

Rules:

1. If there is no selected serial, choose the first visible online device.
2. If the selected serial is still visible and online, keep it.
3. If the selected serial is online but hidden behind a changed wireless serial, match by `device_sn || serial`.
4. If no match exists, choose the first visible online device.

This preserves the selected physical device across wireless port changes when `device_sn` is available.

## Device Form Factor

`classifyDeviceFormFactor` returns:

- `phone`
- `tablet`
- `largeScreen`

Classification prefers physical mm size. If unavailable, it computes diagonal inches from display pixels and density.

Thresholds:

- Tablet: at least 7 inches
- Large screen: at least 15.6 inches

## Backend Runtime State

`AppState` contains process and operation locks:

- `adb_server_operation`: serializes pair/connect/restart/reset/disconnect.
- `recording`: one active screenrecord process with its device serial and remote path, guarded by one mutex so the fields change atomically.
- `logcat_process`, `logcat_device`: one active streaming logcat process.
- `scrcpy_process`, `scrcpy_device`: one active screen mirror process.
- `scrcpy_installing`: prevents concurrent scrcpy installs.
- `installing`: prevents concurrent APK installs.
- `device_sn_cache`: avoids repeated `ro.serialno` calls.

## Remote Control App Drawer

`LaunchableApp` represents one activity that Android exposes through `MAIN` + `LAUNCHER`:

- `package_name`: Android package name.
- `activity_name`: fully qualified activity class.
- `component_name`: launch component used by `am start -n`.
- `label`: manifest/resource label when parsed, otherwise a local fallback derived from the package name.
- `icon_data_url`: PNG/WebP app icon encoded as a data URL when APK resource parsing succeeds; extraction supports direct bitmap resources and adaptive icon XML foreground/bitmap references. The value is `null` when APK pull or icon parsing fails.

App icon cache:

- Stored under the Tauri app cache directory in `app-icons/*.json`.
- Cache identity is based on selected device identity, package name, and activity name.
- Entries store `remote_path`, `label`, `icon_data_url`, `cached_at_unix`, `verified_at_unix`, and a failure flag.
- Fresh cache returns without ADB work. Entries older than 24 hours are returned immediately with a stale flag so the frontend can refresh them in the background.
- Rebuild triggers are APK path change, cache age of 7 days, or stale failed extraction.

App drawer groups are derived in the frontend from each package name. For `com.<namespace>.*`, the namespace becomes the group key and the displayed title uses an initial capital letter. `com.elclcd.*` is normalized into the Cozyla group.

## Workbench Model

Workbench modes:

- `library`: built-in catalog actions and templates.
- `templates`: user-saved commands.
- `custom`: freeform command entry.

Risk levels:

- `low`: read-only or low-impact commands.
- `medium`: install, push, setprop, settings put, force-stop, permission grant/revoke.
- `high`: uninstall, reboot, rm, dd, pm clear.

Execution result:

- Normalized preview command.
- Risk level.
- Exit code.
- stdout/stderr.
- Saved history item with mode, item id, parameter values, custom command, and success flag.

## Display Color Control Model

Display color control is exposed through the Display Color diagnostics tab. The UI is intentionally ADB Manager-driven: the app owns desired values and export payloads, while the physical device screen is the preview surface.

`DisplayCalibrationControlDefinition`

- `id`: stable UI control id.
- `parameterName`: supplier-facing parameter path or service method.
- `kind`: `slider`, `toggle`, `integer`, or `point`.
- `target`: the concrete write/read target.
- `min`, `max`, `step`, `defaultValue`: input constraints for sliders/toggles.
- `requiresHelper`: true when the control maps to the vendor display service instead of ordinary ADB settings.
- `source`: evidence source, currently Settings APK mapping or Android settings.

`DisplayCalibrationSnapshot`

- `capturedAt`: local capture timestamp.
- `deviceSerial`: explicit selected ADB serial.
- `probes`: bounded raw outputs from settings, properties, display dumps, likely services, likely sysfs nodes, and display-related Logcat.
- `candidates`: extracted likely display/PQ/backlight/color entries.

`DisplayCalibrationTarget`

- `settings`: namespace plus key.
- `systemProperty`: property key.
- `sysfs`: file path under `/sys/`.
- `vendorDisplay`: vendor service name, display id, operation, optional component id, read method, and write method. The Settings APK mapping currently uses `vendor.display.output.IDisplayOutputManager/default`; Bright/Contrast/Saturation are `enhanceComponent` ids `1`, `2`, and `6`.

`DisplayCalibrationProfile`

- `profileName`
- `device`: ADB serial, optional SN/model/build/firmware identity.
- `parameters`: name, target, baseline value, desired value, readback value, visible-effect confirmation, physical-validation flag, and notes.
- `notes`: supplier-facing context.

Rules:

- ADB Manager is the desired-value source; the device is the preview/effect surface.
- Fixed device controls are the primary workflow. Snapshot and diff are read-only advanced diagnostics.
- Refresh reads fixed controls directly and stores per-control current/reference values and per-row status.
- Apply is mutating, requires explicit confirmation in the UI, and shows per-control status immediately without running the slow advanced snapshot path.
- Settings-backed controls can be written directly through ADB. Known firmware property controls are written through `setprop`, read back through `getprop`, then immediately applied through the packaged display helper when the corresponding vendor service method is known. Vendor-display controls run through the same helper, but production firmware may still deny shell-to-HAL access until firmware or a privileged bridge allows it.
- Export distinguishes software-visible readback from physical panel validation.

## Error Model

Backend errors are serialized as localized strings through `AdbError`.

Main variants:

- ADB missing
- Command failed with detail
- Command timed out
- No device
- Already recording
- Not recording
- I/O error

Frontend convention:

- Operational failures are shown inline in the owning tool.
- Update network errors are translated into user-facing update-specific copy.
- Store persistence failures for convenience data are usually ignored to keep core operations responsive.
