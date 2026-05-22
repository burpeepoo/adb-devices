# ADB Manager Device Console Design

Date: 2026-05-22

## Goal

Turn the first workspace tab into a high-density device console that helps PM and QA users quickly understand the selected device, connect missing devices, and jump into the right ADB workflow.

The console should make the app feel smoother from launch to action:

- If no device is selected, the console focuses on discovery and connection.
- If a device is selected, the console focuses on device identity, basic status, and shortcut entry points.
- Deeper diagnostic information is available but collapsed by default.

## Current Context

ADB Manager currently uses a three-column desktop shell:

- Left icon-only tool rail.
- Middle persistent device panel.
- Right workspace content.

The first tab is currently `pair`, labeled Pair & Connect / 配对连接. It owns wireless scan, manual connect, pair-code connection, recent connection shortcuts, and ADB recovery actions.

The app also has separate tool tabs for Workbench, APK install, screenshots, screen recording, remote control, image cast, clipboard, Logcat, and package management. These tool tabs should remain separate in the first phase.

## Product Direction

Use a hybrid device flow:

- The device panel remains persistent on the left side of the workspace.
- The first tab becomes Device Console / 设备控制台.
- The existing Pair & Connect behavior is absorbed into the console as a connection center.
- The console adapts based on whether a device is selected.

This avoids adding a second "console" entry next to "connect". Users open the app, see available devices, select or connect one, then use the same default tab to understand the device and jump to work.

## Primary Audience

Default for PM and QA workflows:

- Install builds.
- Capture screenshots or screen recordings.
- Start remote control.
- Push a reference image.
- Send text to the device.
- Check packages or Logcat when needed.

Developer and support diagnostics remain available through collapsed details, not as the default visual priority.

## Phase 1 Scope

Phase 1 should prove the navigation and default workspace model without rebuilding every feature page.

Include:

- Rename the first tab from Pair & Connect to Device Console.
- Add a new console page component that owns the default tab content.
- Embed or reuse the current connection UI inside the console's no-device and connection sections.
- Show selected-device identity and lightweight summary fields.
- Add shortcut actions that switch to existing tool tabs.
- Update the left tool rail so the active tab expands to show icon plus label while inactive tabs stay icon-only.
- Keep Settings and GitHub rail actions icon-only.

Do not include in Phase 1:

- Inline APK install, screenshot, screen record, Logcat, or package management inside the console.
- Full diagnostic command coverage.
- Multi-device dashboard beyond simple no-device discovery context.
- Rust command refactors unrelated to basic summary fields.

## Console States

### No Selected Device

The console should emphasize connection:

- A compact heading for connecting a device.
- Wireless scan results from the existing discovery flow.
- Recent connection shortcuts.
- Manual connect entry.
- Pair-code entry.
- ADB restart and rescan actions.

This state can reuse current PairConnect behavior, but the visual hierarchy should be more console-like: connection actions are the primary content, while instructional help is secondary.

### Selected Device

The console should show a device work surface:

- Device identity header.
- Core status summary.
- Shortcut action grid.
- Collapsed diagnostic details.
- Connection recovery actions remain accessible but visually secondary.

The selected device should remain controlled by the existing device panel. The console should not introduce a separate selected-device state.

## Device Identity Header

Show:

- Device note/name when available.
- `device_sn || serial` as the stable identity.
- Model.
- Online/offline/unauthorized state.
- USB, wireless, or unknown connection type.

Use the existing device identity rule: connected device row title remains `device_sn || serial`, and notes remain local-only store data keyed by `device_sn || serial`.

## Core Status Summary

Phase 1 may show partial fields while the UI structure is validated.

Preferred fields:

- Android version or build number.
- Battery level.
- Screen resolution and density.
- Storage summary.
- Current foreground app.
- ADB authorization or connection status.

Fields that are not available yet should render as unknown or loading without blocking the page. Phase 2 can add missing backend commands and richer refresh behavior.

## Shortcut Actions

In Phase 1, shortcuts switch to the existing tool tabs:

- Install APK -> APK Install tab.
- Screenshot -> Screenshot tab.
- Screen Record -> Screen Record tab.
- Remote Control -> Remote Control tab.
- Image Cast -> Image Cast tab.
- Clipboard -> Clipboard tab.
- Logcat -> Logcat tab.
- Packages -> Package List tab.

Shortcuts should preserve the current selected device context. They should not launch actions directly in Phase 1.

This keeps the first implementation low risk and lets the team test whether the console improves flow before deciding which actions deserve inline panels.

## Diagnostic Details

Diagnostics are collapsed by default.

Possible content:

- ADB serial.
- Device SN.
- IP and port when known.
- Android API level.
- Build fingerprint.
- Selected `getprop` values.
- Last refresh or connection error.

The collapsed state should be visibly available for support and debugging, but it should not dominate PM/QA workflows.

## Left Tool Rail Behavior

Change the rail from icon-only to active-label mode:

- Inactive tool tabs remain icon-only with tooltips.
- The active tool expands into a pill showing icon plus label.
- Settings and GitHub remain icon-only.
- The PageHeader still shows the full page title.

This balances readability with density. Users can always identify the current function without turning the rail into a full sidebar menu.

The shell rail width may increase from 64px to roughly 132-148px. The active item should have stable dimensions to avoid layout jumps when switching tabs.

## Component Architecture

Recommended frontend units:

- `src/components/DeviceConsole.tsx`
  - Owns console layout and selected/no-selected presentation.
  - Receives device state, settings, and callbacks from `App.tsx`.
- `src/components/DeviceConsoleShortcuts.tsx`
  - Renders shortcut actions and calls `onSelectTool`.
- Existing `PairConnect` can be reused or split into a connection-center subcomponent if needed.
- Existing `ToolRail` should support active-label rendering without changing App-level tab state.

App-level tab state should remain in `App.tsx`. The console should request tab changes through the same callback used by the rail.

## Data Flow

Preserve existing owners:

- `useDevices()` remains the source for device list, selected device, refresh, loading, and errors.
- `App.tsx` remains the owner of active tab, visited tabs, settings, shortcut events, and update state.
- Device notes remain in the existing store flow.
- Pair/connect command behavior stays in the existing connection component or extracted equivalent.

New device summary data can be introduced separately from the initial layout if it requires backend work.

## Error Handling

The console should surface errors in the same style as the rest of the app:

- Connection errors appear near connection controls.
- Device summary refresh failures should not block shortcut navigation.
- Unknown summary fields should degrade quietly.
- Recovery actions should be available for ADB restart and rescan.

## Testing And Verification

Automated checks after implementation:

```bash
npm run build
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo test
graphify update .
```

Manual checks:

- The first rail item opens Device Console.
- Active rail item shows icon plus label; inactive items stay icon-only.
- No selected device state still supports scan, pair, manual connect, and recent connect.
- Selecting a device changes the console into selected-device mode.
- Shortcut actions switch to the expected existing tabs.
- Existing tool tabs still preserve state when switching.
- Settings and GitHub actions remain icon-only and functional.

## Future Phase

After validating the first version, consider Phase 2:

- Add backend commands for richer device summary.
- Add inline lightweight actions for the highest-frequency operations.
- Add recent activity or last command results.
- Add stronger diagnostic grouping for support workflows.

Inline action candidates should be chosen from observed usage, not added all at once.
