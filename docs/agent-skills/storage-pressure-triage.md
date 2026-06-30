# Storage Pressure Triage

## User Story

As a device investigator, I want a storage-pressure workflow, so that I can confirm /data capacity, visible shared-storage usage, storage service health, and recent low-space errors.

## Acceptance Criteria

- Storage capacity and visible usage are captured.
- Storage service and mount state are visible.
- Large shared-storage directories are identified when readable.
- Recent low-storage logs are captured when present.

## INVEST Check

- Independent: runs with only a selected online device.
- Negotiable: records pressure before deleting or cleaning anything.
- Valuable: supports install, update, media, and app-runtime failures.
- Estimable: four bounded command steps.
- Small: focuses on storage evidence.
- Testable: command output appears in Copilot session history.

## Boundaries

This skill does not delete files, clear cache, or alter mounts. Cleanup must be explicit and separately reviewed.
