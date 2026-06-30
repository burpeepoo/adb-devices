# Known Risks And Open Questions

## Wireless Recovery Boundaries

Current code separates three recovery levels:

- Normal connect and recent reconnect do not restart ADB.
- `adb_restart_server` and `adb_repair_wireless_pairing` back up and remove only `adb_known_hosts.pb`, then restart ADB.
- `adb_reset_host_identity` backs up and removes `adb_known_hosts.pb`, `adbkey`, and `adbkey.pub`, then starts ADB.

Boundary:

- Wireless repair refreshes the host-side pairing cache without changing this computer's ADB identity.
- Host identity reset remains a separate explicit fallback because it invalidates the local ADB key.
- The UI should continue to present safe repair before host identity reset. Reset confirmation must mention `adbkey` removal and the need to re-authorize or re-pair devices.

## Explicit Device Targeting

Device actions must not silently fall back to ADB's default target.

Coverage:

- Shared frontend target state blocks device actions when no online device is selected.
- Workbench, install, screenshot, screen record, scrcpy mirror/navigation, image cast, clipboard, Logcat, and packages all use the selected online serial.
- Results and exports should include target identity when they may be used as QA/support evidence.

Risk:

- A future tool may pass `null` or an empty serial to a backend command and reintroduce default ADB target behavior.

Mitigation:

- Reuse the shared target-device strip and helper for new device tools.
- Add helper tests for target selection and keep `npm test` covering them.

## Android Device Copilot Boundaries

The Copilot tab is intentionally experimental and evidence-first.

Coverage:

- Embedded Android-agent skills live in both `docs/agent-skills/` and `src/androidAgentSkills.ts`.
- The Copilot auto-matches skills from prompt text, attachment names, and bounded text previews; users do not select a skill manually before sending.
- Skill runs use `adb_workbench_execute`, so selected-device targeting and risk classification still apply.
- Session history is local and persisted under `agentCopilotSessions`.
- Global Agent CLI settings and current-device overrides are stored in `settings.agentCli`; current-device overrides are edited from the Agent Lab CLI panel.

Risks:

- The current Copilot can run deterministic skill steps, but it does not yet execute an external Codex/Claude/custom CLI profile.
- Automatic skill matching is keyword-based and evidence-first; it should be treated as routing assistance, not a root-cause conclusion.
- The ordinary APK Agent cannot read privileged system counters. Treat APK data as supplemental, not authoritative.
- Agent APK upgrades preserve app data only when the package name and signing certificate stay stable. Signature changes or version downgrades require explicit manual handling because automatic uninstall would delete Agent app data.
- A future CLI execution path could run arbitrary host commands if profile validation and explicit approval are weak.

Mitigation:

- Keep CLI launch as an explicit future command path with visible approval and hidden-process handling.
- Keep ordinary APK limits visible in skill docs and UI copy.
- Keep Agent APK version metadata aligned across Java, the build script, and the desktop backend whenever the APK behavior changes.
- Keep local skill docs synchronized with the embedded app catalog.

## Startup Repair Tradeoff

Startup repair is intentionally gated by version and 10-minute cooldown. It avoids repair if any device is already online.

Risk:

- If a device briefly appears online after app update and then drops offline, startup repair may mark itself complete too early.

Potential follow-up:

- Require online state to remain stable for a short settle window before marking startup repair complete.

## mDNS Visibility

mDNS discovery depends on local network broadcast behavior and host network filtering.

Risks:

- Corporate Wi-Fi, AP isolation, VPNs, multiple NICs, or stale Android wireless sessions can hide valid devices.
- Filtering to host private network prefixes can suppress useful services if the host has incomplete IP info.

Mitigation:

- Keep manual IP/port entry available.
- Keep recent endpoints visible and probeable.
- Show local network hints when multiple local networks are detected.

## Connect Button Performance

Normal connect and recent reconnect intentionally avoid implicit ADB restart.

Reason:

- Restarting ADB on every connect attempt makes successful paths slower and can disrupt existing online devices.

Risk:

- Some failures may require explicit restart/reconnect or host identity reset, so the UI must make repair controls discoverable after repeated failures.

## Workbench Safety

Workbench risk classification is heuristic.

Coverage:

- It catches common destructive commands such as `rm`, `dd`, `reboot`, `uninstall`, `pm clear`.
- It treats install/push/settings/property/permission mutation as medium risk.

Risks:

- A dangerous command can be hidden in shell syntax not recognized by the heuristic.
- A safe command can be marked higher risk due broad keyword detection.

Mitigation:

- Keep high-risk confirmation.
- Prefer adding known operations to the typed catalog instead of relying on custom commands.

## Recording Process Lifecycle

Screen recording stops by killing the host-side ADB process and then waiting 1 second before pulling the file.

Risks:

- Device may need more time to finalize MP4 on slow storage.
- If ADB transport drops while recording, backend may not know whether remote file is valid.

Potential follow-up:

- Poll for remote file existence/size before pull.

## scrcpy Early Exit Window

Mirror startup treats a process exit within 900 ms as failure and includes captured output.

Risk:

- Some slow systems may need longer before a stable running state is clear.

Potential follow-up:

- Make early-exit wait configurable or adaptive if false failures are observed.

## Package Parsing Limits

APK package parsing reads binary `AndroidManifest.xml` directly.

Risks:

- Exotic APK layouts or malformed manifests may fail package extraction.
- Force install can still proceed if the user supplies a package name manually.

## Logcat Snapshot Limits

Snapshot mode reads a bounded tail of logcat.

Risk:

- Important earlier lines may be missing.

Mitigation:

- Streaming mode and export are available for longer diagnostic sessions.

## Release Feed Freshness

The app updater depends on GitHub Release `latest.json`.

Risks:

- A release can exist but updater still fails if `latest.json` is missing, stale, malformed, or points to missing assets.
- Network/proxy errors can look similar to feed errors in user reports.

Mitigation:

- Always fetch the public latest.json after release.
- Keep `release-and-ops.md` and the `adb-project` skill release checklist aligned.
