# Device Report

## User Story

As a device investigator, I want one repeatable report for a connected Android device, so that I can confirm identity, build, display, storage, memory, battery, and important package context before deeper debugging.

## Acceptance Criteria

- Device identity and software baseline are captured.
- Display and storage state are captured.
- Memory and battery constraints are captured.
- Google, Cozyla, launcher, and Calendar package presence is visible when available.

## INVEST Check

- Independent: runs without other skills.
- Negotiable: defines evidence to capture, not a single fixed conclusion.
- Valuable: establishes the baseline for support, QA, and PM review.
- Estimable: four bounded command steps.
- Small: completes in one Copilot session.
- Testable: command output appears in session history.

## Boundaries

This skill does not diagnose root cause by itself. It creates a baseline report and records missing evidence honestly.

