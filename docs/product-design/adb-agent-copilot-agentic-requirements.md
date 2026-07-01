# ADB Agent Copilot Agentic Requirements

Date: 2026-06-30

Audience: ADB Manager product, engineering, QA, and support users.

## 1. Background

The current Android Device Copilot has improved over the earlier fixed command catalog, but it still behaves more like a deterministic diagnostic workflow than a real Copilot.

The observed problem is:

- The user sends a prompt.
- The app auto-matches one embedded skill.
- The app immediately runs that skill's fixed evidence steps.
- The Agent CLI, when available, is called only after evidence collection to summarize the collected stdout/stderr.
- The user does not experience a normal multi-turn AI conversation where the agent decides whether it needs evidence, asks follow-up questions, chooses tools, or changes plan based on intermediate results.

This is not the desired product direction.

The target direction is:

> ADB Manager provides device data and safe device actions. The AI Agent owns the conversation, reasoning, planning, and tool choice.

In other words, ADB, the optional device-side APK Agent, screenshot, Logcat, performance sampling, package inspection, and Evidence Session are tools. They should not dictate the workflow. The Copilot should decide when and how to use them.

## 2. Current-State Gap

The current behavior creates several product gaps:

1. **Not conversational enough**
   - A prompt triggers collection, not a real dialogue.
   - The user cannot naturally ask "what do you need next?" or "first look at the current screen" and let the agent decide.

2. **Workflow is too rigid**
   - Embedded skills are useful as recipes, but they currently dominate execution.
   - Every diagnosis tends to begin with pre-declared evidence steps, even when the user wants reasoning, clarification, or a narrower check.

3. **Agent is analysis-after-the-fact**
   - Agent CLI output is used as final analysis after data is already collected.
   - The agent does not orchestrate tool calls during the conversation.

4. **APK and ADB roles are blurred**
   - The optional APK Agent should be a telemetry/data provider.
   - ADB should be the host-side command and evidence bridge.
   - Neither should be treated as the "brain" of Copilot.

5. **Permission UX is under-specified**
   - A true agent may request tools dynamically.
   - The product must avoid both extremes: frequent permission interruptions and unsafe full-access execution.

## 3. Product Goal

Build ADB Agent Copilot as a normal AI Copilot:

- The user can chat naturally.
- The AI agent can decide whether to answer directly, ask a follow-up question, inspect device state, capture screen evidence, read logs, sample performance, start/attach an Evidence Session, or propose a risky action for approval.
- ADB Manager exposes a typed, permission-aware tool layer to the agent.
- All tool usage remains visible, auditable, and tied to the selected device.

## 4. Non-Goals

The first agentic version should not:

- Let the external agent run arbitrary host commands by default.
- Default to full-access or `--yolo` mode.
- Force every prompt through a fixed embedded skill.
- Treat uploaded checklist or test-plan attachments as a separate test-management mode with item status tracking.
- Pretend physical touch input is precise unless the operation came through Remote/PWA audit events.
- Replace existing deterministic diagnostic skills entirely; they remain reusable optional evidence shortcuts.

## 5. Desired Interaction Model

### 5.1 Entry Points

1. **Main console universal Copilot**
   - Used for open-ended cross-feature tasks.
   - Examples:
     - "Help me start a bug reproduction session."
     - "Why did the device get slow after opening Launcher?"
     - "Summarize today's walkthrough evidence."

2. **Contextual Copilot drawer**
   - Default UI is a bottom-right Copilot icon.
   - Clicking the icon opens a right-side conversation drawer.
   - The drawer receives current tab context but does not force a tab-specific workflow.
   - Examples:
     - Screenshot tab: "Analyze the current screen."
     - Logcat tab: "Look for recent crash evidence."
     - Remote tab: "Start recording my operations."
     - Performance tab: "Explain the last minute of metrics."

### 5.2 Conversation Flow

The Copilot should support this flow:

1. User sends a message.
2. Agent receives:
   - User prompt.
   - Selected device identity.
   - Current tab context.
   - Current Evidence Session state, if any.
   - Available tools and permission policy.
3. Agent decides one of:
   - Answer directly.
   - Ask a follow-up question.
   - Request one or more safe read-only tool calls.
   - Request session-scoped collection, such as screenshot plus Logcat snapshot.
   - Request user approval for medium/high-risk action.
   - Start or update an Evidence Session.
4. ADB Manager executes approved tool calls.
5. Tool results are returned to the agent.
6. Agent continues the conversation with a user-facing response and next suggested actions.

The key requirement: evidence collection is agent-directed, not hardcoded as the first step for every prompt.

## 6. Agent And Tool Architecture

### 6.1 Roles

| Layer | Responsibility |
| --- | --- |
| AI Agent | Conversation, reasoning, planning, deciding what tools to call, synthesizing results. |
| ADB Manager | Device selection, permission policy, tool execution, artifact storage, UI, audit trail. |
| ADB | Host-to-device bridge for commands and evidence collection. |
| Device-side APK Agent | Optional telemetry provider for app/process/network data when installed and permitted. |
| Embedded skills | Reusable optional evidence shortcuts the agent may invoke or adapt, not mandatory workflows. |
| Evidence Session | Durable store for walkthrough, bug repro, and report artifacts. |

### 6.2 Tool Contract

Expose tools to the agent as typed capabilities rather than raw shell access.

Initial tool families:

- `device.get_summary`
- `device.get_foreground_app`
- `screen.capture`
- `screen.get_latest_screenshot`
- `logcat.snapshot`
- `performance.sample`
- `performance.get_recent_window`
- `package.list`
- `package.get_info`
- `remote.get_recent_actions`
- `evidence.start_session`
- `evidence.add_note`
- `evidence.add_artifact`
- `evidence.mark_issue`
- `evidence.export_report`
- `workbench.run_adb_command` for explicitly approved expert commands only

Each tool response should include:

- `success`
- `deviceSerial`
- `deviceKey`
- `startedAt`
- `endedAt`
- `summary`
- `artifactIds`
- `raw` or bounded raw output when safe
- `evidenceGap` when data is missing or permission-limited

### 6.3 Agent Runtime

Preferred runtime behavior:

- Keep a multi-turn conversation session.
- Preserve prior messages and tool results in the Copilot session.
- Let the agent call tools iteratively.
- Stream or incrementally show progress where possible.
- Fall back to deterministic built-in analysis only when the configured agent runtime is unavailable.

The current "collect fixed evidence, then call CLI once" flow should be treated as a fallback, not the primary Copilot design.

## 7. Permission And Autonomy Model

Do not default to full-access or `--yolo`.

Use three permission tiers:

### Tier 1: Auto-Allowed Read-Only Tools

Examples:

- Device summary.
- Foreground app.
- Screenshot capture.
- Logcat snapshot.
- Package list.
- Performance sample.
- Recent Remote action audit.

These should not interrupt the user repeatedly during a Copilot conversation.

### Tier 2: Session-Scoped Approval

Examples:

- Start bug reproduction evidence collection.
- Start/stop recording.
- Continuously attach screenshots/log snapshots to a walkthrough.
- Export reports to the configured evidence directory.

The user approves the session's collection policy once. The Copilot can continue within that policy without repeated prompts.

### Tier 3: Per-Action High-Risk Approval

Examples:

- Clear app data.
- Uninstall packages.
- Reboot.
- Delete device files.
- Reset ADB host identity.
- Run custom shell commands.

These require a visible approval card with:

- Target device.
- Exact action or command.
- Risk level.
- Expected impact.
- Buttons: Allow once, deny, copy command, view reason.

High-risk approvals must not be bypassed by a global "agent mode" toggle.

## 8. UX Requirements

### 8.1 Bottom-Right Copilot Icon

- Copilot is collapsed by default as a bottom-right icon.
- The icon may show state:
  - Idle.
  - Agent thinking.
  - Tool running.
  - Evidence session active.
  - Permission needed.
  - Error.
- Clicking opens a right-side drawer.

### 8.2 Right-Side Drawer

The drawer should include:

- Current device and current tab context.
- Conversation thread.
- Tool call cards.
- Permission cards.
- Evidence session status.
- Context-aware prompt suggestions.
- Input composer.

The drawer should not force the current tab to run a preset workflow. Suggestions can inform Agent context, but the UI should not expose a confusing manual "run template" action.

### 8.3 Main Console

The main console can keep a universal Copilot chat.

It should support:

- Starting evidence workflows.
- Finding past sessions.
- Summarizing reports.
- Cross-feature questions.
- Agent settings and status checks.

## 9. Evidence Session Integration

Evidence Session remains important, but it should be agent- or user-triggered.

Supported session types for the current roadmap:

1. Walkthrough recording.
2. Bug reproduction package.

Checklist and test-plan material should be uploaded as conversation attachments. The Agent can read the attachment preview, ask clarifying questions, and guide the walkthrough, but ADB Manager should not add a separate checklist session type, pass/fail item store, or checklist-specific export flow.

Performance evidence and future comparison evidence can be added as artifacts, but they are not a separate Phase 5 in the current roadmap.

## 10. Revised Roadmap

### Phase 1: Agentic Copilot Shell

Deliver:

- Bottom-right Copilot icon.
- Right-side drawer.
- Main console universal chat.
- Multi-turn agent session model.
- Tool registry and typed tool contract.
- Agent runtime invocation for conversation, not only post-evidence analysis.
- Permission cards and autonomy tiers.
- Context adapters for current tab and selected device.

Acceptance:

- A user can ask a question and receive a normal conversational response without mandatory evidence collection.
- The agent can decide to call a read-only tool, receive the result, and continue the same conversation.
- The UI shows tool call progress and results.
- If a high-risk action is requested, the UI shows an approval card instead of executing it.

### Phase 2: Evidence Session MVP

Deliver:

- Agent- or user-triggered walkthrough session.
- Remote/PWA action timeline as high-confidence evidence.
- Screenshot artifacts.
- User notes and issue markers.
- Markdown report export.

Acceptance:

- The agent can start a walkthrough only after user approval.
- Remote actions are recorded when available.
- The agent can answer questions about the active session using collected artifacts.

### Phase 3: Bug Reproduction Package

Deliver:

- Agent-guided bug repro mode.
- Recording capture.
- Mark issue moment.
- Logcat snapshot around the issue marker.
- Issue draft export.

Acceptance:

- The user can say "start a bug repro" and the agent asks for or confirms a capture plan.
- The agent can collect approved evidence during the session.
- The exported issue includes steps, evidence links, target device, and evidence gaps.

## 11. Agile Story Slices

### Story 1: Multi-Turn Agent Conversation

As a QA or product reviewer, I want to chat with ADB Agent Copilot without automatically triggering a fixed evidence workflow, so that I can ask questions, clarify intent, and let the agent decide what information is needed.

Acceptance criteria:

- Given an online selected device, when the user sends a prompt, then the prompt is sent to the configured agent runtime as part of a multi-turn conversation.
- Given a generic prompt, when no evidence is required, then the agent can answer without running ADB commands.
- Given a follow-up prompt, when prior messages exist, then the agent receives relevant conversation context.
- Given the agent runtime is unavailable, then the UI shows fallback state and does not pretend a real agent answered.

INVEST check:

- Independent: yes.
- Negotiable: yes, implementation can vary by agent runtime.
- Valuable: yes, fixes the core non-conversational behavior.
- Estimable: yes.
- Small: yes if scoped to no tool calls.
- Testable: yes.

Readiness: Ready.

### Story 2: Typed Tool Calls From Agent

As an AI Copilot user, I want the agent to request device tools only when needed, so that ADB/APK data supports the conversation instead of forcing a fixed workflow.

Acceptance criteria:

- Given the agent requests a read-only tool, when the tool is auto-allowed, then ADB Manager executes the typed tool and returns structured results to the same conversation.
- Given a tool fails, then the result includes an evidence gap or error summary.
- Given the agent requests an unknown or unsupported tool, then the UI reports that the capability is unavailable.
- Given a tool returns raw output, then the prompt-bound payload is bounded and large artifacts are stored by reference.

INVEST check:

- Independent: mostly, depends on Story 1 session plumbing.
- Negotiable: yes.
- Valuable: yes.
- Estimable: yes if initial tool list is bounded.
- Small: yes for read-only tools only.
- Testable: yes with fake tool responses and one real ADB read-only call.

Readiness: Ready with dependency on Story 1.

### Story 3: Permission-Aware Agent Actions

As a device operator, I want Copilot to request approval before risky actions, so that agent autonomy does not accidentally modify the wrong app, device, or host state.

Acceptance criteria:

- Read-only tools run without repeated confirmation.
- Session-scoped capture requests show one collection policy confirmation.
- High-risk actions always show a per-action approval card.
- Denied actions are returned to the agent as denied tool results.
- The agent cannot bypass approval by using raw shell access.

INVEST check:

- Independent: yes for approval UI and policy engine, though tool execution integration follows.
- Negotiable: yes.
- Valuable: yes, protects devices and user trust.
- Estimable: yes.
- Small: yes if limited to policy tiers and one approval card.
- Testable: yes.

Readiness: Ready.

### Story 4: Agent-Guided Evidence Session Start

As a QA user, I want the agent to propose and start an evidence session only after confirming the capture plan, so that evidence collection feels intentional rather than automatic.

Acceptance criteria:

- The agent can propose a walkthrough or bug repro session.
- The UI shows what will be captured before starting.
- The user can approve, edit, or cancel the capture plan.
- Approved sessions record device identity and capture policy.

INVEST check:

- Independent: yes after Stories 1-3.
- Negotiable: yes.
- Valuable: yes.
- Estimable: yes.
- Small: yes if limited to starting sessions.
- Testable: yes.

Readiness: Ready with dependency on Stories 1-3.

### Story 5: Embedded Skills As Optional Evidence Shortcuts

As an advanced user, I want existing diagnostic skills to remain available as optional evidence shortcuts, so that common investigations stay fast without forcing every conversation into a fixed path.

Acceptance criteria:

- Prompt or attachment context can surface an evidence shortcut hint to the Agent, but the UI does not show a default shortcut permanently, does not show a manual run-template card, and does not auto-run it.
- The agent may use the evidence shortcut hint to decide which typed tools to request or what to ask next.
- The user can continue normal conversation after an evidence shortcut step.
- Evidence shortcut hints are not stored as the whole conversation and are not presented as a separate manual workflow.

INVEST check:

- Independent: yes.
- Negotiable: yes.
- Valuable: yes, preserves existing investment while fixing rigidity.
- Estimable: yes.
- Small: yes if only reclassifying current skills as tools.
- Testable: yes.

Readiness: Ready.

## 12. Validation Plan

Use these product-level validation scenarios before implementation is considered done:

1. **No forced evidence scenario**
   - User asks: "What can you help me check on this screen?"
   - Expected: agent answers or asks a follow-up without mandatory ADB collection.

2. **Agent-chosen evidence scenario**
   - User asks: "Why might this screen be blank?"
   - Expected: agent asks for or invokes screen capture/display/window/log tools based on its plan.

3. **Tool result loop scenario**
   - Agent requests foreground app and screenshot.
   - Tool results return.
   - Agent continues with a conclusion or next question in the same conversation.

4. **Permission scenario**
   - User asks: "Clear this app and retry."
   - Expected: high-risk approval card appears before any command executes.

5. **Evidence session scenario**
   - User asks: "Start recording my operation walkthrough."
   - Expected: agent proposes a capture plan and waits for approval.

6. **Agent runtime unavailable scenario**
   - Agent CLI is missing or exits with no output.
   - Expected: UI clearly says the agent runtime is unavailable and uses fallback only if appropriate.

## 13. Open Questions

1. Which agent runtime should be the default for true multi-turn conversations: Codex CLI, Claude Code, custom CLI, or an app-managed LLM API?
2. Does the agent runtime support tool-call protocol natively, or does ADB Manager need to implement a text/JSON tool-call loop?
3. Should agent conversations persist full prompts/tool outputs, or should large raw evidence always be stored by artifact reference only?
4. Should `--yolo` remain available as an expert profile option, or be excluded entirely from built-in profiles?
5. Which embedded skill contexts should be passed as hidden Agent hints, and when should the UI stay purely conversational?
