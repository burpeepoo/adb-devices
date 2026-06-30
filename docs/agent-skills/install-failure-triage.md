# Install Failure Triage

## User Story

As an Android release or QA investigator, I want a repeatable install-failure workflow, so that I can separate policy restrictions, package conflicts, storage pressure, installer state, and PackageManager errors.

## Acceptance Criteria

- Install policy and user restriction state are visible.
- Storage headroom is captured.
- Package installer state is checked.
- Recent PackageManager or PackageInstaller errors are captured when present.

## INVEST Check

- Independent: runs on a selected online device after a failed install attempt.
- Negotiable: gathers evidence before prescribing uninstall, firmware, or settings changes.
- Valuable: targets a common APK validation blocker.
- Estimable: four bounded command steps.
- Small: focuses on install failure, not full package governance.
- Testable: command output appears in Copilot session history.

## Boundaries

This skill does not change install policy, uninstall apps, or grant permissions. It only records evidence for the next decision.
