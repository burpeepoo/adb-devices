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
- The Copilot can pass an optional evidence shortcut hint to the Agent from prompt text, attachment names, bounded text previews, or recent conversation context, but normal chat does not show or run a manual template action.
- Normal prompt submission is routed to the selected Agent CLI as a multi-turn conversation. The Agent may answer directly, ask follow-up questions, or request typed read-only tools through structured `toolCalls`.
- Auto-approved read-only tool requests use existing Tauri commands and `adb_workbench_execute`, so selected-device targeting and risk classification still apply.
- The right-side Copilot drawer checks Agent APK installation status on open and prompts for explicit install/update when the selected device lacks the APK; installation is not automatic.
- Runtime probing is manual from the Copilot CLI/model selector. It opens an independent modal that checks local CLI availability and enabled API provider configuration when the user asks for a health check.
- Mutating or expert raw ADB command requests render as approval cards and require user action before execution.
- QA Scribe evidence records persist local artifacts for feature walkthrough and Bug reproduction flows; Bug repro issue markers attempt to attach issue-time Logcat, active records expose compact evidence timelines to the Agent, and the local `evidence.get_active_record` tool can return fuller detail. Full QA Scribe controls live in peer Walkthrough and Bug Repro modes so normal Chat mode remains conversational and users can switch back after starting a repro. Checklist and test-plan handling depends on uploaded attachments plus Agent guidance rather than a dedicated checklist status workflow.
- Explicit evidence shortcut collection still runs bounded skill steps through `adb_workbench_execute`.
- Session history is local and persisted under `agentCopilotSessions`.
- Global Agent CLI settings and current-device overrides are stored in `settings.agentCli`; current-device overrides are edited from the Agent Lab CLI panel.
- Provider settings are stored in `settings.agentProviders`. API keys are local app settings, so distribution, backup, and shared-machine use need care. API provider configuration is visible and probeable, but current Agent conversation execution still depends on CLI runtime support.

Risks:

- Automatic evidence shortcut matching is keyword-based and should be treated as routing assistance, not a root-cause conclusion.
- The current tool-call protocol is text/JSON based. If the configured CLI does not follow the requested `toolCalls` format, the app will treat the output as a normal assistant answer.
- Evidence records currently store artifact metadata and bounded text locally; large binary artifacts are referenced by path rather than copied into the store. QA Scribe export copies currently available local artifact files into the `.zip` evidence package, but missing or moved files are skipped and reported.
- QA Scribe does not observe every physical touch or system-wide user action. It only records evidence ADB Manager can verify, such as screenshots, foreground/window output, Remote audit entries, Logcat, user notes, performance context, Agent APK status, and saved paths.
- The ordinary APK Agent cannot read privileged system counters. Treat APK data as supplemental, not authoritative.
- Agent APK upgrades preserve app data only when the package name and signing certificate stay stable. Signature changes or version downgrades require explicit manual handling because automatic uninstall would delete Agent app data.
- Agent CLI execution could run arbitrary host commands if profile validation, sandbox defaults, or high-risk approval gates are weakened.

Mitigation:

- Keep built-in CLI profiles read-only/non-interactive by default, and keep custom CLI profiles visible in settings.
- Keep high-risk or mutating actions outside the auto-approved read-only tool path and keep approval cards visible in the conversation audit trail.
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
