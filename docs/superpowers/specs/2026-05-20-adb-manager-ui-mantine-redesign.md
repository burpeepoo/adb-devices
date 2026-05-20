# ADB Manager Mantine UI Redesign

Date: 2026-05-20

## Goal

Refresh ADB Manager into a denser, more consistent desktop utility UI while preserving the existing ADB workflows and Tauri command behavior.

The approved direction is a Mantine-based main shell with a left tool rail, persistent device panel, main workspace, shared status bar, and reusable feedback/output components. The first implementation phase should modernize the app frame and migrate moderate-complexity pages without rewriting every tool page at once.

## Current Context

The app is a Tauri 2 + React 19 + TypeScript + Tailwind 4 project. Frontend code lives in `src/`; Rust ADB commands live under `src-tauri/src/commands/`; shared ADB execution lives in `src-tauri/src/adb.rs`.

The current UI is mostly direct Tailwind utility classes inside feature components. There is no third-party React UI component library. `AdbWorkbench.tsx`, `PairConnect.tsx`, and `ApkInstall.tsx` contain the highest UI/state complexity and should not all be fully rewritten in one pass.

Graphify identifies the Tauri invoke command pattern, device identity flow, and ADB execution helpers as core project structures. This redesign should stay on the frontend presentation layer and avoid unrelated Rust/ADB refactors.

## Framework Choice

Use Mantine as the primary UI component system.

Initial packages:

- `@mantine/core`
- `@mantine/hooks`
- `@mantine/notifications`
- `@mantine/modals`
- `@mantine/dropzone`

Mantine is chosen because the desired direction is a complete desktop-tool component system rather than a custom Tailwind component layer. It provides production-ready inputs, buttons, modals, tabs, notifications, layout primitives, theme tokens, and dropzone behavior that fit the app's repeated forms and file workflows.

Tailwind can remain available during migration, but new shared UI should prefer Mantine components and theme tokens. Tailwind utilities should be limited to local layout glue when Mantine props are not enough.

## Navigation Model

Replace the current top tab bar with a double-sidebar desktop shell:

- Left tool rail: compact icon navigation for major tools.
- Device panel: persistent selected-device context, online/offline groups, notes, refresh, and quick connection entry points.
- Main workspace: current tool content.
- Bottom status bar: global ADB/scrcpy/device refresh state.

Approved tool rail groups:

- Pair & Connect
- Workbench
- APK Install
- Screenshot
- Screen Record
- Screen Mirror
- Clipboard
- Logcat
- Packages
- Settings

Use icons with tooltips for the rail. Avoid visible helper text that explains basic app usage inside the product surface.

## Component Architecture

Introduce shared layout components:

- `src/components/layout/AppShellLayout.tsx`
- `src/components/layout/ToolRail.tsx`
- `src/components/layout/DevicePanel.tsx`
- `src/components/layout/StatusBar.tsx`
- `src/components/layout/PageHeader.tsx`

Introduce shared common components:

- `src/components/common/ResultAlert.tsx`
- `src/components/common/CommandOutput.tsx`
- `src/components/common/PathSelector.tsx`

The shell components own layout and visual hierarchy only. They should receive current app state and callbacks from `App.tsx`; they should not call Tauri commands directly except where an existing component already owns that behavior and is intentionally migrated.

## State And Data Flow

Preserve these existing state owners and contracts:

- `useDevices()` remains the source for device list, loading/error state, selected device, and refresh.
- `App.tsx` keeps `selectedDevice`, `settings`, `mirroringDeviceSerial`, ADB availability, and screenshot shortcut event handling.
- Tauri store keys stay unchanged: `STORE_KEYS.settings`, `STORE_KEYS.deviceNotes`, `STORE_KEYS.pairConnect`, and existing feature-specific keys.
- Device identity remains `device_sn || serial`.
- Connected device display title remains `device_sn || serial`.

Do not change Rust command names, invoke payloads, ADB serialization behavior, or timeout semantics as part of this UI redesign.

## First Migration Scope

Phase 1 should migrate the main shell and moderate-complexity pages:

- Add Mantine provider, CSS imports, notifications, and modals provider.
- Replace the app frame with the double-sidebar shell.
- Convert `Settings` to Mantine modal form controls.
- Convert `DeviceList` into the new `DevicePanel` shape while preserving notes and selection behavior.
- Update `PairConnect` outer layout, inputs, buttons, and result alerts, without rewriting mDNS or pair/connect state logic.
- Update `Screenshot` and `ScreenRecord` forms, path display, primary actions, and result alerts.

Phase 1 should embed these pages mostly unchanged inside the new shell:

- `AdbWorkbench`
- `ApkInstall`
- `Logcat`
- `PackageList`
- `ScreenMirror`
- `Clipboard`

These can be migrated in later passes after the shell and shared components are stable.

## Visual Design Rules

The UI should feel like a focused desktop operations tool:

- Use compact spacing and predictable alignment.
- Use neutral surfaces with Mantine blue as the main accent.
- Use status colors only for meaningful states: success, warning, destructive, running, offline.
- Keep cards shallow and functional; avoid nested decorative cards.
- Use monospaced output areas for command previews, logs, stdout, and stderr.
- Use tooltips for icon-only controls.
- Use stable dimensions for rail buttons, device rows, status badges, and output panels to prevent layout shifts.

## Error Handling And Feedback

Use shared components for repeated feedback patterns:

- `ResultAlert` for success/error/warning result messages.
- `CommandOutput` for command previews and stdout/stderr display.
- Mantine notifications for global or shortcut-triggered events where an inline result would be hidden.

Feature-specific error handling should stay close to the feature logic. The redesign should standardize display, not collapse all feature behavior into one global error model.

## Accessibility

The new shell must keep keyboard and screen-reader basics intact:

- Rail items need labels via tooltip and accessible labels.
- The selected tool and selected device should have visible selected states.
- Inputs must retain labels.
- Modal focus should be managed by Mantine.
- Destructive or high-risk actions should retain explicit disabled/confirmation states where they exist.

## Testing And Verification

Build verification:

```bash
npm run build
```

Manual verification:

- ADB availability gate still shows setup flow when ADB is missing.
- Device refresh works.
- Device selection updates the active tool context.
- Device notes save and reload.
- Pair/connect manual inputs still save and execute.
- mDNS discovery and pair/connect operations still serialize.
- Screenshot button and global screenshot shortcut still work.
- Screenshot and recording directories still save.
- Screen record start/stop state still displays correctly.
- Screen mirror status still syncs into the device panel.
- Settings language and path changes still persist.

After code modifications, run:

```bash
graphify update .
```

## Non-Goals

This redesign does not include:

- Rust ADB command refactors.
- New ADB features.
- Rewriting `AdbWorkbench`, `ApkInstall`, or `Logcat` internals in the first pass.
- A marketing-style landing page.
- Removing Tailwind from the project during the first pass.

## Risks

The main risk is regression in complex stateful pages if visual migration is mixed with behavior changes. The mitigation is to migrate shell and shared UI first, preserve existing state owners, and defer deep page rewrites.

Another risk is style inconsistency during the transition while Tailwind and Mantine coexist. The mitigation is to define Mantine as the default for new shared UI and only use Tailwind as local layout glue during migration.
