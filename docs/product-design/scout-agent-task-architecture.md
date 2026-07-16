# Scout Agent Task Architecture

Last updated: 2026-07-13

## Decision Summary

ADB Manager remains a general-purpose ADB toolbox for Android engineers, QA, and support users who understand ADB basics. Scout is the user-facing intelligent layer that differentiates the product by turning ADB tools, Agent APK data, screenshots, Logcat, performance samples, notes, and UI actions into task timelines and exportable reports.

The product should no longer present every capability as a flat tool shelf. The target shape is:

1. Current-device workbench as the main workspace.
2. Professional ADB tools grouped as a tool library.
3. Scout/Agent tasks as the primary guided task layer.
4. Agent Tasks as the only Scout workspace, not a global floating assistant.
5. Agent/Provider/APK/CLI as technical configuration names; Scout as the user-facing brand.

Current implementation boundary:

- Scout/Agent Tasks use a modular-monolith bounded context in `src/scoutTask/`.
- `AgentCopilot.tsx` remains the presenter/controller for the Tauri UI and adapters, but Scout task rules live in pure domain functions.
- Chat, Feature Walkthrough, and Bug Repro share the same active task resolver; Chat can read an active task record without creating hidden evidence.
- Chat, Feature Walkthrough, and Bug Repro each support an optional working directory in the bottom input/action area. It is passed to Agent CLI turns and stored with the relevant conversation or task record, while leaving it blank falls back to the selected CLI profile working directory.
- Existing `agentCopilotSessions` and `evidenceSessions` store keys remain stable, so historical local records stay compatible.

## North Star

As an Android engineer, QA, or support user, I want a safe and traceable ADB workspace with Scout-assisted tasks, so that I can operate devices quickly, avoid wrong-device mistakes, and produce evidence-backed reports for engineering.

Core promise order:

1. Safe device targeting and risky-action control.
2. Traceable diagnosis and evidence/report output.
3. Fast access to common ADB tools.

## Naming Rules

User-facing intelligent layer:

- Use `Scout`.
- Examples: Scout task, Scout report, Scout suggestion, Scout is analyzing.

Technical and configuration layer:

- Use `Agent`.
- Examples: Agent CLI, Agent APK, Agent Provider, Agent task permission.

Deprecated product-facing concepts:

- Remove `Agent 实验室` / `Agent Lab` as a primary navigation concept.
- Remove standalone `Evidence Session` / independent evidence recording from the user model.
- Do not expose `QA Scribe` as a primary navigation name. It may remain an internal implementation or sub-feature label if needed.

## Target Information Architecture

### Current Device Workbench

The selected device is the product's main workspace. It should show:

- Device identity and target status.
- Key health/status summary.
- Scout task entry points.
- Current running Scout task console.
- Recent task/report summary.
- Shortcuts to grouped tool library sections.

### Tool Library

Professional tools remain available, but should be grouped instead of all appearing as equal top-level tabs:

- Connection and recovery: wireless pair/connect, ADB recovery.
- Capture and viewing: screenshot, recording, local mirror, remote control, image cast.
- App and package: APK install, package manager, export.
- Diagnostics: Logcat, performance sampling, Workbench.
- Utilities: clipboard, settings.

### Scout Tasks

First-batch task types:

1. Bug reproduction.
2. Feature walkthrough.
3. Device diagnosis report.
4. APK install troubleshooting.
5. Wireless ADB repair.

Performance investigation remains a tool and evidence source for the first batch, not a first-screen Scout task.

## Screen Layout Architecture

This section captures the original layout direction from the product grill. It is the layout source of truth for future UI refactors. Functional details later in this document should bend to this structure unless there is strong evidence that the structure no longer works.

### App Shell

The app should use a stable desktop operations shell:

1. Left navigation rail.
2. Device list / target selection column.
3. Current-device workspace.
4. Agent Tasks workspace for guided Scout tasks.

Layout priority:

- The selected device is always visible as the working target.
- Scout task state is visible inside the Agent Tasks workspace without hiding the selected device context.
- Tool surfaces should not feel like unrelated full-page apps.
- Scout should not introduce a second global entry model that behaves differently from the main app shell.

Desktop default:

- Keep the left navigation rail and device list visible.
- Use the main workspace for the current device and active task.
- Use Agent Tasks for Scout chat, quick suggestions, runtime health, and task state.

Narrow or constrained window:

- Device list may collapse behind a target selector.
- Agent Tasks may stack into a single-column task workspace.
- Active Scout task state still belongs to the Agent Tasks workspace, not a transient overlay.

### Current Device Workspace

The current-device workspace should be the product's first meaningful screen after device selection. It should not be a marketing page or a flat shortcut grid.

Recommended vertical order:

1. Target device header.
2. Health and readiness strip.
3. Scout task launcher and active task status.
4. Recent reports / recent task outcomes.
5. Tool library shortcuts.
6. Device details and lower-frequency diagnostics.

Target device header:

- Shows human name, stable serial/SN, transport type, online/offline state, and target lock.
- Makes wrong-device risk visually hard to miss.
- Contains only target-level actions, such as refresh, lock/unlock, or reconnect.

Health and readiness strip:

- Summarizes ADB state, Agent APK state, Scout runtime state, save-path readiness, and Scout control/accessibility state.
- Uses short states, not long explanations.
- Each state links to the relevant fix surface when actionable.

Scout task launcher:

- Promotes Bug Repro and Feature Walkthrough as equal primary task entries.
- Device Diagnosis Report is secondary but still visible.
- APK install troubleshooting and Wireless ADB repair can be suggested contextually when the active device state indicates them.
- Starting a task should feel like starting a guided work session, not submitting a chat message.

Recent reports:

- Shows the latest generated Scout reports and active/incomplete task records.
- Lets the user reopen a task record, copy summary, or export evidence package.
- Does not expose raw evidence as a standalone navigation concept.

Tool library shortcuts:

- Groups tools by job, not by implementation component.
- Shortcuts open the underlying professional tools while preserving the selected target.
- If a Scout task is running, manual tool outputs may be captured into that task's timeline when relevant.

### Tool Library Layout

The long-term navigation should reduce top-level tool sprawl. Tools are still first-class, but they should read as a professional toolbox grouped under the current device.

Recommended groups:

1. Connect and recover: wireless pairing, reconnect, ADB repair.
2. Capture and view: screenshot, recording, local mirror, remote control, image cast.
3. Apps and packages: install APK, package manager, export APK.
4. Diagnose: Logcat, performance sampling, ADB Workbench.
5. Utilities: clipboard, settings, GitHub/release/help surfaces.

Top-level navigation should keep only durable product destinations:

- Device Console / Current Device.
- Agent Tasks.
- Tool Library.
- Settings.

During migration, existing top-level entries may remain for familiarity, but the target direction is grouped discovery from the current-device workspace and tool library.

### Scout Task Workspace

Scout task UI should use a task-console layout instead of a chat-first layout. A run is one automatic unit of work: the user provides scope, Scout observes and acts, then the terminal assessment becomes the report.

Recommended task page regions:

1. Task summary rail or header.
2. Scout assessment panel.
3. Evidence timeline.
4. Action bar.
5. Report preview.

Task summary:

- Task type, goal, target device, automatic-execution state, Agent APK state, accessibility/control state, runtime state, elapsed time, and status.
- Shows the exact UI run state: not started, running, generating report, completed, blocked, stopped, or failed. `agent_completed` is not a user-facing lifecycle state: an Agent terminal response is only complete after the task record is closed with its outcome.
- Current workspace implementation: the Agent Tasks tab opens as a Scout task console, with Feature Walkthrough selected by default. The left rail contains icon-led task tabs for Chat, Feature Walkthrough, and Bug Repro. Recent chats appear only while Chat is selected; Walkthrough and Bug Repro each show their own mode-scoped task-record history in the left task console, and the main evidence panel shows the active task or selected historical task timeline for that mode. The task tabs expose tab semantics and keyboard navigation instead of numbered step cards. Chat, Walkthrough, and Bug Repro show an optional working-directory row at the bottom of the composer or action area, matching the Codex mental model without making the directory required. Walkthrough and Bug Repro place the goal field and a short primary Start action in the bottom start area. Starting a task probes the selected Agent CLI before creating the task record; if the command is unavailable, Scout opens runtime health instead of recording a doomed task. Once started, the task executes automatically until the Agent declares `COMPLETED`, `BLOCKED_NEEDS_HUMAN`, or `FAILED`; that terminal response becomes the report and closes the record. Active records also expose Stop task as a lifecycle recovery action beside Export. It remains available after an Agent turn finishes, closes and preserves the record, and releases the start gate for a new task. The UI summarizes the small protected boundary and, when blocked, states why it stopped, the single human action required, and how execution can continue.

Scout assessment:

- Short, continuously updated assessment.
- Contains current coverage, suspected gaps, risk, and next action.
- Should not become a long chat transcript.

Evidence timeline:

- The main fact base for engineering.
- Contains screenshots, UI snapshots, screen states, foreground/package context, Logcat when a failure or repro symptom makes it relevant, UI/ADB actions, and Scout notes. Performance samples are opt-in diagnostics, not default task evidence.
- Supports filtering by artifact type later, but first version can keep a single chronological timeline.

Action bar:

- Start before a task begins.
- Export evidence package for active and historical records.
- No manual screenshot, recording, issue-marker, note, approval, or stop-and-report control in task mode.

Report preview:

- Appears during and after report generation.
- The final report is the primary output, not the chat transcript.

### Scout Drawer Layout

The drawer should feel like a persistent assistant, not a second application inside the application.

Recommended top-to-bottom order:

1. Scout title and current mode.
2. Active task summary, if any.
3. Runtime and capability health: Agent APK, CLI/model provider, accessibility/control.
4. Lightweight chat or suggestions.
5. Composer.

Mode handling:

- Chat is the default drawer mode.
- Walkthrough and Bug Repro can be shown as quick task entry tabs or chips, but opening a complex task should move the user to the main task workspace.
- If a task is already running, the drawer should show status and next action, plus a button to open the full task console.

Scout workspace non-goals:

- Do not duplicate Scout controls in a floating drawer or bottom-right icon.
- Do not hide the selected-device context behind a long task form.
- Do not make switching tabs stop, pause, or lose task state.

### Layout Migration Plan

Phase A: Naming and entry cleanup.

- Ship Scout vocabulary.
- Rename primary navigation to Agent Tasks.
- Keep current implementation surfaces working.

Phase B: Task-first Scout surface.

- Move Bug Repro and Feature Walkthrough controls toward a task-console structure.
- Keep chat available but secondary during active tasks.
- Make start gates and capability summaries visible before task start.
- Current implementation status: the Agent Tasks workspace now defaults to Feature Walkthrough, promotes Feature Walkthrough and Bug Repro as first-class task choices in the left task rail, keeps recent conversations secondary, and keeps active tasks on the task page after Agent start so the goal, timeline, and red stop/report button remain visible. The global Scout drawer and bottom-right icon are removed.

Phase C: Current-device workspace consolidation.

- Move task launchers, health readiness, recent reports, and tool shortcuts into the current-device workspace.
- Reduce the feeling that every tool is a separate app.
- Current implementation status: the Device Console now promotes Feature Walkthrough and Bug Repro as primary Scout task launchers below the selected-device header, and groups lower-level utilities into Capture/Control, Diagnostics, and Apps/Packages sections.

Phase D: Tool library grouping.

- Group existing tools into the recommended job-based categories.
- Keep direct access for expert users, but stop making every tool a peer top-level destination.
- Current implementation status: the left navigation keeps all existing tool routes for expert access, but visually groups them under Primary, Capture, Diagnostics, Apps, and Tools, with Device Console and Agent Tasks promoted as primary destinations.

### Layout Acceptance Criteria

- A new user can identify the selected target device before starting any action.
- A user can start Bug Repro or Feature Walkthrough from the current-device workspace without understanding raw evidence sessions.
- A user can tell whether Scout is ready: runtime, Agent APK, save path, and control capability.
- A running task remains visible after switching away from and back to Agent Tasks.
- The final report and evidence package are visually treated as the task output.
- Existing ADB tools remain reachable without competing with Scout tasks as the product's main story.

## Scout Workspace Boundary

Scout is entered from Agent Tasks only:

- It can answer lightweight questions.
- It can suggest and start Scout tasks.
- It can show current task status and next action.
- It hosts walkthrough/repro/diagnosis task UI in one consistent place.
- Switching tabs must not stop a running task.

Complex tasks stay in the Agent Tasks workspace as a task console.

## Scout Task Console

Task modes should use a task console, not a chat-first UI.

Required regions:

1. Task header: task type, target device, task goal, permission level, status.
2. Start/stop controls.
3. Evidence timeline.
4. Scout current assessment and next action.
5. Final report preview.
6. Copy summary and export evidence package actions.

Minimum task controls for fully automatic Scout runs:

- Start.
- Stop task.
- Export evidence package.

All other evidence collection is automatic. Do not expose manual screenshot, recording, issue-marker, note, approval, or attachment controls in the run console.

No pause/continue in the first implementation. Supported states:

- Not started.
- Running.
- Generating report.
- Completed.
- Blocked / needs human action.
- Stopped.
- Failed.

## Scout Task Bounded Context

The Scout task kernel is a local DDD-style bounded context, not a full app rewrite. It centralizes task state transitions and emits explicit events while preserving existing Tauri command APIs.

Commands:

- `StartTask`
- `AddArtifact`
- `RunAgentTurn`
- `RequestTool`
- `AutoExecuteTool`
- `CloseTask`

Events:

- `ScoutTaskStarted`
- `ArtifactAdded`
- `AgentRunStarted`
- `ToolAutoExecuted`
- `FinalReportGenerated`
- `ScoutTaskClosed`
- `ScoutTaskFailed`

Domain rules:

- Only one Scout task can run at a time.
- The running task binds to `device_sn || serial`.
- Evidence cannot be appended from a different selected device unless the stable device identity matches.
- Starting requires selected device, available CLI runtime, configured artifact save directory, and a non-empty goal. Agent APK/accessibility readiness is shown as a capability state; if unavailable, Scout uses the ADB/UIAutomator recovery path and reports the evidence limitation instead of presenting a hidden approval workflow.
- Optional working directory is not a gate; when provided, Scout persists it on the conversation or task and passes it as Agent CLI cwd for subsequent turns.
- Autonomous Scout turns use `medium` as the bounded effort default when the selected CLI profile has no explicit effort; explicit model/effort choices remain authoritative. Codex desktop turns consume `output-last-message` through a non-stream completion path so a child-process pipe cannot leave a run stuck in Running after the CLI exits.
- Report generation failure keeps the task active and retryable; it must not silently close the record.
- Active Feature Walkthrough and Bug Repro tasks always use `auto_execute`; routine in-scope actions run without approval cards. The active task has no user-facing semi-automatic mode.
- Protected command and UI boundaries are blocked and converted into explicit `BLOCKED_NEEDS_HUMAN` guidance instead of an approval request.
- When a Feature Walkthrough has a selected target package, Scout performs a deterministic start preflight: launch the package, capture a fresh UI snapshot, and record the launch evidence before the first Agent turn. A non-empty user goal is authoritative; missing reference material or an unstated expected result is an evidence gap or an inferred assumption, not a reason to stop safe device coverage.
- During autonomous execution, prompt construction keeps the authoritative goal, target package, reference, and project context at both the head and the tail of the bounded prompt. If the Agent repeats inspection without producing an action, Scout permits only a bounded safe fallback; fallback candidates must be enabled and genuinely clickable or resolvable from a visible label/content description, so resource-ID-only child nodes cannot receive a synthetic tap. Goal matching ranks complete token matches above substring matches, preventing `Today` from winning over the requested `Day` mode. When the goal describes a selector, switch, toggle, setting, or mode, control-like resource IDs are preferred and directional IDs such as `*_left`, `*_right`, `*_prev`, or `*_next` are penalized, preventing a month navigation arrow from winning over a view-mode control. It excludes generic package-name matches and previously unverified targets. If terminal synthesis still misses the outcome contract, a deterministic `COMPLETED` closeout is allowed only after a successful UI action, a changed non-empty post-action snapshot, and a goal-related visible node; otherwise it closes with a deterministic failure when no observable UI progress remains.

Ports and adapters:

- Domain code defines the task rules and adapter shape.
- UI adapters call Tauri invoke commands, Agent CLI turns, Workbench execution, screenshot capture, Logcat capture, store persistence, and evidence export.
- The current version still depends on Agent CLI execution. Model API providers are configuration/probe information until a direct execution adapter exists.

## Task Start Gates

Starting a Scout task requires:

1. An explicitly selected online device.
2. A usable Scout runtime. Current implementation requires an available Agent CLI; configured model API providers are shown in health/probe UI but do not satisfy the start gate by themselves.
3. Writable save directory for artifacts.
4. A non-empty task goal.
5. No additional user approval step. Agent APK/accessibility status is recorded as capability evidence.

Agent APK/accessibility is a capability, not a hidden approval gate:

- If it is installed and usable, Scout uses accessibility-first inspection and actions.
- If it is missing, disabled, or limited, Scout attempts the deterministic ADB/UIAutomator fallback and records the reduced-confidence path.
- Only an actual protected operation or an unrecoverable device/runtime failure can block the run.

If Scout runtime is unavailable, do not allow Scout task start. Do not degrade a Scout task into standalone evidence recording.

## Automatic Execution Boundary

Feature Walkthrough and Bug Repro expose one task behavior: automatic execution until a terminal Agent outcome. There is no user-facing permission level, default, or override at task start.

Routine in-scope actions run directly, including navigation, swipe, back, ordinary confirm/submit/continue actions, evidence reads, screenshots, relevant Logcat snapshots, screen state, and UI actions. Performance context and Agent APK sampling are diagnostics, not default walkthrough evidence.

Protected boundaries are deliberately narrow:

- Sign-in/sign-out and account authorization changes.
- Permission grant/revoke operations.
- Purchase, payment, subscription, checkout, and order submission.
- Clear data/storage/cache, uninstall, factory reset, or other consequential reset.
- Restart, reboot, and power-off.

Scout does not show an approval card for these boundaries. It stops with `BLOCKED_NEEDS_HUMAN`, names the boundary it matched, gives one concrete human action, and explains how to continue afterward. General Chat remains outside this execution model and cannot start a hidden task.

## UI Automation

Scout may perform UI operations during an active automatic task.

Capability tiers:

1. Accessibility enabled: structure-first UI automation through the Agent APK accessibility service. `ui.inspect` is the primary low-token observation channel; screenshots remain evidence artifacts and are not expanded into the Agent prompt unless explicitly attached/read.
2. Accessibility not enabled: restricted coordinate-level operation through screenshot plus ADB input.

Accessibility rules:

- ADB Manager should show Scout control capability state: enabled, disabled, restricted, or unknown.
- Provide a button such as `开启 Scout 控制能力`.
- If disabled, clicking the button should open the Android accessibility settings page or an Agent APK guidance page as directly as the platform allows.
- The user must manually grant accessibility. Do not claim the app can auto-approve accessibility.
- Android restricted-settings cases must be explained and handled as user action.
- For taps, Scout resolves the latest hierarchy before execution. The semantic target label is authoritative; coordinates are optional hints. Coordinates select the smallest enabled clickable node, a visible label may resolve to its clickable parent or its own visible center, and a unique exact target may be re-centered after layout movement. Repeated labels remain coordinate-disambiguated.
- The Agent APK attempts an accessibility node click first and falls back to an accessibility gesture only when the vendor node rejects `ACTION_CLICK`; loss of the accessibility service still falls back to the restricted ADB coordinate path.

Restricted coordinate operation rules:

- Only available during an active automatic task.
- Must use a fresh screenshot before each coordinate operation.
- Scout must state the intended target before acting, such as "try tapping near the Save button".
- High-risk pages cannot use coordinate fallback.
- Stop after one or two failed attempts; do not loop.
- Log tap/input/keyevent/swipe with coordinates/text/time into the timeline.
- Report must mark coordinate operations as lower-confidence UI automation.

## Protected Actions

These actions are not executed by an automatic Scout run:

- Clear app data, such as `pm clear`.
- Uninstall apps.
- Reboot device.
- Factory reset, wipe, fastboot flash, or firmware operations.
- Delete files or directories through broad `rm`, `dd`, `mkfs`, or similar.
- Modify critical system settings: security, account, lock screen, device admin, accessibility authorization.
- Host identity reset that removes `adbkey`.
- Batch install or overwrite multiple packages.
- Downgrade install or signature-conflict handling.
- Enter sensitive text: password, token, account, verification code.
- Click high-risk system confirmation screens: account removal, factory reset, payment, sensitive permission grants.

Scout does not show an approval card for these boundaries. It records a structured `BLOCKED_NEEDS_HUMAN` outcome with the matched boundary, one concrete human action, and the restart/continue instruction.

## Evidence Model

Evidence is not a standalone user feature. It exists only inside a running Scout task.

Rules:

- Only one Scout task may run at a time.
- A running Scout task binds to the start device identity, preferring `device_sn`, falling back to ADB serial.
- Wireless serial/port changes may continue the task only when the same device SN can be matched.
- If selected device differs from the running task device, task collection should block and ask the user to return to the task device.
- Manual tool results are automatically added only while a Scout task is running.
- Tool results outside a running task stay local to that tool and do not create global evidence.

Evidence timeline is the fact base:

- Screenshots.
- UI snapshots.
- Screen state and foreground/package context.
- Logcat snapshots when a failure or repro symptom makes them relevant.
- Remote or accessibility actions.
- ADB/Workbench actions.
- Scout notes and report findings.
- Optional performance context when explicitly requested or escalated by an observed symptom.
- Scout notes.

Scout may summarize actions and state changes, but must distinguish:

- Recorded actions.
- Observed state changes.
- User notes.
- Scout inference.

## Collection Strategy

Use event-triggered collection plus low-frequency polling.

Feature walkthrough:

- Event-triggered collection is primary.
- Lightweight screen state every 15-30 seconds.
- No default recording.

Bug reproduction:

- More active automatic collection.
- Screenshot/Logcat around Agent-observed failures, UI actions, and foreground changes. Add performance only when requested or when the observed symptom is slowness, jank, freeze, ANR, crash, or resource-related failure.
- Lightweight screen state every 10-15 seconds.
- The task UI does not expose manual recording, issue-marker, screenshot, or note controls; the Agent gathers the evidence needed for its report.

Device manual operation and remote operation are equally important paths:

- Remote/control path can record actions more completely.
- Physical-device path records verifiable evidence such as screenshots, foreground state, Logcat, performance, Agent observations, and screen-state changes.
- Do not pretend to capture every physical touch.

Task start should show a capability summary:

- Current operation mode: remote/control observed, physical-device observed, or automatic.
- Will record: screenshots, UI snapshots, screen state, foreground/package context, relevant Logcat, actions, and notes. Performance is escalated evidence, not a default task baseline.
- If control channel is available: also record click/input/back/home/swipe actions.
- Gap: physical touches may not be individually captured.

## Report Model

Every Scout task must end with:

- Copyable summary.
- Exportable report and evidence package.

Unified report structure:

1. Engineering summary.
2. Task goal and environment.
3. Timeline.
4. Suspicions and evidence gaps.
5. Raw evidence list.

Feature walkthrough report:

- No formal pass/fail.
- Output covered areas, observed issues, evidence gaps, and suggested next steps.

Bug reproduction report:

- Uses the same structure.
- Summary may state whether the target symptom was observed, not observed, or evidence is insufficient.

Report must disclose:

- Whether Agent APK was used.
- Whether accessibility was enabled.
- Whether coordinate-level UI fallback was used.
- Whether Agent runtime completed successfully.
- Missing/moved local artifact files during export.

If report generation fails, the task stays active with failed run state and a retry next action. The user can fix runtime/configuration or collect more evidence, then run Stop and generate report again.

## First Implementation Direction

The product should be refactored globally around Agent Tasks, not by adding more controls to a floating drawer.

Recommended phase order:

### Phase 1: Vocabulary and Navigation Skeleton

- Rename user-facing Copilot to Scout.
- Remove Agent Lab as a primary navigation concept.
- Add `Agent 任务` entry/module to the current-device workbench.
- Keep Agent CLI/APK/Provider names in settings and technical panels.
- Group existing tools into a clearer tool-library structure without removing capabilities.

Acceptance criteria:

- Users see Scout as the assistant/task brand.
- Users do not see `Agent 实验室` as a primary destination.
- Agent configuration still uses Agent terminology.

### Phase 2: Scout Task State Model

- Introduce a single running Scout task model.
- Bind task to `device_sn || serial`.
- Add start gates for device, runtime, save directory, and goal; keep Agent APK/accessibility as a visible capability status rather than a per-task approval gate.
- Remove standalone evidence-session wording from user-facing UI.
- Current implementation status: `src/scoutTask/` owns start gates, device binding, artifact append checks, report close/failure transitions, active task resolution, and Workbench auto-execute decisions. `AgentCopilot.tsx` calls that domain layer through local ports/adapters.

Acceptance criteria:

- Starting a Scout task is impossible without selected device, runtime, save path, and goal.
- Agent APK/accessibility gaps use deterministic ADB/UIAutomator recovery where possible and are disclosed as evidence limitations.
- Only one task can run at a time.

### Phase 3: Task Console for Bug Repro and Walkthrough

- Move Bug Repro and Walkthrough into the Agent Tasks task console.
- Implement unified timeline, automatic terminal report closure, and export package.
- Do not reintroduce a global drawer; task status stays in Agent Tasks.

Acceptance criteria:

- User can start Bug Repro from the device workbench; the Agent terminal outcome ends it automatically.
- User can start Feature Walkthrough from the device workbench; the Agent terminal outcome ends it automatically.
- The report follows the unified structure.
- Tool outputs during a running task enter the active timeline.

### Phase 4: Full Automation and Protected Boundary

- Feature Walkthrough and Bug Repro always use automatic execution; there is no semi-automatic task mode or per-task permission selector.
- Routine navigation, swipe, back, and ordinary confirm/submit/continue actions execute without approval cards.
- Block only protected boundaries: sign-in/sign-out and authorization changes; purchase/payment/subscription/order submission; clear data/storage/cache, uninstall, factory or consequential reset; restart/reboot/power-off.
- A protected block is part of the task interaction: show the matched boundary, the exact human action required, and how to resume. Do not leave the user to infer the next step from a generic error.
- General Chat remains non-autonomous and cannot create a hidden Scout task.
- Make Scout runtime health a hard start gate for Scout tasks.

Acceptance criteria:

- Starting either task mode immediately establishes automatic execution.
- Routine actions never create an operation approval card.
- Protected actions stop with `BLOCKED_NEEDS_HUMAN` and explicit one-step guidance.
- The terminal Agent response becomes the report and closes the record automatically.
- Active task records expose Stop task and Export; historical records expose Export.
- Protected actions never create an approval card in automatic task mode.

### Phase 5: UI Automation Capability

- Add Agent APK accessibility status detection.
- Add "open Scout control capability" action to open relevant accessibility/settings path.
- Add UI operation timeline event types.
- Implement accessibility-backed operation first where available.
- Implement restricted coordinate fallback with guardrails.

Acceptance criteria:

- Auto-execute task detects accessibility state.
- Disabled accessibility shows a clear setup path.
- Coordinate fallback is marked lower confidence and logged.

### Phase 6: Reports and Evidence Package Hardening

- Normalize report generation across first-batch tasks.
- Export `report.md` plus available artifacts under `assets/`.
- Add report disclosures for Agent APK, accessibility, coordinate fallback, runtime failures, and skipped files.

Acceptance criteria:

- Every completed Scout task has copy summary and export package.
- Missing local artifacts are disclosed, not silently hidden.

## First Stories

### Story 1: Scout Vocabulary and Entry Skeleton

As an Android engineer, I want the intelligent assistant to appear as Scout and the task module as Agent tasks, so that I understand the difference between user-facing automation and technical runtime configuration.

Acceptance criteria:

- `Copilot` user-facing task/title text becomes `Scout`.
- `Agent 实验室` is removed from primary navigation text.
- Technical settings still use Agent CLI, Agent APK, and Agent Provider.
- Existing Agent contract tests are updated to reflect the terminology boundary.

INVEST check:

- Independent: can ship before full task automation.
- Negotiable: exact visual placement can evolve.
- Valuable: removes current naming confusion.
- Estimable: bounded copy/navigation refactor.
- Small: no backend runtime change required.
- Testable: locale and component contract tests can assert terms.

### Story 2: Single Running Scout Task Contract

As an Android QA user, I want Scout tasks to bind to one selected device and one running task at a time, so that evidence never mixes across devices or tasks.

Acceptance criteria:

- Starting a Scout task requires selected online target.
- Running task stores device identity by `device_sn || serial`.
- Starting a second task is blocked until current task ends.
- Switching selected device does not silently attach evidence to the wrong task.

INVEST check:

- Independent: can be implemented before final UI polish.
- Negotiable: exact warning copy can evolve.
- Valuable: protects report trustworthiness.
- Estimable: state model and UI guard change.
- Small: first version can cover walkthrough/repro only.
- Testable: state and contract tests can cover single-task behavior.

### Story 3: Bug Repro Task Console

As an Android QA user, I want to start a Scout Bug Repro task from the current device workbench, operate the device, and end with a report and evidence package, so that I can give engineering a reproducible issue record.

Acceptance criteria:

- Start gate checks device, runtime, save path, goal, and Agent APK state.
- The task console shows timeline, note, screenshot, mark issue, recording, and end/report controls.
- Manual tool results during task run append to the active timeline.
- Ending the task generates unified report structure and export package.

INVEST check:

- Independent: first complete vertical slice.
- Negotiable: exact layout can evolve.
- Valuable: highest-impact wow moment.
- Estimable: clear state, UI, report, export scope.
- Small: starts with Bug Repro before all task types.
- Testable: contract tests plus Tauri smoke and export tests.

## Non-Goals For First Global Refactor

- Do not build a full checklist/test-management system.
- Do not support multiple simultaneous Scout tasks.
- Do not make Agent/Scout tasks run without a real Agent runtime.
- Do not promise full physical-touch capture.
- Do not auto-enable Android accessibility permissions.
- Do not allow auto-execute to bypass dangerous action approvals.
- Do not remove existing professional tools while reorganizing the shell.
