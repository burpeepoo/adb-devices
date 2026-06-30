# Black Screen Triage

## User Story

As a device investigator, I want a black-screen workflow that checks window focus, top activity, display composition, and crash evidence, so that I can avoid incorrectly blaming Launcher when SystemUI, display HAL, or SurfaceFlinger is responsible.

## Acceptance Criteria

- Focused window or missing focus is visible.
- Top activity state is captured.
- Display and SurfaceFlinger state are checked.
- Recent fatal, ANR, SystemUI, SurfaceFlinger, display, or WindowManager logs are captured when present.

## INVEST Check

- Independent: runs on any selected online device.
- Negotiable: evidence collection stays separate from final diagnosis.
- Valuable: supports high-severity black-screen investigations.
- Estimable: four bounded command steps.
- Small: triages the failure class without full log extraction.
- Testable: evidence is stored in the Copilot session.

## Boundaries

This skill does not assert root cause from a single log line. It records what evidence supports each possible owner.

