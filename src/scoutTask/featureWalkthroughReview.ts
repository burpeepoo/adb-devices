import type { EvidenceSessionKind } from "../types";

export const FEATURE_WALKTHROUGH_REVIEW_PLAYBOOK_PATH =
  "docs/scout-skills/feature-walkthrough-review.md";

export function featureWalkthroughReviewPromptRules(kind: EvidenceSessionKind): string[] {
  if (kind !== "walkthrough") return [];

  return [
    "",
    `Feature walkthrough review playbook: ${FEATURE_WALKTHROUGH_REVIEW_PLAYBOOK_PATH}`,
    "- Treat a non-empty user Goal as the authoritative target feature and entry scope. Do not ask the user to restate a concrete goal; infer missing expected states from the goal and visible labels, record the assumption, and continue. Ask a blocking question only when the goal is empty or a protected action is truly required.",
    "- Start device coverage with ui.inspect and the first key-state screenshot. The first tool call must be ui.inspect; a missing reference or an incomplete expected-result description is not a reason to stop. External reference reads are supplemental and must not delay the first page operation; continue with device evidence when a reference is slow, unavailable, or still loading.",
    "- Treat inaccessible or unreadable design/PRD/test-plan references as evidence gaps. State the reference access limitation and never imply that the reference was inspected.",
    "- Prioritize three questions in this order: can the user complete the feature path, what differs in the visible UI from the reference or expected design, and what differs in the observed behavior/state/result from the expected implementation.",
    "- For functional coverage, verify entry, enabled/disabled controls, state transitions, data/result changes, recovery, and the end condition. For UI coverage, compare screenshots and UI hierarchy at meaningful checkpoints rather than judging from device metrics.",
    "- Treat an implementation difference as an externally observed behavior, state, interaction, or result mismatch. Do not claim an internal code or architecture difference unless source evidence was actually inspected and cited.",
    "- Default evidence is UI inspection before and after meaningful actions, a screenshot at important states, the target package only when needed, and foreground/window context when it explains which surface is being verified.",
    "- Do not collect device summaries or CPU, memory, thermal, battery, network, or other performance baselines by default. Use performance.sample, Logcat, or other diagnostics only when the user asks for them or an observed symptom such as slowness, jank, freeze, ANR, crash, or resource-related failure makes the evidence necessary; record why the diagnostic was escalated.",
    "- Maintain a coverage matrix with: area/path/state, expected, observed, evidence, issue category, severity, and gap/next action.",
    "- Compare expected vs observed for each covered area. Keep verified facts, user-reported actions, and Scout inference distinguishable.",
    "- Classify issues when relevant as functional, UX, visual/layout, copy/i18n, state/data, permission, performance, reliability, or evidence gap. Performance is a secondary diagnostic category, not a default walkthrough axis.",
    "- Use severity only for observed issues: blocker, major, minor, or observation. Explain impact briefly; do not infer severity from missing evidence alone.",
    "- Bind every issue to an automatically captured screenshot, screen state, Logcat snapshot, Agent note, or an explicitly labeled Scout inference. Reuse Android Agent Skills only as bounded evidence subroutines when they match the observed risk.",
    "- In the final report, keep separate sections for functional coverage, UI differences, behavior/implementation differences, evidence gaps, and any diagnostics that were escalated. Do not merge a missing reference with a functional failure.",
    "- Do not produce a formal pass/fail verdict by default. Report covered scope, observed issues, evidence gaps, and recommended next actions.",
    "- This is a fully automatic Scout task. Continue the observe-act-verify loop until accessible coverage is complete or a real blocker prevents progress. A response without tool calls is terminal and must never merely say that results are still pending.",
    "- A foreground surface with an explicit zero-node UI snapshot, including a screensaver, is a recoverable precondition rather than an end state. The Agent accessibility snapshot may fall back to the ADB UI hierarchy; use the returned source/fallback metadata as evidence. If the surface is still empty, automatically start the selected target package; when no package was selected, resolve a unique launchable app from the walkthrough goal or package evidence, inspect again, then continue the walkthrough. If the hierarchy remains empty after recovery, use workbench.request_adb_command only for safe input fallback (`shell input keyevent`, `shell input tap`, or `shell input swipe`), then verify with a fresh screenshot or foreground check. Do not declare completion before recovery and its result are recorded.",
    "- End with exactly one declared outcome: COMPLETED, BLOCKED_NEEDS_HUMAN, or FAILED. Scout validates this contract, retries terminal synthesis at most twice, and otherwise falls back to a deterministic summary of the latest tool results.",
    "- Run ordinary navigation, swipes, Back, Submit, Confirm, and Continue directly. Protect only destructive/data-loss, payment/purchase, account sign-in/sign-out, authorization/permission, reset/restart, and equivalent boundaries.",
    "- Protected actions never create approval cards. Continue other safe coverage, then use BLOCKED_NEEDS_HUMAN only when the boundary prevents completion. Name the protected step, exactly one human action, and that the user can restart the task afterward.",
    "- Every terminal outcome becomes the final report and closes the evidence record automatically. Export is the only manual evidence action.",
  ];
}
