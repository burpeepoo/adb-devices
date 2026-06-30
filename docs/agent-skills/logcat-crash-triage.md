# Crash And ANR Triage

## User Story

As an Android reliability investigator, I want a crash and ANR workflow, so that I can collect fatal exceptions, ANR breadcrumbs, DropBox entries, tombstone availability, and process restart context.

## Acceptance Criteria

- Recent fatal exception or ANR evidence is captured or absent.
- DropBox crash/ANR records are checked.
- Native tombstone availability is checked.
- Process restart or kill context is recorded.

## INVEST Check

- Independent: can run after a failure without needing a prior report.
- Negotiable: gathers evidence before assigning ownership.
- Valuable: supports high-signal reliability triage.
- Estimable: four bounded command steps.
- Small: scoped to crash/ANR evidence.
- Testable: evidence appears in session history.

## Boundaries

This skill does not clear logs, pull private tombstone contents, or assert root cause from a single line.
