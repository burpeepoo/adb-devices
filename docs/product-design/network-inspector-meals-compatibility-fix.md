# Meals HTTP log compatibility fix

Date: 2026-09-14. Status: code repair and automated/log-replay verification complete; fresh native capture pending device connectivity.
Review base: `c0f511c725246dd209ec72ed0d6e5a4085a425cf`.
User authorization: after the verified LCVC diagnosis, fix both the empty request list and fragmented response bodies.
Evidence: `artifacts/lcvc-mealplan-response-20260914/diagnosis.md`.

## Behavioral requirements

1. On the selected app main process, recognize both exact logger tags `OkHttp` and `okhttp.OkHttpClient` at collection and parsing. Preserve PID binding, timestamp validation, unknown-tag rejection, bounded buffers, lifecycle ownership and hidden host processes.
2. Reconstruct the observed logger-split JSON bodies without adding characters to JSON string values or removing real newlines. The verified logger can split long content into 4000-character chunks. Use format and declared byte-length evidence when resolving boundaries; do not treat every log line as a chunk.
3. Preserve complete small/multiline JSON behavior, interleaved-thread separation, UTF-8 correctness, response/request byte accounting, truncation/loss detection, credential masking, safe export and fail-closed handling when content cannot be reconstructed safely.
4. The LCVC Meals capture must show fresh requests and received responses. Replay the actual process-scoped HTTP stream to verify that the previously withheld seven valid JSON response bodies become complete and masked. Do not claim failed requests have received responses.
5. Keep app selection and capture behavior generic. No APK modification, device settings change, certificate installation, server mutation, public release, version bump or commit is part of this request.

## Test seams and execution plan

Continue the established public seams from `app-network-inspector.md`: raw backend log stream to bounded snapshot, and `HttpLogParser.ingest` to snapshot/export. The user's repair authorization applies to these existing seams. Native Tauri validation verifies the assembled path.

- [x] Add a failing backend raw-stream regression; implement a shared exact-tag allowlist and verify it.
- [x] Add a failing production-parser regression for the real body fragmentation pattern; implement evidence-based reconstruction in vertical slices.
- [x] Verify real newlines, mixed Unicode, loss, redaction and resource bounds at the existing seams.
- [x] Replay the real LCVC log stream through backend normalization and the production frontend parser.
- [x] Synchronize functional documentation and run the relevant full build/tests/format checks.
- [ ] Validate fresh capture in the fixed native desktop app on LCVC (app launch and offline-state smoke passed; device connectivity interrupted the fresh-capture step).
- [x] Independently review Standards and Spec against the fixed base; resolve findings.
- [x] Record exact results and remaining limitations.

Main agent owns frontend parsing/tests, integration, documentation, real-device replay and native validation. The backend sidecar owns only `src-tauri/src/commands/network.rs` and tests in that file. Reviewers are read-only. Existing unrelated worktree changes are preserved.

## Reconstruction rule and current evidence

OkHttp's [Android logger source](https://github.com/square/okhttp/blob/master/okhttp/src/androidMain/kotlin/okhttp3/internal/platform/android/AndroidLog.kt)
splits original lines into at most 4000 UTF-16 code units. This matches the live
Meals fragmentation evidence. The parser initially preserves line separators,
records candidate boundaries, and at END removes them only when their count
equals the excess over the declared UTF-8 body length and the result parses as
JSON. Otherwise the existing safe masking/incomplete behavior remains in force.
The byte-count check prevents treating a real 4000-character newline as a chunk.
Ambiguous mixtures are conservatively left unresolved. Pending snapshots and
missing END/length markers never justify reconstruction.

Initial repair validation: backend raw-stream and command tests each went RED
before their fixes, then GREEN; focused backend suite 14 passed. Frontend
chunked-response test went RED (`withheld` instead of `complete`) before the fix;
focused frontend/lifecycle suite 27 passed. A 516-line real LCVC stream was read
through current Rust normalization and replayed incrementally through the
production frontend parser. It produces 23 requests and 20 HTTP 200 responses;
all 7 previously withheld bodies are now complete, matching independently
reassembled full-payload references after baseline credential masking. Export
states were read back and verified. No credential-bearing raw logs were saved.
Evidence: `artifacts/lcvc-mealplan-response-20260914/fix/real-stream-result.json`.

WIP review uses `git diff c0f511c725246dd209ec72ed0d6e5a4085a425cf --` limited to the
implementation files and related spec/docs; there are no new commits to compare.
Pre-existing AGENTS.md and graph output changes are outside the repair review.

## Final verification and delivery

- Added a further RED/GREEN test for a request-start byte count with a missing
  request END marker. Reconstruction now uses only the final marker's declared
  size; it never borrows a start-line size as completion evidence.
- Final frontend/lifecycle focused suite: 28 passed. Full `npm test`: 230 passed
  across 30 suites. `npm run build`: passed; the final native build also rebuilt
  and typechecked the frontend successfully.
- `cargo fmt -- --check`: passed. Full `cargo test`: 205 passed, zero failures.
  No backend source changed after this final full Rust test run.
- Independent Standards review: zero actionable findings; final one-line
  hardening and its test reviewed again. Independent Spec review: zero
  actionable findings; reviewer reran 28 focused tests.
- `graphify update .`: passed, code graph refreshed (4803 nodes, 10136 edges).
  Semantic document extraction was not performed. Existing warnings remain the
  frontend's large output chunk and two unused Rust ADB helpers.
- Local native bundle built and launched successfully:
  `src-tauri/target/debug/bundle/macos/ADB Manager Network QA.app`.
  The Network Inspector page correctly showed its offline-device guard. The
  bounded QA app session was then closed; the existing installed app was not
  replaced, and no release/version/commit was made.

Fresh-device validation gap: after the successful 516-line real-device replay,
both existing wireless devices went offline. Reconnects to the verified LCVC
endpoint returned `No route to host`; one temporary `connected` result was
immediately followed by an empty device list and failed state/property probes,
so it is not treated as recovered connectivity. mDNS also advertised another
LCVC port, but that endpoint failed the same protocol checks. No ADB keys,
pairing cache, device state, or system permissions were reset. A clarification
about network changes was sent to the user; no answer had arrived at handoff.

The final source retains the passing real-log reconstruction behavior and adds
only stricter missing-END handling afterward. A repeat live read and fresh
native capture could not run after the connection loss. Completion of that
remaining acceptance check requires LCVC to be stably online again.

Validation logs and repair report are under
`artifacts/lcvc-mealplan-response-20260914/fix/`.
