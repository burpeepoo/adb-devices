# Package State Triage

## User Story

As an Android app investigator, I want a package-state workflow, so that I can confirm package presence, enablement, permissions, app ops, and default handlers before changing app state.

## Acceptance Criteria

- Relevant package presence is visible.
- Disabled or suspended package state is checked.
- Permission and app-op clues are captured.
- Default handler or launcher role evidence is recorded.

## INVEST Check

- Independent: can run after device selection.
- Negotiable: collects package evidence before recommending mutation.
- Valuable: helps diagnose hidden apps, missing launcher icons, and default-app confusion.
- Estimable: four bounded command steps.
- Small: focuses on package state only.
- Testable: command output appears in session history.

## Boundaries

This skill does not enable, disable, grant, revoke, or clear app data. Any mutation must be explicit and separately reviewed.
