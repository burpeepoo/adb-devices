# ADB Manager Product Capability Baseline

Last updated: 2026-07-06

## Purpose

This baseline turns the current ADB Manager product surface into an implementation-facing capability map. It is not a UI redesign, backlog split, or code migration plan. It is the product contract that future architecture work should use before adding features, moving modules, or splitting bounded contexts.

The current source of truth is the local working tree. Several files are already modified in this workspace, so this document treats the current working tree as the active design/implementation direction, not as a published-release claim.

Primary source documents:

- `docs/functional-model/product-overview.md`
- `docs/functional-model/domain-model.md`
- `docs/functional-model/feature-spec.md`
- `docs/functional-model/known-risks-and-open-questions.md`
- `docs/functional-model/command-map.md`
- `docs/functional-model/release-and-ops.md`
- `docs/product-design/scout-agent-task-architecture.md`
- `docs/product-design/adb-manager-optimization-audit-2026-06-18.md`

## Capability Statement

ADB Manager gives Cozyla engineers, QA/support users, and release maintainers a safe local Android device operations workspace. After the current Scout direction ships, the product promise is no longer "a visual shelf of ADB commands"; it is a selected-device workbench with professional tools, explicit risk controls, Scout-guided evidence tasks, and release/update trust surfaces.

The architecture should optimize for:

- Correct target-device binding before action.
- Traceable evidence before conclusions.
- Recoverable operations before destructive fallback.
- Professional ADB escape hatches without making raw shell the default product model.
- Scout as the user-facing guided layer, with Agent/APK/CLI/Provider remaining technical runtime configuration.

## Cross-Capability Invariants

- Device actions must bind to an explicit online selected device. Future tools must not pass an empty serial and rely on ADB's default target behavior.
- Device identity should prefer `device_sn`, then fall back to ADB `serial`; local notes, task evidence, and current-device overrides should use `device_sn || serial`.
- High-risk or destructive operations require explicit confirmation. Auto-execute may reduce friction only for allowed low/medium-risk actions inside a running task.
- Wireless repair preserves host identity by default. Removing `adbkey` is a separate host identity reset fallback.
- Scout can summarize and infer, but reports must distinguish recorded evidence, observed state changes, user notes, and Scout inference.
- Remote Control exposes scoped browser/PWA access to ADB Manager only; it must not expose arbitrary shell or the host desktop.
- Display Color exports must distinguish software-visible readback from physical panel validation.
- Agent APK data is supplemental unless a capability contract says otherwise; ADB Manager remains the source for system-level device probes.

## Capability Map

### 1. Current Device Workspace

Actors:

- Cozyla engineers, QA/support users, and operators working with one or more Android/Cozyla devices.

User-visible promise:

- The user can see the selected device, its stable identity, connection state, notes, health summary, and relevant shortcuts before running device actions.

Dependencies:

- `adb_devices`, `adb_device_summary`, selected-device state, `deviceHistory`, and `deviceNotes`.
- ADB path resolution and ADB server availability.

Data and evidence ownership:

- Device history and notes live in local Tauri store.
- Device summaries are loaded on demand and should be treated as current-state evidence, not continuously maintained inventory.

Interfaces and command boundary:

- Frontend owns selection, visibility, notes, and tool routing.
- Backend owns ADB device parsing, SN enrichment, and summary probes.

Safety, failure, and non-claims:

- Disconnected historical devices may remain visible, but they are not actionable targets.
- A note/name is local operator metadata, not an asset-management system.
- If selected device changes from wireless port churn, matching by stable SN preserves continuity where possible.

Evolution invariant:

- New product surfaces should enter through the selected-device workspace or preserve its target context. Do not introduce a second global target model.

### 2. Connection And Recovery

Actors:

- Operators pairing wireless devices, reconnecting recent endpoints, or repairing ADB transport state.

User-visible promise:

- The user can pair/connect over wireless debugging, recover stale sessions, and understand when a repair is safe versus identity-destructive.

Dependencies:

- ADB server operation lock, mDNS discovery, recent endpoints, TCP probe state, local network addresses, and startup repair state.

Data and evidence ownership:

- Pair/connect fields, recent endpoints, failure counts, and startup repair state are local convenience state.
- The current Android wireless debugging dialog remains device-side truth for pair/connect ports and pair code.

Interfaces and command boundary:

- Pair/connect/restart/repair/reset commands live behind Tauri commands and are serialized through `adb_server_operation`.
- macOS discovery may fall back from `adb mdns services` to Bonjour `dns-sd`.

Safety, failure, and non-claims:

- Normal reconnect should not restart ADB.
- Safe wireless repair removes only `adb_known_hosts.pb` and preserves `adbkey` / `adbkey.pub`.
- Host identity reset is destructive because it removes the host key and may require every Android device to re-authorize or re-pair.
- Repeated `protocol fault` with reachable TCP can indicate stale device-side pairing state; the app should not hide that operator action may be needed on the device.

Evolution invariant:

- Keep the recovery ladder ordered from least destructive to most destructive: network/ADB state, mDNS, recent probe, manual current port, safe repair, host identity reset.

### 3. Tool Library And Workbench

Actors:

- Expert engineers and support users who need typed ADB operations, reusable templates, or a raw-command escape hatch.

User-visible promise:

- The user can run structured ADB commands, save templates, inspect output, and intentionally cross into higher-risk actions.

Dependencies:

- Selected online device, Workbench command catalog, templates, history, and `adb_workbench_execute`.

Data and evidence ownership:

- Workbench templates and history live in local Tauri store.
- Command output is local operational evidence and may be exported as text.

Interfaces and command boundary:

- The catalog builds ADB subcommands and previews `adb -s <serial> ...`.
- Custom input may include `adb` or `-s`, but backend normalization applies the current selected serial.

Safety, failure, and non-claims:

- Risk classification is heuristic, not proof of safety.
- High-risk commands such as uninstall, reboot, `rm`, `dd`, and `pm clear` require confirmation.
- Raw shell should remain an expert path, not the default shape for guided workflows.

Evolution invariant:

- Keep Workbench available as the professional tool library, while moving common QA/support jobs into guided scenario packages or Scout tasks.

### 4. Evidence Capture And Reports

Actors:

- QA/support users and engineers producing reproducible bug, walkthrough, or diagnostic evidence.

User-visible promise:

- The user can capture screenshots, recordings, Logcat, notes, device state, package details, and Scout reports into traceable local artifacts.

Dependencies:

- Selected online device, configured screenshot/recording/artifact directories, Logcat commands, screenrecord lifecycle, local file validation, and evidence export.

Data and evidence ownership:

- Local files remain on the host filesystem.
- Evidence metadata lives under `evidenceSessions` only when a Scout task is running.
- Export packages include `report.md` and available local artifact files under `assets/`; missing files are disclosed.

Interfaces and command boundary:

- Screenshots and recordings use explicit selected-device ADB commands.
- Logcat supports bounded snapshot, streaming, filtering, and export.
- Scout can append captured artifacts through its task adapters.

Safety, failure, and non-claims:

- Screenshot proves the Android framebuffer capture, not necessarily physical panel appearance.
- Screen recording finalization can fail if device storage or transport drops; report the artifact state rather than implying completion.
- Physical device touches are not automatically recorded unless they produce ADB Manager-visible evidence.

Evolution invariant:

- Evidence is the fact base for reports. Do not create report conclusions that cannot be traced back to captured artifacts, user notes, or clearly labeled Scout inference.

### 5. Scout Tasks

Actors:

- Android QA/support users running guided bug reproduction, feature walkthrough, device diagnosis, APK troubleshooting, or wireless repair tasks.

User-visible promise:

- Scout helps run a device-bound task, collect evidence, request safe tools, and generate an engineering-facing report.

Dependencies:

- Selected online device, Agent CLI runtime, per-task Agent APK decision, writable artifact directory, non-empty goal, `agentCopilotSessions`, and `evidenceSessions`.

Data and evidence ownership:

- Conversation history is stored under `agentCopilotSessions`.
- Task records are stored under `evidenceSessions` and bind to `device_sn || serial`.
- Attachments provide bounded previews; large or binary files keep metadata only.

Interfaces and command boundary:

- `src/scoutTask/` owns start gates, device binding, artifact append checks, report close/failure transitions, active task resolution, and Workbench auto-execute decisions.
- `AgentCopilot.tsx` remains the UI adapter/controller for Tauri commands, Agent CLI turns, store persistence, screenshots, Logcat, Workbench, and export.
- Agent CLI is currently the execution path. Model API providers are configuration/probe metadata until a direct execution adapter exists.

Safety, failure, and non-claims:

- Only one Scout task may run at a time.
- Starting requires selected device, usable runtime, save path, goal, and per-task Agent APK decision.
- Report generation failure keeps the task active and retryable.
- Auto-execute may run low/medium-risk Workbench requests during an active task, but high-risk and always-confirm actions still require approval.
- Scout must not claim full physical-touch observation or privileged system counters from an ordinary APK.

Evolution invariant:

- Scout is the user-facing guided layer. Agent, Agent APK, Agent CLI, and Agent Provider stay technical configuration terms.

### 6. Remote Assist

Actors:

- Desktop operator hosting a support session, and remote viewer/operator/admin browsers joining through scoped links.

User-visible promise:

- The desktop user can start an opt-in remote support gateway, share role-limited access, observe sessions, control ownership, and stop the session without exposing the host desktop.

Dependencies:

- Remote service state, trusted-device store, one-time role invites, browser sessions, selected devices, screenshot/stream pipeline, ADB action locks, and audit log.

Data and evidence ownership:

- Browser trust tokens live raw in browser localStorage.
- Desktop persists only token hashes, role, device name, timestamps, and last successful port.
- Sessions, invites, control owner, frame cache, and audit log are in memory and cleared when Remote Control stops.

Interfaces and command boundary:

- Desktop uses Tauri commands for status/start/stop/trusted-device management.
- Browser/PWA uses authenticated `/remote/api/*` routes.
- Remote actions are whitelisted: viewing, screenshots/streaming, tap/swipe/text/key/clipboard, safe templates, APK install, reconnect, and pairing repair by role.

Safety, failure, and non-claims:

- Remote Control is off by default.
- Viewer cannot control; operator needs control ownership; admin can manage sessions and privileged remote actions.
- Trust never upgrades permissions.
- Remote Control must not expose arbitrary shell, arbitrary host files, or the host desktop.
- Experimental HLS depends on host `ffmpeg`; fallback to MJPEG or snapshots is part of the product contract.

Evolution invariant:

- Future remote features must preserve role boundaries, control ownership, token-scoped media access, and an inspectable audit trail.

### 7. Diagnostics And Performance

Actors:

- Engineers and QA users measuring foreground app, device, rendering, thermal, storage, network, and process behavior during testing.

User-visible promise:

- The user can sample live device/app performance, see source limitations, and export bounded raw sample data.

Dependencies:

- Selected online device, ADB persistent stream, optional bundled Agent APK, performance sample cache, foreground app detection, `gfxinfo`, sysfs probes, and export.

Data and evidence ownership:

- The frontend keeps a rolling 15-minute sample window.
- Exported JSON/CSV includes metadata, intervals, and retained samples.
- Agent APK samples are labeled by source and merged with ADB system samples when available.

Interfaces and command boundary:

- ADB-only sampling remains the compatible baseline.
- Agent mode installs/starts/connects bundled `com.cozyla.adbmanager.agent` explicitly and checks `/health`.
- Agent-only data must not replace unavailable system GPU, thermal, battery, storage, or `gfxinfo` probes.

Safety, failure, and non-claims:

- Ordinary APK permissions cannot unlock privileged system counters.
- Missing or permission-limited probes should surface as evidence gaps, not product failure.
- Sampling should not queue overlapping probes on slow wireless ADB.

Evolution invariant:

- Keep diagnostics source-aware: ADB, Agent APK, cached slow probes, and unavailable data must stay visually and exportably distinct.

### 8. App And Package Operations

Actors:

- Engineers and QA/support users installing builds, inspecting app state, exporting APKs, and launching device apps.

User-visible promise:

- The user can install APKs, force reinstall when intentional, inspect installed packages, export installed APKs, and launch visible apps from the selected device.

Dependencies:

- Selected online device, APK path resolution, package parser, install lock, package list/details commands, app drawer cache, and local Downloads export path.

Data and evidence ownership:

- APK export files are saved under host Downloads `ADB_Manager/APKs`.
- App icon cache is local and keyed by selected device identity, package, and activity.
- Install queue state is UI-local.

Interfaces and command boundary:

- Normal install uses `adb install -r`.
- Force mode attempts uninstall first and requires a package name when parser confidence is unavailable.
- Package export uses `pm path` plus `adb pull`.
- App drawer launches `MAIN` + `LAUNCHER` activities with `am start -n`.

Safety, failure, and non-claims:

- Force uninstall is destructive and must stay intentional.
- Package parser failure should not block normal install, but it limits force reinstall confidence.
- Split APK export should preserve package-specific folder structure.

Evolution invariant:

- Treat package operations as an app-centric workflow over selected device context, not as disconnected install/list/export tabs.

### 9. Display Color Calibration

Actors:

- Firmware, display, and hardware operators tuning device display color/PQ parameters and preparing supplier-facing handoff payloads.

User-visible promise:

- ADB Manager is the desktop parameter control surface; the physical device screen is the preview surface; exports preserve readback and validation status.

Dependencies:

- Selected online physical device, fixed Settings-derived control definitions, display helper packaged with Agent APK, read/apply/snapshot/diff/export commands, and test-pattern flow.

Data and evidence ownership:

- Snapshots capture bounded raw settings/properties/dumps/sysfs/log evidence.
- Profiles and exports include device identity, target paths/services, desired values, readback, helper notes, visible-effect confirmation, and physical-validation requirement.

Interfaces and command boundary:

- Settings-backed controls use `settings put/get`.
- Firmware property controls use `setprop/getprop`, then helper calls when mapped.
- Vendor-display controls route through the packaged display helper and surface firmware/SELinux denial details.
- Advanced snapshot/diff remains diagnostic, not the primary operator workflow.

Safety, failure, and non-claims:

- Applying display values is mutating and requires explicit confirmation.
- Empty `getprop` output means unset, not confirmed value.
- Production firmware may deny shell-to-HAL calls; this is a firmware access boundary, not a UI mapping issue.
- ADB screenshot cannot prove final panel color.

Evolution invariant:

- Keep software readback, helper execution, visible effect, and physical panel validation as separate fields in UI, exports, and reports.

### 10. Release And Update Trust

Actors:

- Release maintainers, support users validating update readiness, and engineers diagnosing release/feed issues.

User-visible promise:

- The app can check, download, and apply signed updates; maintainers can reason about release artifacts and updater feed readiness.

Dependencies:

- Version files, signed/notarized macOS release artifacts, Windows CI release artifacts, GitHub Release assets, updater signatures, and `latest.json`.

Data and evidence ownership:

- Release artifacts live outside the repo under local build outputs or GitHub Releases.
- `latest.json` is the updater feed truth for app update readiness.
- Changelog/release notes are the reader-facing change record.

Interfaces and command boundary:

- Tauri updater consumes the GitHub Release `latest.json`.
- PKG installers are first-install assets, not updater payloads.
- Release flow is operationally governed by `release-and-ops.md` and the `adb-project` skill.

Safety, failure, and non-claims:

- A GitHub Release is not updater-ready until `latest.json` is current and points to valid signed updater URLs.
- Network/proxy failures and stale feed failures must be distinguishable during debugging.
- Formal macOS release assets require local signing, notarization, stapling, and Gatekeeper checks.

Evolution invariant:

- Product-facing update health should eventually expose feed freshness, asset completeness, and signature readiness without leaking secrets or local release credentials.

## Architecture Handoff

Ready for bounded-context extraction:

- `ScoutTask`: already has explicit commands/events, start gates, device binding, report failure behavior, and auto-execute policy.
- `Remote Assist`: has independent roles, sessions, trusted devices, media pipeline, action whitelist, and audit semantics.
- `Display Color Calibration`: has a distinct target model, read/apply/export lifecycle, firmware boundary, and supplier-facing payload.
- `Connection And Recovery`: has specialized state, serialized ADB server operations, repair levels, and destructive fallback semantics.

Keep as professional tool-library surfaces:

- Workbench command library and custom ADB execution.
- Logcat snapshot/stream/export.
- Screenshot, recording, mirror, image cast, clipboard, package list/export, and APK install, unless a guided workflow consumes them.

Require a capability contract before implementation:

- Direct model-provider execution for Scout tasks.
- UI automation through Agent APK accessibility or coordinate fallback.
- Fastboot/flashing or firmware operations.
- Multi-task or multi-device Scout sessions.
- Global evidence/session features outside a running Scout task.
- Remote arbitrary command execution, if ever requested.
- Any feature that writes security, account, lock screen, accessibility authorization, or host identity state.

## Open Questions

- Should the current-device workspace become the only durable first screen after launch, or should the existing tab rail remain the primary navigation through the next release?
- Should release/update trust become a visible in-app maintainer panel, or stay as operational documentation until support users need it?
- Should Device Diagnosis Report become the next first-class Scout task, or should Bug Repro and Feature Walkthrough hardening finish first?
- What is the accepted threshold for direct model-provider execution replacing CLI-only Scout runtime?

## Validation Checklist

- Covers every major functional-model surface: device console, wireless recovery, Workbench, APK install, packages, screenshot, recording, mirror, Remote, image cast, clipboard, Logcat, performance, Scout, Display Color, settings/updater.
- Preserves Scout naming: Scout is user-facing; Agent/APK/CLI/Provider are technical runtime/configuration names.
- Preserves high-risk invariants: explicit selected device, safe wireless repair before host identity reset, Scout evidence boundary, Remote role whitelist, Display Color readback versus physical validation.
- Does not change UI, code behavior, tests, release process, or generated graph artifacts.
