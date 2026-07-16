---
name: feature-walkthrough-review
description: Guides Scout through evidence-based Android feature walkthroughs and structured QA reporting. Use when reviewing a feature, interaction path, UI reference, prototype, PRD, screenshot, or test plan on a selected device.
---

# Feature Walkthrough Review

## Purpose

Turn an automatic feature walkthrough into traceable answers to three user-facing questions: can the feature be used to completion, what differs in the visible UI from the reference or expected design, and what differs in the observed behavior/state/result from the expected implementation. This is a Scout task-level playbook; `docs/agent-skills/*` remain optional evidence subroutines for targeted device, input, display, performance, package, network, crash, storage, and wireless risks.

## Start

- Treat a non-empty user goal as the authoritative target feature and entry scope. Do not ask the user to restate a concrete goal; infer missing expected states from the goal and visible labels, record the assumption, and continue. Ask a blocking question only when the goal is empty or a protected action is truly required.
- Confirm the selected device, important states, and expected outcome when the goal provides them.
- Identify readable references: screenshot, prototype, PRD, Figma/Feishu content, or test plan.
- If a reference cannot be accessed, record that limitation as an evidence gap. Never imply it was inspected. Missing reference material is not a reason to stop device-side coverage.
- Ask at most one blocking question. Otherwise state assumptions and begin collecting evidence.

### Evidence priority

1. Functional availability: entry, controls, enabled/disabled states, state transitions, data/result changes, recovery, and the end condition. The first device action is always `ui.inspect`; continue with safe navigation even when the first screen does not expose a text label for the requested feature.
2. UI difference: compare screenshots and the accessible UI hierarchy at meaningful checkpoints for structure, visibility, copy, state, layout, and interaction affordance.
3. Behavior/implementation difference: compare the externally observed interaction, state, and result with the PRD, test plan, reference, or stated expectation. Do not claim an internal code or architecture difference without source evidence.

The default evidence set is UI inspection before and after meaningful actions, key-state screenshots, target-package context when needed, and foreground/window context when it explains the verified surface. Do not collect device summaries or CPU, memory, thermal, battery, network, or other performance baselines by default. Escalate to `performance.sample`, Logcat, or another diagnostic only after an explicit request or an observed symptom such as slowness, jank, freeze, ANR, crash, or resource-related failure; state why the diagnostic is relevant.

## Coverage Matrix

Maintain these fields throughout the task:

| Area / Path / State | Expected | Observed | Evidence | Issue Category | Severity | Gap / Next Action |
| --- | --- | --- | --- | --- | --- | --- |

Keep verified facts, user-reported actions, and Scout inference distinguishable. Compare expected vs observed only where an expectation is available or explicitly assumed.

## Issue Review

Classify observed issues as functional, UX, visual/layout, copy/i18n, state/data, permission, reliability, performance, or evidence gap. Performance is a secondary diagnostic category, not a default walkthrough axis.

Use severity only for observed issues:

- Blocker: prevents the core task or leaves no practical recovery path.
- Major: materially breaks an important path or creates a high user-impact failure.
- Minor: limited defect with a workaround or low impact.
- Observation: notable behavior that is not yet established as a defect.

Bind each issue to an automatically captured screenshot, screen state, Logcat snapshot, Agent note, or an explicitly labeled Scout inference. Invoke an Android Agent Skill only when it supplies evidence needed for the current risk.

## Final Report

Keep separate sections for functional coverage, UI differences, behavior/implementation differences, evidence gaps, and any diagnostics that were escalated. Include the coverage matrix, observed issues with severity and evidence, and recommended next actions. Do not merge a missing reference with a functional failure. A walkthrough does not produce a formal pass/fail verdict by default.

## Fully Automatic Completion Contract

- Continue the observe → act → verify loop until accessible coverage is complete or a real blocker prevents further progress.
- Treat an explicit zero-node UI snapshot, including a screensaver, as a recoverable starting surface rather than a completed walkthrough. Scout first starts the selected target package; if none was selected, it may start a uniquely goal-matched launchable app (for example, Calendar/日历), then records a fresh UI inspection before functional coverage continues. If no unique target can be resolved, record that evidence gap and continue with available package evidence rather than claiming the task was completed.
- If the hierarchy is still empty after app launch/recovery, use `workbench.request_adb_command` only as a safe input fallback for `shell input keyevent`, `shell input tap`, or `shell input swipe`; verify the result with a fresh screenshot or foreground check. If accessibility returns a non-empty but semantically incomplete tree, such as repeated unlabeled clickable containers with their text children missing, Scout falls back to the file-backed ADB hierarchy before resolving the next target. Zero nodes are not a completion condition.
- If the Agent repeats `ui.inspect` without requesting an action, Scout may choose one bounded, reversible overlay or goal-matched target. Candidates must be enabled and either genuinely clickable or resolvable from a visible label/content description; non-clickable resource-ID-only nodes are not action targets. Goal matching prefers complete token matches over substring matches, so `Day` is preferred over an unrelated `Today` label. When the goal describes a selector, switch, toggle, setting, or mode, resource IDs that look like controls are preferred and directional IDs such as `*_left`, `*_right`, `*_prev`, or `*_next` are penalized, so `btn_mode` is preferred over a month navigation arrow. It excludes generic package-name matches, protected targets, and targets already attempted without observable UI change. If no safe progress remains, close as `FAILED` with the unchanged-page evidence instead of looping.
- A response without tool calls is terminal. Never end a turn by saying that results are still pending when no tool request remains.
- End with exactly one outcome: `COMPLETED`, `BLOCKED_NEEDS_HUMAN`, or `FAILED`.
- Scout validates that outcome, retries terminal synthesis at most twice, and otherwise closes from evidence: a deterministic `COMPLETED` closeout is allowed only when a UI action succeeded, the post-action snapshot is non-empty and changed, and a goal-related visible node was observed; otherwise it records a deterministic `FAILED` summary of the latest tool results.
- Ordinary navigation, swipes, Back, Submit, Confirm, and Continue are reversible flow actions and should run directly.
- Protected actions are limited to destructive/data-loss, payment/purchase, account sign-in/sign-out, authorization/permission, reset/restart, and equivalent boundaries. They do not create approval cards.
- Continue other safe coverage before using `BLOCKED_NEEDS_HUMAN`. The report must identify the protected step, the one action the user must complete, and that the task can be restarted afterward.
- Every terminal outcome is written as the final report and closes the evidence record automatically. The task UI exposes Export as its only manual evidence action.

## Boundaries

- Do not claim physical touches, invisible states, reference contents, or tool results that were not observed.
- Missing evidence is a gap, not a failure.
- Do not run every diagnostic skill automatically.
- General Chat is not a fully automatic Scout task and must not inherit the autonomous task loop.
