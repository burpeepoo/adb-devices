# ADR 0001: Scout Run as the single task fact source

- Status: Accepted
- Date: 2026-07-15

## Context

Scout currently presents an Evidence Session and an Agent conversation next to
each other. That makes lifecycle bugs easy to create: a conversation can say
it is complete while the task is still active, an empty UI snapshot can look
like a successful run, and a stale tap can be reported as a terminal failure.
The user-facing task is intended to be fully automatic, with only Stop and
Export as manual run controls.

## Decision

1. One `EvidenceSession` is the persisted Scout Run fact source. It owns the
   goal, device, target package, reference, project directory, observations,
   actions, recovery attempts, terminal outcome, and report.
2. The linked Agent conversation is a presentation stream for that run. It may
   show the goal and context, but it does not define a second lifecycle.
3. A run stays `running` until the report closes it. `COMPLETED`,
   `BLOCKED_NEEDS_HUMAN`, and `FAILED` are terminal outcomes, not intermediate
   Agent progress labels. A user Stop closes the run as `stopped` and preserves
   its evidence.
4. Scout resolves `ui.tap` against the latest UI snapshot. The semantic target
   is authoritative; coordinates are optional hints. A unique visible label
   can resolve to its clickable parent or its own visible center.
5. A zero-node snapshot is recoverable state, not success. Scout attempts the
   selected or uniquely inferred app, then safe wake/Back input, inspecting
   again after each attempt. It records a blocker only after recovery evidence
   shows that coverage cannot continue.
6. Automatic runs do not show approval cards. Protected operations return
   structured human-action guidance and a `BLOCKED_NEEDS_HUMAN` outcome.
7. Functional coverage, visible UI differences, and observed behavior/state
   differences are the default report axes. Device health and performance are
   escalated diagnostics only.

## Consequences

### Positive

- Completion, Stop, deletion, and Export all operate on one identifiable run.
- The Agent cannot finish merely because accessibility returned zero nodes.
- UI automation is less sensitive to stale coordinates and labeled-but-
  non-clickable wrapper nodes.
- Reports answer the user's actual QA questions instead of defaulting to device
  metrics.

### Trade-offs

- The existing storage key and linked conversation model remain for migration,
  so adapters must continue to normalize older records.
- A protected action cannot be completed autonomously; the report must explain
  the one required human action and how to restart.
- A visible label fallback is lower confidence than a true clickable node and
  must be recorded as such.

## Verification requirements

- Unit and contract tests cover run-state derivation, protected boundaries,
  target resolution, zero-node recovery, automatic controls, and report axes.
- Frontend and Rust builds/tests pass.
- The Tauri flow is smoke-tested on a selected device where available.
- The final implementation report is appended to the linked Feishu source of
  truth without replacing the existing historical report.
