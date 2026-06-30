# Calendar Sync Triage

## User Story

As a Calendar investigator, I want a repeatable sync triage workflow, so that I can distinguish account, sync adapter, scheduler, package, network, and WorkManager causes when Google Calendar or Cozyla Calendar data does not refresh.

## Acceptance Criteria

- Account and sync adapter evidence is captured.
- JobScheduler state is visible.
- Calendar and Google package presence is checked.
- Recent sync-related logs are captured when available.

## INVEST Check

- Independent: can run without other Calendar tools.
- Negotiable: collects evidence before deciding root cause.
- Valuable: supports PM and QA diagnosis of Calendar sync failures.
- Estimable: four bounded command steps.
- Small: scoped to sync triage, not UI feature review.
- Testable: command output appears in Copilot session history.

## Boundaries

This skill cannot read private account tokens directly. It can only inspect Android-visible account, package, scheduler, provider, and log signals.

