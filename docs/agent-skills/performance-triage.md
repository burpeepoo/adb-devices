# Performance Triage

## User Story

As an Android performance investigator, I want a repeatable triage loop for slow or janky devices, so that I can separate app pressure, system pressure, render jank, thermal throttling, and unavailable counters.

## Acceptance Criteria

- CPU or process pressure is captured.
- App memory uses PSS as the primary footprint while retaining RSS as an auxiliary resident-set signal.
- Device memory uses `MemAvailable` headroom; a derived used percentage alone is not treated as memory pressure.
- ADB owns target-process memory and network truth; ordinary Agent APK self metrics are never relabeled as the target app.
- Foreground activity is confirmed.
- Frame rendering evidence is captured when available.
- Thermal and display-composition state are captured or marked unavailable.
- Optional APK Agent data is merged only when it is actually connected.

## INVEST Check

- Independent: can run after device selection without a prior report.
- Negotiable: allows ADB-only or Agent-plus-ADB evidence.
- Valuable: targets high-value launcher, widget, and UI-performance investigations.
- Estimable: four bounded command steps plus optional Agent sampling.
- Small: focused on triage, not full profiling.
- Testable: command results and source labels are stored in session history.

## Boundaries

The ordinary APK Agent cannot unlock privileged GPU counters. ADB probes remain the source for system CPU, thermal, display, and gfxinfo fallback data.
