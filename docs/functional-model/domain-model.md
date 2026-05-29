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
| `deviceNotes` | `Record<deviceIdentityKey, note>` | `DeviceList.tsx`, `DeviceConsole.tsx` |
| `pairConnect` | `PairConnectSettings` | `PairConnect.tsx` |
| `adbStartupRepair` | `AdbStartupRepairState` | `startupAdbRepair.ts`, `PairConnect.tsx` |
| `workbenchTemplates` | Saved workbench templates | `AdbWorkbench.tsx` |
| `workbenchHistory` | Last 30 workbench executions | `AdbWorkbench.tsx` |

`AppSettings`

- `screenshotDir`
- `recordingDir`
- `recentApkDir`
- `languagePreference`: `system`, `en-US`, or `zh-CN`
- `autoCheckUpdates`: default enabled unless explicitly false

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
