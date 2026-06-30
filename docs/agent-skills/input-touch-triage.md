# Input And Touch Triage

## User Story

As a device investigator, I want a touch/input workflow, so that I can separate missing input devices, bad focus routing, accessibility interception, and UI hierarchy visibility.

## Acceptance Criteria

- Input device state is captured.
- Focused/touchable window state is visible.
- Accessibility state is checked.
- UI hierarchy visibility is captured or marked unavailable.

## INVEST Check

- Independent: runs with only a selected online device.
- Negotiable: checks multiple possible input blockers before deciding root cause.
- Valuable: supports control, remote support, and QA input failures.
- Estimable: four bounded command steps.
- Small: focuses on input routing and hierarchy.
- Testable: evidence is recorded in the Copilot session.

## Boundaries

This skill does not inject touches or change accessibility settings. It only observes state.
