# ADB Manager Functional Model

Last reviewed: 2026-05-28

This folder is the product and implementation model for the Cozyla ADB Manager app. It is meant to be a durable asset for future summaries, requirement reviews, optimization work, and release planning.

## Source Of Truth

The model was built from the current codebase:

- Frontend: `src/App.tsx`, `src/components/`, `src/hooks/`, `src/types/`
- Tauri commands: `src-tauri/src/commands/`
- Shared ADB execution: `src-tauri/src/adb.rs`
- Release automation: `scripts/`, `.github/workflows/`, `CHANGELOG.md`
- Persistence: Tauri store file `settings.json` through `src/storage.ts`

If code and these docs disagree, treat code as the immediate source of truth and update this folder in the same change.

## Document Index

- `product-overview.md`: product shape, users, architecture, app shell, cross-cutting principles.
- `domain-model.md`: core entities, persisted keys, state machines, risk model.
- `feature-spec.md`: per-feature requirement and logic breakdown.
- `command-map.md`: frontend actions to Tauri commands to ADB/shell behavior.
- `release-and-ops.md`: build, update, release, validation, and artifact contract.
- `known-risks-and-open-questions.md`: implementation risks, ambiguous behavior, and follow-up checks.
- `../product-design/scout-agent-task-architecture.md`: target Scout product architecture, naming, task model, permission tiers, evidence/report rules, and phased rollout plan.

## How To Use This Asset

For product or requirement discussion, start with `product-overview.md`, then drill into `feature-spec.md`.

For a bug report, first identify the feature section in `feature-spec.md`, then inspect the related commands in `command-map.md`.

For changes involving device identity, wireless recovery, updater behavior, or release packaging, update the matching model file as part of the code change.

For release work, use `release-and-ops.md` together with the `adb-project` skill. The skill remains the operational checklist; this folder explains the product and behavior model.

## Current Functional Surface

The app exposes these tool areas:

1. Device console and device list
2. Wireless pair/connect and ADB recovery
3. ADB workbench
4. APK installation
5. Screenshot
6. Screen recording
7. Screen mirroring with scrcpy
8. Image cast to device
9. Clipboard text input
10. Logcat
11. Display calibration lab
12. Package list and APK export
13. Settings, language, updater, and ADB/scrcpy installation helpers

## Maintenance Rules

- Keep user-visible behavior, state names, commands, and storage keys explicit.
- When adding a new Tauri command, add it to `command-map.md`.
- When adding or changing a tab, update `product-overview.md`, `feature-spec.md`, and `domain-model.md`.
- When changing release scripts, updater metadata, or package assets, update `release-and-ops.md`.
- When behavior is intentionally different from older releases, record that distinction in `known-risks-and-open-questions.md` if it can affect future debugging.
