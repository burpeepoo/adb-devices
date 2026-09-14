# Fixed primary navigation

Source: the user's 2026-09-14 request and annotated screenshot.

The Device Console and Agent Tasks entries, including their Primary group label,
must stay at the top of the left rail while the user scrolls. Capture,
Diagnostics, Apps, and Utilities share the remaining scrollable area. Settings
and GitHub retain their existing footer positions.

Acceptance:

- Scrolling the tool list in either direction leaves both primary entries at
  the same screen positions and keeps them clickable.
- The last tool remains reachable; scrolling the workspace or device list does
  not move the primary entries.
- The same separation applies to the compact icon rail, with existing labels,
  tooltips, active states, and navigation preserved.

Implementation: reuse the existing primary emphasis metadata and split the
rail into a non-shrinking primary area, a flexible scroll area, and the existing
footer. No new application state or device behavior is needed.

Native validation also exposed stale active-button colors after route changes:
the DOM correctly reported `Devices: false` and `Agent Tasks: true`, while the
computed backgrounds still showed Devices as active. Temporarily adding and
removing a class restored the expected colors without changing React state.
The navigation now drives active styling with an explicit class derived from
the same active flag; existing state attributes remain available. This is a
bounded styling fix to preserve selection feedback, not a confirmed root cause
in the browser engine. The native console probe under the evidence directory
reproduced the mismatch (`pass: false`) before this adjustment.

Validation plan: run the repository build and existing frontend/Rust checks,
verify scrolling and navigation in a bounded Tauri desktop session, refresh
the code graph, and review the scoped diff against commit
`cf82b7aa10ead5855008a358752d70ae15ee4e24` for standards and this specification.

Validation results:

- `npm run build`: passed (existing large-bundle advisory).
- `npm test`: 225 passed, 0 failed; design contract lint passed.
- `cargo fmt -- --check`: passed.
- `cargo test`: 204 passed, 0 failed (existing unused-helper warnings).
- Independent Standards review: no actionable findings.
- Independent Spec review: no actionable findings.
- `graphify update .`: completed, 4,679 nodes and 9,949 edges; this refreshes
  code relationships, not semantic extraction of changed documentation.
- Desktop interaction check: passed in the real Tauri app at 1180px and 1040px
  widths. The primary region stayed fixed when the tools scrolled to the final
  Clipboard item and back up. Both primary buttons remained clickable, the
  workspace scrolled independently, and the footer stayed in place.
- Pixel comparisons of the primary regions before/after scrolling are
  identical at both widths. The final compact screenshots also preserve the
  same positions after the active-style adjustment.
- `native-active-state-probe.js` in the Tauri Web Inspector: `pass: false`
  before the adjustment, `pass: true` afterwards. It switches both primary
  routes and compares their state attributes and rendered backgrounds.
- The final local debug app bundle completed successfully with updater
  artifacts disabled. The earlier packaging attempt produced a runnable app
  but failed the unused updater-signing step; no formal release was produced.
- An overlapping Rust test/build run encountered missing dependency artifacts
  during doctests. The full Rust suite was rerun alone afterwards and passed,
  including doctests. The final authoritative log is
  `rust-tests-final-serial.log`.

The dedicated local debug bundle uses a separate application identifier. Its
temporary 900px minimum width allows compact-rail verification; the production
1180px minimum is unchanged. The installed application was not replaced, and
the temporary verification application and development processes were stopped.

Final review: Standards and Spec reviewers both found no actionable issues,
including equivalent hover specificity for the active-style change.

Detailed logs are under `artifacts/fixed-primary-navigation-20260914/`.

Status: implementation completed and validated locally. Release target: v2.2.9.
Publication status is recorded in the corresponding GitHub Release.
