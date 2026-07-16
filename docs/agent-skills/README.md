# Android Agent Skills

These skills are the source-backed workflow catalog embedded in ADB Manager's experimental Android Device Copilot.

## Contract

- Run through ordinary ADB and the optional ordinary APK Agent. Do not claim system-only access from the APK.
- Prefer evidence loops: collect command output, record unavailable data, then summarize what is known and unknown.
- Keep each skill small enough to run and review inside one Copilot session.
- Keep the in-app catalog in `src/androidAgentSkills.ts` aligned with these files.

Scout task-level review playbooks live separately under `docs/scout-skills/`. They may invoke these skills as bounded evidence subroutines, but they do not add another diagnostic template to this catalog.

## Catalog

- Device Report
- Performance Triage
- Black Screen Triage
- Calendar Sync Triage
- Install Failure Triage
- Wireless ADB Triage
- Input And Touch Triage
- Package State Triage
- Network Triage
- Crash And ANR Triage
- Storage Pressure Triage
