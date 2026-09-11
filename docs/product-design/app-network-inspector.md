# App Network Inspector

Status: Implemented and validated with Calendar. Release target: 2.2.8.
Date: 2026-09-11
Fixed review base: `a4359aedf1f9d1c44c5914fdce8c531b3b2c95fa`.

## User request and capability

Enable an operator to select an Android app, observe its requests as they occur,
open a request to inspect its parameters and response, and export the capture.
The first acceptance target is the existing Calendar debug APK. The user has no
source code and has identified the connected device as the test target.

The source of request details must be explicit. A debug flag permits inspection;
it does not itself create HTTP logs. The selected approach must work with the
existing debuggable APK without a source-code change or APK repackaging.

## Verified target

- Two observed transports identify the same physical device; use one explicit
  selected transport, never ADB's implicit default.
- App package: `com.cozyla.calendar`.
- Installed version: `1.2.8.2026090317` (2026090317).
- Android SDK: 36; ABI: arm64-v8a.
- Installed app is `DEBUGGABLE`; `run-as com.cozyla.calendar id` succeeds.
- APK class markers include `okhttp3/OkHttpClient`, `retrofit2/Retrofit`, and
  `HttpLoggingInterceptor`.
- An app-PID-scoped `adb shell logcat` read returned 24 request/response pairs,
  including request and response headers, valid JSON bodies, status and duration.
  Parallel threads were present. Source: tag `OkHttp`, Android threadtime format.
- Sanitized shape evidence is in
  `artifacts/network-inspector-20260911/calendar-http-log-evidence.json`.
- Read-only evidence: `artifacts/network-inspector-20260911/device-evidence.json`.
  The private local APK copy is diagnostic input, not a source or release asset.

## Scope and invariants

- Desktop request inspection, tied to one explicit device and app at a time.
- App selection displays package names without a Calendar-specific prefix.
- Start/stop a capture, filter requests, select request details, export locally.
- Display method, URL, request time, HTTP status or transport error, duration,
  request query/header/body and response header/body when captured.
- Preserve missing/pending/truncated/unsupported body states. Never replace a
  missing body with an invented empty response or infer HTTP success.
- Give each observed request a stable capture-session/request ID. Pair the
  supported synchronous OkHttp logger's blocks by PID, TID and matching URL;
  concurrent threads remain separate. Ambiguous, unmatched and interrupted
  blocks must never be attached to an unrelated request.
- Include device, package, session time and collection limits in exports.
- Stopping or changing target must release capture resources and prevent late
  events from entering a different target's capture.
- A temporary disconnect or device selection change stops the previous collector
  and retains its final drain for inspection/export. The capture's original
  device is visible. A successful new start replaces the retained capture.
- Bound in-memory records/body size and report any loss or truncation.
- Credentials must not leak into ordinary status logs or diagnostics. Export
  must clearly reflect its masking policy; no automatic external transmission.
- Do not root/remount the device, alter trust certificates, repack or reinstall
  Calendar, clear app data/log buffers, or intercept another app as a fallback.
- Do not create requests that mutate Calendar data merely to test capture.
- Every desktop child process uses the shared hidden-process/ADB helpers.
- UI follows `DESIGN.md` and must be checked in the Tauri desktop app.

## First-version transport decision

Use the already verified Calendar HTTP logs. The first version is a structured
viewer for the supported OkHttp log format, not a universal network packet
capture tool. It does not need Android Studio, a collector SDK, a certificate,
root, source code, or an APK change for this Calendar build.

The backend starts an independent logcat child for the selected app's current
main-process PID, preserving timestamp, PID, TID and message. It must not share
the ordinary Logcat page's child process. Bounded queue snapshots are consumed
frequently by the desktop. Capture start, final drain, stop, error and process
restart are explicit. App restart ends the current capture and asks the user to
start again. Future support for additional app processes is outside this first
version and must not be claimed.

The frontend parser groups request/response blocks and generates safe detail and
export snapshots. Default limits: 500 retained requests and 64 KiB per body;
credential headers and common credential fields/query parameters are masked.
Parse/body/matching limitations are retained as evidence, including transport
line loss. No missing data is fabricated.

Apps that do not emit supported HTTP logs will show an explicit waiting/no-source
explanation. Android Studio-style runtime probes remain a separate future
adapter; this machine currently lacks its required Studio runtime artifacts.

## Implementation contracts and public test seams

Backend commands (camelCase invoke arguments, snake_case response fields):

- `adb_network_capture_start(deviceSerial, packageName)` returns capture metadata.
- `adb_network_capture_snapshot(sessionId)` drains new bounded log lines and
  returns capture status, total dropped-line count and any stable error code.
- `adb_network_capture_stop(sessionId)` stops only the matching session and
  returns the final queue snapshot.

Metadata: `session_id`, `device_serial`, `package_name`, `pid`, `started_at_ms`.
Line: `timestamp`, `pid`, `tid`, `message` (only recognized OkHttp-tag lines).
Snapshot: `session_id`, `lines`, `status` (`running`, `stopped`, `error`,
`app_restarted`), `dropped_lines`, `error_code` (nullable).

Domain seam: deterministic incremental parser fed by lines and a session ID;
interleaved threads, nested/ambiguous blocks, errors, omitted/truncated bodies,
end-of-capture interruption and export redaction are behavior tests.
Backend seam: validated command arguments, exact target binding, queue limits,
line parsing and session ownership/cleanup. Desktop QA checks the actual flow.

Export: JSON with schema/source/capture metadata, collection limits, dropped
counts and all retained requests. UI search affects the view, not the complete
capture export. Stopping retains the capture for inspection and export.

## Acceptance checks

1. Prove real Calendar request headers/body or explicit body-unavailable evidence
   through the verified HTTP log source before claiming a working inspector.
2. With overlapping requests, parameters and responses stay attached to the
   correct request; incomplete requests remain visibly incomplete.
3. Start/stop and device/app changes do not leak processes, forwards, stale data,
   or an active collector for the previous target.
4. A disconnected device or stopped app produces an actionable reason; an app
   with no supported logs gets a waiting/source explanation. The debug flag
   alone neither guarantees nor is required for this log-based source, and an
   empty capture is not mistaken for successful inspection.
5. Export is readable, contains the selected capture and metadata, and preserves
   completion/truncation/masking states.
6. Run focused behavior tests, the relevant full build/test checks, desktop smoke
   validation, and independent Standards and Spec review before completion.

## Plan and evidence status

- [x] Explain the difference between debug permission, logs, and HTTP capture.
- [x] Resolve the user's first app and verify target/device prerequisites.
- [x] Verify a supported data source containing real requests and responses.
- [x] Freeze normalized event/data contract.
- [x] Implement capture lifecycle and structured request parsing.
- [x] Implement app selection, live list, detail and export.
- [x] Validate behavior and limits; run desktop verification and dual review.

The main agent owns the specification, live target verification, integration and
completion evidence. Independent sidecars own the parser/export module and
backend lifecycle with disjoint files; separate Standards and Spec reviews close
the implementation.

Review refinement: the global device picker can automatically change selection
when a connection disappears. Retaining the prior capture through all selection
changes avoids mistaking that fallback for a user's request to erase evidence;
new capture creation still waits for full cleanup and never mixes records.

## Completion evidence (2026-09-11)

- Native Tauri flow: selected Calendar on the explicitly bound test device, started the dedicated
  collector, received four fresh requests, opened request and response tabs,
  stopped with all records retained, filtered to two rows and exported through
  the native save dialog. Readback contained all four requests, HTTP 200, complete
  request and response bodies, masked Authorization and syncToken fields.
- Source request times were `09-10 20:46:12.641` through
  `09-10 20:46:14.412`, retained verbatim from the device's local log clock.
  Host/server date was September 11. These were incoming requests during native
  capture, distinct from the earlier 23-request historical parser check.
- After the final parser hardening, 112 device log lines for those same four
  requests were replayed through the final production parser. Method, URL,
  HTTP status, duration, JSON body values, body states and byte counts matched
  the native export; no warnings. JSON indentation changes were ignored.
- Final native bundle was rebuilt and reopened, with compact navigation,
  page title, original-capture device label, and verified start/stop. Long list
  text now wraps within its request card. The full fresh-request/export flow
  occurred before this last visual/boundary refinement; the final parser replay
  and lifecycle regressions cover the subsequent behavior changes.
- `npm run build`: PASS, including the final Tauri build's frontend step.
- `npm test`: PASS, 225 tests; includes 17 parser/export and 6 capture lifecycle
  tests. Hook races use controlled Tauri promises with the production hook;
  the device fallback test uses the real device-selection resolver.
- `cargo fmt -- --check`: PASS. `cargo test`: PASS, 204 tests, including 13
  network capture tests and the hidden-child-process guard.
- Standards and Spec independent reviews: PASS after fixing disconnect
  retention, in-flight lifecycle ordering, and request matching across tracking
  gaps. The final styling-only adjustment was inspected in the native app.
- `git diff --check`: PASS. `graphify update .`: code graph updated; semantic
  document extraction was not run. Existing build warnings are large frontend
  chunks and two unused ADB helper functions, unrelated to this feature.
- Stopped collector verification found no remaining PID-scoped logcat child.

Private local evidence (ignored by Git):

- `artifacts/network-inspector-20260911/native-live-flow-evidence.json`
- `artifacts/network-inspector-20260911/calendar-live-ui-export.json`
- `artifacts/network-inspector-20260911/final-parser-live-replay.json`
- `artifacts/network-inspector-20260911/npm-test-final.log`
- `artifacts/network-inspector-20260911/tauri-final-build.log`

Local runnable QA artifact:
`src-tauri/target/debug/bundle/macos/ADB Manager Network QA.app`.
The initial validation used a separate local QA build. No Calendar APK
modification or root operation was performed. Native validation was on macOS
with the connected Android 16 device; Windows desktop UI was not exercised.

## Release 2.2.8 follow-up

The user requested consistent package-only App labels and formal publication.
The redundant Calendar prefix has been removed. Version files, changelog and
bilingual update notes are part of this release. Publication is complete only
after signed/notarized macOS assets, CI Windows installers, the GitHub Release
and all three updater platforms have been verified.
