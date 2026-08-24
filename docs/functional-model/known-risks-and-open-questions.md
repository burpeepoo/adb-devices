# Known Risks And Open Questions

## Wireless Recovery Boundaries

Current code separates four recovery levels:

- Normal connect and recent reconnect do not restart ADB.
- A normal failed pairing attempt does not restart ADB or disconnect unrelated online devices.
- The explicit **Restart ADB and retry pairing** action restarts the daemon while preserving all pairing files, then retries the exact submitted request once; the retry result, not the restart result, is user-visible.
- Explicit restart/reconnect restarts the local ADB server while preserving pairing state.
- Wireless pairing repair backs up and removes only `adb_known_hosts.pb`, then restarts ADB.
- `adb_reset_host_identity` backs up and removes `adb_known_hosts.pb`, `adbkey`, and `adbkey.pub`, then starts ADB.

Boundary:

- Restart/reconnect should be tried before refreshing pairing cache when a saved endpoint is still reachable.
- Wireless repair refreshes the host-side pairing cache without changing this computer's ADB identity.
- Host identity reset remains a separate explicit fallback because it invalidates the local ADB key.
- The UI should disclose that pairing-cache refresh removes `adb_known_hosts.pb` and may require re-pairing before presenting host identity reset as the final fallback. Reset confirmation must mention `adbkey` removal and the need to re-authorize or re-pair devices.

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

## Device File Access And Staging Boundaries

The Files workspace is bounded by the selected device's current Android user, ADB UID, discretionary permissions, SELinux policy, encryption/unlock state, mount mode, and OEM behavior. Standard production `shell` access commonly reaches shared storage and `/data/local/tmp`, but it does not imply access to `/data/data`, `/data/user/*`, or every physical file. Even an already-root ADB shell can still encounter SELinux, encryption, or read-only mount limits.

Risks:

- A directory can pass an observed `test -w` signal and still reject the actual write because storage, policy, transport, or filesystem state changes.
- Treating `Permission denied` as an empty directory would hide the access boundary and produce false evidence.
- `adb shell` joins remote command arguments; an unquoted device path can become shell syntax even when the host process uses separate argv values.
- A device-to-host native copy materializes potentially sensitive data in app-cache staging. Removing that staging immediately would break a later Finder/Explorer paste; retaining it indefinitely would increase local exposure.
- Existing directory replacement is deliberately whole-item replacement, not a merge: after the staged copy succeeds, the old conflicting item is moved aside, the new item is committed, and the old item is restored if the commit fails. The confirmation warns that files found only in the old destination directory will be removed.
- Android shared-storage layers can reject `RENAME_EXCHANGE` even when Toybox exposes `mv -x`. The verified fallback has a brief destination visibility gap and cannot eliminate a deliberately hostile rename race without a device-side helper using no-follow file descriptors.
- The initial file manager assumes a normal single-operator workflow, not an adversarial process that deliberately swaps host or device path entries between validation and ADB sync opening them. Sources and destinations are revalidated before and after transfer, but ADB sync does not expose held no-follow file descriptors; a same-kind, same-size hostile replacement can therefore evade those checks.
- A disconnect, timeout, or failed rollback can leave a same-parent hidden `.adb-manager-stage-*` recovery item on the device. Uncertain commit state deliberately preserves that path instead of risking deletion of the only recoverable copy; this slice has no automatic remote recovery sweep.
- Device filesystems can reject otherwise valid host names. For example, the current Android shared-storage mount rejected a filename containing a newline; this must remain a per-item transfer failure, never a silently renamed or partially committed success.
- Very large files and folders currently use one blocking `adb push`/`pull` operation per item and have no progress, cancel, or resume protocol.
- Host filename rules differ. Windows-incompatible device names are sanitized for export, so the local name can differ from the remote name.

Mitigation:

- Preserve per-path read/write/denied state and treat only the actual transfer result as authoritative; capability limits remain available to path gating without a standalone summary card.
- Preserve permission, not-found, timeout, offline/unauthorized, conflict, partial-success, and empty states separately.
- Build one remote shell command with POSIX single-quoted data arguments; keep `push`/`pull` values as sync-protocol argv and cover metacharacters in tests.
- Run status-bearing remote scripts through non-PTY `adb shell`, preserve their NUL-delimited stdout, and verify the final destination plus stage disappearance before success. Use exchange when supported; otherwise use checked no-clobber moves and backup/rollback, and retain the hostile-race limitation above.
- Reject observed symlinks, reparse points, and special files; bound recursion; and revalidate tree shape, names, types, and sizes. Do not describe this as protection from an actively hostile concurrent writer without a future host/device helper that transfers through held no-follow handles.
- Surface uncertain commit state and its exact recovery path, and do not blindly clean it after a timeout, transport failure, or rollback failure. A future recovery manifest is required before automatic remote cleanup is safe.
- Require explicit replacement confirmation and report every source/destination result. Never change identity, root, remount, or choose another path silently.
- Stage each native copy in a unique app-cache batch and expose the local path. During a later file-access capability probe (such as entering or refreshing the Files workspace) or native copy/staging operation, make a best-effort cleanup of only scoped batches older than seven days; there is no background cleanup timer while the app is closed.
- Keep delete/rename/move/permission editing out of the initial capability. Add cancellable transfer jobs only when real large-batch evidence justifies the lifecycle.

## Display Color Control Boundaries

Display Color now has a visible diagnostics tab and a fixed device-control board. The feature is ADB Manager-driven: desired values are chosen on desktop, the selected device is the preview surface, writes require explicit confirmation, and panel color still needs physical validation.

Coverage:

- The primary controls mirror the Settings display page: Color Enhance, Color Bright, Contrast, Saturation, Color Temperature value, Color Temperature wheel coordinate, and Smart backlight.
- Settings APK evidence maps Color Bright, Contrast, and Saturation to `vendor.display.output.IDisplayOutputManager/default` `enhanceComponent` ids `1`, `2`, and `6`; firmware-provided calibration handoff exposes the corresponding preset values through `persist.vendor.display.enhance_bright`, `persist.vendor.display.enhance_contrast`, and `persist.vendor.display.enhance_saturation`; Color Enhance uses component `0`; the HSL max range is `100`.
- Color Temperature value maps to `settings system aw_color_temperature_value`, remains visible as a read-only firmware value, and has no direct input or apply action. The color wheel coordinate remains the Settings coordinate key `settings system srgb_color_temperature`, is edited through a clickable color wheel that mirrors the Settings 205-point coordinate space, and is exported as `x,y`; applying it also derives the Settings-native ARGB value, writes `aw_color_temperature_value`, and live-applies `enhanceComponent[10]` / sRGB white point. Operator-facing chips show `#RRGGBB` and `x,y`, while the signed Settings integer is retained as a firmware raw value for handoff. Android returns the literal `null` for an unset settings key, and ADB Manager treats that as unset rather than as a valid readback value.
- `adb_display_calibration_read_target` reads one fixed target directly for control refresh and row-level feedback.
- `adb_display_calibration_snapshot` captures bounded read-only evidence from settings, properties, display dumps, likely display/PQ services, likely sysfs nodes, and recent display-related logs.
- `adb_display_calibration_diff` compares two snapshots and highlights changed likely display candidates for advanced evidence.
- `adb_display_calibration_apply` requires explicit confirmation, validates target metadata, writes settings/property/sysfs targets, reads them back, and routes vendor-display targets through the packaged display helper. System-property writes must read back a non-empty value before the UI treats them as successful. Known firmware properties then run a live vendor-display apply hook so the panel updates without manually touching the Settings slider. Failed writes return row-level errors immediately instead of waiting for a full snapshot refresh.
- `adb_display_calibration_open_test_pattern` pushes and opens a generated image so physical-device preview can be inspected.
- `adb_display_calibration_build_export` produces supplier-facing JSON and Markdown payloads.
- If the selected device is an mDNS service-name alias such as `adb-..._adb-tls-connect._tcp`, Display Color resolves it to a currently connected executable ADB transport with the same physical serial before running snapshot/apply/test-pattern commands.

Risks:

- Vendor PQ/color engines may apply changes after Android screenshot capture, so ADB screenshots cannot prove final panel color.
- Color Enhance and Smart backlight live behind a vendor VINTF display service on the tested device; normal `settings put` and legacy `service call` do not write these controls. Bright, Contrast, and Saturation can be exchanged with firmware through `persist.vendor.display.enhance_*` properties on userdebug/root builds, but empty `getprop` output means the property is unset and must not be exported as a confirmed value. On KB07 userdebug, shell helper access to the vendor display service is available, so property writes can be followed by helper calls for immediate visible effect. Color Temperature now uses the Settings value plus helper refresh instead of treating `persist.vendor.display.enhance_srgb` as a stable scalar.
- Precise X/Y color-point edits are constrained to the effective circular wheel, not only the `0..205` square. Coordinates outside that circle are projected back to its edge, so the normalized value can differ from the literal number the operator typed.
- `adb root` restarts adbd by design; on the reported GC7N10001XL firmware it can trigger a full device reboot. Local mirroring can also disconnect or destabilize while the display stack and adbd are restarting, so Display Color keeps root behind an explicit confirmation and does not start mirroring as part of calibration. The Screen Mirror command now checks `adb shell id -u` and blocks scrcpy startup while ADB shell is root (`uid=0`); users should run `adb unroot`, wait for the device to reconnect, and then mirror.
- The packaged shell helper can issue the correct binder transaction, but the tested production firmware denies `u:r:shell:s0` calling `u:r:hal_awdisplayoutput_default:s0` (`avc: denied { call }`). This is a firmware access-policy boundary, not a UI mapping issue.
- Sysfs writes can be unavailable on production builds or require root; failed writes should be treated as capability evidence, not as UI failure.
- Real-time preview for vendor-display controls requires either a firmware allowlist for shell/helper calls, an engineering/root build, or a vendor-provided privileged bridge that can call the same service contract as Settings.

Mitigation:

- Keep ADB Manager as the deterministic parameter source and device screen as the preview surface.
- Keep Agent usage analytical only; do not use Agent as the real-time polling/control loop.
- Keep fixed Settings-derived controls as the main UI, and keep snapshot/diff as advanced diagnostics rather than the user-facing control model.
- Keep the display helper path implemented and return the exact firmware denial in UI; do not claim live Bright/Contrast/Saturation writes are supported on production firmware until the access-policy boundary is changed.
- Export readback and physical-validation status separately so firmware and hardware suppliers can see which values were software-confirmed and which effects were physically confirmed.

## Scout Agent Task Boundaries

Scout Agent Tasks are evidence-first and must not pretend to have data that ADB Manager did not collect.

Coverage:

- Settings detects only allowlisted local Codex/Claude configuration fields and safe model/effort metadata; it never returns credentials, API keys, tokens, arbitrary config values, or catalog instruction bodies. Codex exposes a machine-readable local model catalog, while Claude currently exposes effort choices and model aliases but no complete local model catalog, so Claude full model IDs remain editable user input.
- Embedded Android-agent skills live in both `docs/agent-skills/` and `src/androidAgentSkills.ts`.
- Scout can pass an optional evidence shortcut hint to the Agent from prompt text, attachment names, bounded text previews, or recent conversation context, but normal chat does not show or run a manual template action.
- Normal prompt submission is routed to the selected Agent CLI as a multi-turn conversation. The Agent may answer directly, ask follow-up questions, or request typed read-only tools through structured `toolCalls`.
- Auto-approved read-only tool requests use existing Tauri commands and `adb_workbench_execute`, so selected-device targeting and risk classification still apply.
- The Agent Tasks console checks Agent APK installation status and prompts for explicit install/update when the selected device lacks the APK; installation is not automatic.
- Runtime probing is manual from the Scout CLI/model selector. It opens an independent modal that checks local CLI availability and experimental API provider configuration when the user asks for a health check.
- Starting a Feature Walkthrough or Bug Repro task requires an available Agent CLI in the current implementation. Configured model API providers are shown as probe/configuration status but do not yet satisfy the execution gate.
- Fully automatic Scout tasks can run up to 24 autonomous tool-request turns plus up to two terminal-only synthesis attempts: they may collect/compare accessible reference and device context, request device tools, auto-run eligible low- and medium-risk workbench commands, and preserve model-requested screenshots plus post-command screen-state snapshots. Protected requests, including destructive/data-loss operations, payment/purchase, account sign-in/sign-out, permission grant/revoke, and app-ops mutation, return a blocker without an approval card. Ordinary Submit, Confirm, Continue, search clearing, and filter reset are not protected. The blocker names the exact step, one required human action, and how to restart; terminal outcomes automatically become the report and close the record. Invalid “waiting for results” endings are retried and then replaced by a deterministic latest-result closeout. Feishu/Figma comparison remains conditional on the selected Agent CLI having the relevant integration; Scout must record an access gap rather than claim it read an inaccessible reference.
- Scout evidence records persist local artifacts for feature walkthrough and Bug reproduction flows; Bug repro issue markers attempt to attach issue-time Logcat, active records expose compact evidence timelines to the Agent, and the local `evidence.get_active_record` tool can return fuller detail. Full record controls live in peer Walkthrough and Bug Repro modes so normal Chat mode remains conversational and users can switch back after starting a repro. Checklist and test-plan handling depends on uploaded attachments plus Agent guidance rather than a dedicated checklist status workflow.
- Feature Walkthrough review is guided by `docs/scout-skills/feature-walkthrough-review.md`; its coverage matrix and issue severity currently live in Agent-generated notes and reports rather than dedicated structured task fields, so completeness still depends on Agent output quality and collected evidence.
- Final report generation is retryable. A task shows an `Agent is thinking` state while its CLI turn is in progress. Autonomous Scout uses a bounded `medium` effort default when the user has not selected an effort. Codex desktop turns use non-stream completion with `output-last-message` so a child-process stdout handle cannot leave the task waiting after the CLI has exited. If the Agent runtime fails or returns unusable output, Scout persists the error as a runtime-gap artifact, marks the Agent run stopped, and avoids presenting the task as still running; report generation keeps the task active and retryable rather than closing or exporting a misleading completed record.
- Explicit evidence shortcut collection still runs bounded skill steps through `adb_workbench_execute`.
- Session history is local and persisted under `agentCopilotSessions`.
- Global Agent CLI settings and current-device overrides are stored in `settings.agentCli`; current-device overrides are edited from the Agent Tasks CLI panel.
- Provider settings are stored in `settings.agentProviders`. API keys are local app settings, so distribution, backup, and shared-machine use need care. API provider configuration is visible and probeable, but current Agent conversation execution still depends on CLI runtime support.

Risks:

- Automatic evidence shortcut matching is keyword-based and should be treated as routing assistance, not a root-cause conclusion.
- The current tool-call protocol is text/JSON based. If the configured CLI does not follow the requested `toolCalls` format, the app will treat the output as a normal assistant answer.
- Evidence records currently store artifact metadata and bounded text locally; large binary artifacts are referenced by path rather than copied into the store. Export copies currently available local artifact files into the `.zip` evidence package, but missing or moved files are skipped and reported.
- Scout task records do not observe every physical touch or system-wide user action. They only record evidence ADB Manager can verify, such as screenshots, foreground/window output, Remote audit entries, Logcat, Agent notes, performance context, Agent APK status, and saved paths.
- The ordinary APK Agent cannot read privileged system counters. Treat APK data as supplemental, not authoritative.
- Agent APK upgrades preserve app data only when the package name and signing certificate stay stable. Signature changes or version downgrades require explicit manual handling because automatic uninstall would delete Agent app data.
- Agent CLI execution could run arbitrary host commands if profile validation, sandbox defaults, or high-risk approval gates are weakened.

Mitigation:

- Keep built-in CLI profiles read-only/non-interactive by default, and keep custom CLI profiles visible in settings.
- Keep protected actions outside the fully automatic Scout path. Return a structured blocker with the exact blocked step, one human action, restart guidance, and a terminal Agent note; preserve separate confirmation policy only in General Chat and the manual ADB Workbench.
- Keep ordinary APK limits visible in skill docs and UI copy.
- Keep Agent APK version metadata aligned across Java, the build script, and the desktop backend whenever the APK behavior changes.
- Keep local skill docs synchronized with the embedded app catalog.

## Startup Repair Tradeoff

Startup repair is intentionally gated by version and 10-minute cooldown. It avoids repair if any device is already online.

Risk:

- A device can briefly appear online after app update and then drop offline. Restart recovery now refuses to mark discovery-only or failed reconnect attempts complete, but it does not yet require a post-connect settle window.

Potential follow-up:

- Require online state to remain stable for a short settle window before marking startup repair complete.

## mDNS Visibility

mDNS discovery depends on local network broadcast behavior and host network filtering.

Risks:

- Corporate Wi-Fi, AP isolation, VPNs, multiple NICs, or stale Android wireless sessions can hide valid devices.
- Filtering to host private network prefixes can suppress useful services if the host has incomplete IP info.
- macOS Local Network privacy is attributed to the responsible signed app. Ad-hoc or identity-changing development bundles can lose stable permission attribution even when raw TCP reachability and Bonjour discovery still appear to work.
- mDNS visibility proves only that a Bonjour service was discovered; it does not prove the app-launched ADB daemon can open the endpoint or complete the ADB/TLS connection.

Mitigation:

- Keep manual IP/port entry available.
- Keep recent endpoints visible and probeable.
- Show local network hints when multiple local networks are detected.
- Ship macOS builds with localized English and Simplified Chinese `NSLocalNetworkUsageDescription`, both `_adb-tls-connect._tcp` and `_adb-tls-pairing._tcp` Bonjour declarations, and a stable Apple signing identity.
- Preserve the endpoint's ADB error and show the macOS Local Network setting when the route is unreachable; do not replace that error with a discovery-only success message.

## Connect Button Performance

Normal connect and recent reconnect intentionally avoid implicit ADB restart.

Reason:

- Restarting ADB on every connect attempt makes successful paths slower and can disrupt existing online devices.

Risk:

- Some failures may require explicit restart/reconnect, wireless pairing repair, or host identity reset, so the UI keeps recovery controls available and escalates their recommendation state after repeated failures.

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

The desktop snapshot can request a device-time history range, but Android still stores Logcat in finite per-device ring buffers.

Risks:

- A requested 6- or 24-hour range can cover less time when chatty buffers have already overwritten older entries.
- The desktop table caps returned rows for responsiveness. Without a narrow ADB filter, an important early tag can be outside the loaded tail even though the raw selected range contained it.
- Package collection prefers UID scope so it can cross process restarts. A shared UID such as `1000` can mix other same-UID processes into the exported Logcat.
- If package UID resolution fails, the fallback current-PID scope cannot recover records from an earlier process instance.

Mitigation:

- Show both the requested range and the actual first/last timestamps returned by the device, plus total line count and truncation state.
- Make verbose priority explicit and advise operators to use a tag-level ADB filter such as `tls-handler:V *:S` before refreshing a noisy desktop range.
- Package application-log collection writes the complete selected all-buffer UID/PID range to disk, records scope/range/count/warnings in `metadata.json`, and keeps persisted remote files as the authoritative evidence when Logcat history is gone.
- Do not claim that choosing a longer range restores entries already overwritten by the Android ring buffer.

## Release Feed Freshness

The app updater depends on GitHub Release `latest.json`.

Risks:

- A release can exist but updater still fails if `latest.json` is missing, stale, malformed, or points to missing assets.
- Network/proxy errors can look similar to feed errors in user reports.

Mitigation:

- Always fetch the public latest.json after release.
- Keep `release-and-ops.md` and the `adb-project` skill release checklist aligned.
