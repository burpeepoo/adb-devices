import type {
  EvidenceArtifact,
  EvidenceSession,
  EvidenceSessionKind,
  ScoutTaskPermissionLevel,
  ScoutTerminalOutcome,
} from "../types";

export type ScoutTaskRunState =
  | "not_started"
  | "running"
  | "generating_report"
  | "completed"
  | "blocked"
  | "stopped"
  | "failed";

export const SCOUT_CRASH_RECOVERY_LIMIT = 5;
export const SCOUT_EMPTY_UI_RECOVERY_LIMIT = 1;

export type ScoutCrashRecoveryAction =
  | { tool: "ui.tap"; args: { x: number; y: number; target: string } }
  | { tool: "ui.press_back"; args: Record<string, never> };

export interface ScoutUiNodeLike {
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  bounds?: string;
  clickable?: boolean;
  enabled?: boolean;
}

export interface ScoutLaunchableApp {
  packageName: string;
  label: string;
  componentName: string;
}

export interface ResolvedScoutUiTapTarget {
  node: ScoutUiNodeLike;
  x: number;
  y: number;
  label: string;
  confidence: "clickable_node" | "visible_label";
}

export interface ScoutTerminalEvidenceResult {
  tool: string;
  ok: boolean;
  data?: unknown;
}

export type ScoutTaskCommand =
  | { type: "StartTask"; kind: EvidenceSessionKind; goal: string; permissionLevel: ScoutTaskPermissionLevel }
  | { type: "AddArtifact"; artifact: EvidenceArtifact }
  | { type: "RunAgentTurn"; reason: string }
  | { type: "RequestTool"; tool: string; args: Record<string, unknown> }
  | { type: "AutoExecuteTool"; command: string; risk: ScoutWorkbenchRisk }
  | { type: "RequestApproval"; command: string; risk: ScoutWorkbenchRisk; reason: string }
  | { type: "StopAndGenerateReport" }
  | { type: "CloseTask" };

export type ScoutTaskEvent =
  | { type: "ScoutTaskStarted"; taskId: string; kind: EvidenceSessionKind; deviceKey: string | null; deviceSerial: string | null; workingDirectory?: string | null }
  | { type: "ArtifactAdded"; taskId: string; artifactId: string; artifactType: EvidenceArtifact["type"] }
  | { type: "AgentRunStarted"; taskId: string; permissionLevel: ScoutTaskPermissionLevel }
  | { type: "ToolAutoExecuted"; taskId?: string; command: string; risk: ScoutWorkbenchRisk }
  | { type: "ApprovalRequested"; taskId?: string; command: string; risk: ScoutWorkbenchRisk; reason: ScoutApprovalReason }
  | { type: "FinalReportGenerated"; taskId: string; artifactId: string }
  | { type: "ScoutTaskStopped"; taskId: string; artifactId: string }
  | { type: "ScoutTaskClosed"; taskId: string }
  | { type: "ScoutTaskFailed"; taskId: string; reason: string; error?: string };

export type ScoutTaskStartGateReason =
  | "device_required"
  | "runtime_required"
  | "screenshot_dir_required"
  | "goal_required"
  | "task_already_running";

export type ScoutTaskGateResult =
  | { ok: true }
  | { ok: false; reason: Exclude<ScoutTaskStartGateReason, "task_already_running"> }
  | { ok: false; reason: "task_already_running"; runningTaskId: string };

export type ScoutWorkbenchRisk = "low" | "medium" | "high";
export type ScoutApprovalReason = "permission_level" | "high_risk" | "always_confirm";

export interface ScoutExecutionPolicy {
  permissionLevel: ScoutTaskPermissionLevel;
  command: string;
  risk: ScoutWorkbenchRisk;
}

export type ScoutToolExecutionDecision =
  | { action: "auto_execute" }
  | { action: "block"; reason: Exclude<ScoutApprovalReason, "permission_level"> }
  | { action: "request_approval"; reason: ScoutApprovalReason };

export interface ScoutTaskPorts {
  loadTasks(): Promise<EvidenceSession[]>;
  saveTasks(tasks: EvidenceSession[]): Promise<void>;
  runAgentTurn(prompt: string): Promise<string>;
  executeWorkbenchCommand(command: string, allowHighRisk: boolean): Promise<unknown>;
  captureScreenshot(): Promise<string>;
  exportEvidencePackage(session: EvidenceSession, reportMarkdown: string): Promise<unknown>;
}

export interface ScoutTaskStartGateInput {
  deviceSerial: string | null | undefined;
  cliConfigured: boolean;
  screenshotDir: string | null | undefined;
  goal: string | null | undefined;
  runningTask?: EvidenceSession | null | undefined;
}

export interface StartScoutTaskInput {
  id: string;
  kind: EvidenceSessionKind;
  now: number;
  goal: string;
  targetPackage?: string | null | undefined;
  uiReferenceUrl?: string | null | undefined;
  deviceKey: string | null | undefined;
  deviceSerial: string | null | undefined;
  workingDirectory?: string | null | undefined;
  permissionLevel: ScoutTaskPermissionLevel;
}

export interface ScoutTaskDeviceContext {
  deviceKey: string | null | undefined;
  deviceSerial: string | null | undefined;
}

export interface ScoutTaskResult {
  session: EvidenceSession;
  events: ScoutTaskEvent[];
}

export function isBlockingSystemUiSnapshot(value: unknown): boolean {
  return scoutUiNodes(value).some((node) => {
    if (!isAndroidSystemUiNode(node)) return false;
    const label = scoutUiNodeLabel(node);
    return /(?:isn't|is not|not) responding|keeps stopping|has stopped|无响应|未响应|停止运行|屡次停止/i.test(label);
  });
}

/**
 * An explicit empty UI snapshot is recoverable in an automatic walkthrough.
 * It is deliberately distinct from a malformed or unavailable snapshot, which
 * requires the caller to preserve the original failure rather than guessing.
 */
export function shouldRecoverScoutEmptyUiSurface(value: unknown): boolean {
  const nodes = scoutUiSnapshotNodes(value);
  return Boolean(nodes && nodes.length === 0);
}

/**
 * Resolves a launchable app without ever replacing an explicit package choice
 * with a guessed one. When no package was selected, a unique goal match (such
 * as Calendar / 日历) is enough to recover from an inaccessible foreground UI.
 */
export function resolveScoutWalkthroughLaunchApp(input: {
  targetPackage?: string | null | undefined;
  goal?: string | null | undefined;
  apps: ScoutLaunchableApp[];
}): ScoutLaunchableApp | null {
  const apps = input.apps.filter((app) =>
    Boolean(app?.packageName?.trim() && app?.componentName?.trim()),
  );
  const selectedPackage = input.targetPackage?.trim().toLowerCase();
  if (selectedPackage) {
    return apps.find((app) => app.packageName.trim().toLowerCase() === selectedPackage) ?? null;
  }

  const keywords = scoutWalkthroughGoalKeywords(input.goal);
  if (keywords.length === 0) return null;
  const candidates = apps
    .map((app) => ({ app, score: scoreScoutWalkthroughApp(app, keywords) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  return candidates[0].app;
}

export function isScoutTerminalOutcomeResponse(value: string): boolean {
  const hasTerminalOutcome = /(?:^|\n)\s*(?:Walkthrough|Bug repro|Scout task) outcome:\s*(?:COMPLETED|BLOCKED_NEEDS_HUMAN|FAILED)\s*$/i.test(
    value,
  );
  const stillWaitingForResults = /waiting\s+(?:for\s+)?(?:the\s+)?(?:tool\s+)?results?|awaiting\s+(?:the\s+)?(?:tool\s+)?results?|等待(?:工具)?结果|等待[^\n]{0,24}(?:返回|完成)|结果返回后|待结果/i.test(
    value,
  );
  return hasTerminalOutcome && !stillWaitingForResults;
}

/**
 * Allows an autonomous walkthrough to close successfully when the model misses
 * the final prose contract but the host has already verified the requested UI
 * path. This is intentionally stricter than "some tool ran": a successful UI
 * action, a non-empty post-action snapshot, and a goal-related visible label
 * are all required, and no UI action may have failed.
 */
export function hasDeterministicScoutCompletionEvidence(input: {
  results: ScoutTerminalEvidenceResult[];
  goal: string;
}): boolean {
  const uiActionTools = new Set(["ui.tap", "ui.swipe", "ui.press_back"]);
  const uiActions = input.results.filter((result) => uiActionTools.has(result.tool));
  if (uiActions.length === 0 || uiActions.some((result) => !result.ok)) return false;

  const verifiedAction = uiActions.some((result) => {
    if (!result.ok || !result.data || typeof result.data !== "object") return false;
    const data = result.data as { verified?: unknown; snapshot?: unknown };
    return data.verified === true && scoutUiSnapshotNodes(data.snapshot)?.length;
  });
  if (!verifiedAction) return false;

  const snapshotText = input.results
    .flatMap((result) => {
      if (!result.ok || !result.data || typeof result.data !== "object") return [];
      const data = result.data as { nodes?: unknown; snapshot?: unknown };
      const snapshot = result.tool === "ui.inspect" ? result.data : data.snapshot;
      return (scoutUiSnapshotNodes(snapshot) ?? []).map(scoutUiNodeLabel);
    })
    .join(" ")
    .toLowerCase();
  if (!snapshotText.trim()) return false;

  const stopWords = new Set([
    "and", "are", "check", "current", "for", "from", "open", "page", "show", "the", "this", "to", "verify", "with",
  ]);
  const goalTokens = (input.goal.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? [])
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  return goalTokens.length > 0 && goalTokens.some((token) => snapshotText.includes(token));
}

export function resolveScoutUiTapTarget(
  value: unknown,
  args: { x: number; y: number; target: string },
): ResolvedScoutUiTapTarget | null {
  const nodes = scoutUiNodes(value);
  const visibleNodes = nodes.filter((node) => node.enabled !== false && scoutUiBoundsRect(node.bounds));
  const clickableNodes = nodes
    .filter((node) => node.clickable === true && node.enabled !== false && scoutUiBoundsRect(node.bounds))
    .sort((left, right) => scoutUiBoundsArea(left.bounds) - scoutUiBoundsArea(right.bounds));
  const requestedTarget = normalizeScoutUiTarget(args.target);
  const coordinateTarget = clickableNodes.find((node) => scoutUiBoundsContain(node.bounds, args.x, args.y));
  const coordinateVisibleTarget = visibleNodes.find((node) => scoutUiBoundsContain(node.bounds, args.x, args.y));
  const matchingVisibleTargets = requestedTarget
    ? visibleNodes.filter((node) => normalizeScoutUiTarget(scoutUiNodeLabel(node)).includes(requestedTarget))
    : [];
  const matchingTargets = requestedTarget
    ? nodes
        .filter((node) => normalizeScoutUiTarget(scoutUiNodeLabel(node)).includes(requestedTarget))
        .map((matchingNode) => {
          const matchingCenter = scoutUiBoundsCenter(matchingNode.bounds);
          return clickableNodes.find((node) => {
            if (node === matchingNode) return true;
            return Boolean(matchingCenter && scoutUiBoundsContain(node.bounds, matchingCenter.x, matchingCenter.y));
          });
        })
        .filter((node): node is ScoutUiNodeLike => Boolean(node))
        .filter((node, index, candidates) => candidates.indexOf(node) === index)
    : [];
  const matchingTargetAtCoordinates = matchingTargets.find((node) =>
    scoutUiBoundsContain(node.bounds, args.x, args.y),
  );

  if (matchingTargetAtCoordinates) {
    return resolvedScoutUiTapTarget(matchingTargetAtCoordinates, nodes, args, false);
  }
  if (coordinateTarget) {
    return resolvedScoutUiTapTarget(coordinateTarget, nodes, args, false);
  }
  if (matchingTargets.length === 1) {
    return resolvedScoutUiTapTarget(matchingTargets[0], nodes, args, true);
  }
  if (matchingVisibleTargets.length === 1) {
    return resolvedScoutUiTapTarget(matchingVisibleTargets[0], nodes, args, true);
  }
  if (coordinateVisibleTarget && requestedTarget && normalizeScoutUiTarget(scoutUiNodeLabel(coordinateVisibleTarget)).includes(requestedTarget)) {
    return resolvedScoutUiTapTarget(coordinateVisibleTarget, nodes, args, false);
  }
  return null;
}

export function planScoutCrashRecoveryAction(value: unknown): ScoutCrashRecoveryAction | null {
  if (!isBlockingSystemUiSnapshot(value)) return null;
  const closeNode = scoutUiNodes(value).find((node) => {
    if (!isAndroidSystemUiNode(node)) return false;
    if (node.clickable !== true || node.enabled === false) return false;
    return /(?:^|\b)(?:close app|close|ok|dismiss)(?:\b|$)|关闭应用|关闭程序|^关闭$|^确定$|aerr_close/i.test(
      scoutUiNodeLabel(node),
    );
  });
  if (!closeNode) return { tool: "ui.press_back", args: {} };
  const center = scoutUiBoundsCenter(closeNode.bounds);
  const target = scoutUiNodeTarget(closeNode);
  if (!center || !target) return { tool: "ui.press_back", args: {} };
  return {
    tool: "ui.tap",
    args: {
      x: center.x,
      y: center.y,
      target,
    },
  };
}

function scoutUiNodes(value: unknown): ScoutUiNodeLike[] {
  return scoutUiSnapshotNodes(value) ?? [];
}

function scoutUiSnapshotNodes(value: unknown): ScoutUiNodeLike[] | null {
  if (!value || typeof value !== "object") return null;
  const container = value as { nodes?: unknown; snapshot?: unknown };
  if (!Array.isArray(container.nodes) && container.snapshot) {
    return scoutUiSnapshotNodes(container.snapshot);
  }
  const nodes = container.nodes;
  if (!Array.isArray(nodes)) return null;
  return nodes.filter((node): node is ScoutUiNodeLike => Boolean(node && typeof node === "object"));
}

function scoutWalkthroughGoalKeywords(goal: string | null | undefined): string[] {
  const normalized = goal?.trim().toLowerCase() ?? "";
  if (!normalized) return [];
  const keywords = new Set(
    normalized
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length >= 3) ?? [],
  );
  if (/calendar|日历|行事历/.test(normalized)) keywords.add("calendar");
  return [...keywords];
}

function scoreScoutWalkthroughApp(app: ScoutLaunchableApp, keywords: string[]): number {
  const label = app.label.trim().toLowerCase();
  const packageName = app.packageName.trim().toLowerCase();
  const componentName = app.componentName.trim().toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (label === keyword) return score + 12;
    if (packageName.split(".").includes(keyword)) return score + 9;
    if (label.includes(keyword)) return score + 6;
    if (packageName.includes(keyword) || componentName.includes(keyword)) return score + 3;
    return score;
  }, 0);
}

function scoutUiNodeLabel(node: ScoutUiNodeLike) {
  return [node.text, node.contentDesc, node.resourceId]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function isAndroidSystemUiNode(node: ScoutUiNodeLike) {
  return typeof node.resourceId === "string" && node.resourceId.toLowerCase().startsWith("android:id/");
}

function scoutUiNodeTarget(node: ScoutUiNodeLike) {
  return [node.text, node.contentDesc, node.resourceId]
    .find((part): part is string => typeof part === "string" && Boolean(part.trim()))
    ?.trim() ?? "";
}

function scoutUiBoundsCenter(value: unknown) {
  const bounds = scoutUiBoundsRect(value);
  if (!bounds) return null;
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

function scoutUiBoundsRect(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function scoutUiBoundsContain(value: unknown, x: number, y: number) {
  const bounds = scoutUiBoundsRect(value);
  return Boolean(bounds && x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom);
}

function scoutUiBoundsArea(value: unknown) {
  const bounds = scoutUiBoundsRect(value);
  return bounds ? (bounds.right - bounds.left) * (bounds.bottom - bounds.top) : Number.MAX_SAFE_INTEGER;
}

function scoutUiTargetContextLabel(
  target: ScoutUiNodeLike,
  nodes: ScoutUiNodeLike[],
  x: number,
  y: number,
  requestedTarget: string,
) {
  const labels = nodes
    .filter((node) => node === target || scoutUiBoundsContain(node.bounds, x, y))
    .map(scoutUiNodeLabel)
    .filter(Boolean);
  return [...labels, requestedTarget.trim()].filter(Boolean).join(" ");
}

function resolvedScoutUiTapTarget(
  target: ScoutUiNodeLike,
  nodes: ScoutUiNodeLike[],
  args: { x: number; y: number; target: string },
  recenter: boolean,
): ResolvedScoutUiTapTarget | null {
  const center = recenter ? scoutUiBoundsCenter(target.bounds) : null;
  if (recenter && !center) return null;
  const x = center?.x ?? args.x;
  const y = center?.y ?? args.y;
  return {
    node: target,
    x,
    y,
    label: scoutUiTargetContextLabel(target, nodes, x, y, args.target),
    confidence: target.clickable === true ? "clickable_node" : "visible_label",
  };
}

function normalizeScoutUiTarget(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function evaluateScoutTaskStartGate(input: ScoutTaskStartGateInput): ScoutTaskGateResult {
  if (!input.deviceSerial) {
    return { ok: false, reason: "device_required" };
  }
  if (!input.cliConfigured) {
    return { ok: false, reason: "runtime_required" };
  }
  if (!input.screenshotDir?.trim()) {
    return { ok: false, reason: "screenshot_dir_required" };
  }
  if (!input.goal?.trim()) {
    return { ok: false, reason: "goal_required" };
  }
  if (input.runningTask?.status === "active") {
    return { ok: false, reason: "task_already_running", runningTaskId: input.runningTask.id };
  }
  return { ok: true };
}

export function deriveScoutTaskRunState(
  session: EvidenceSession | null,
  options: { generatingReport?: boolean; failed?: boolean } = {},
): ScoutTaskRunState {
  if (options.failed) return "failed";
  if (options.generatingReport) return "generating_report";
  if (!session) return "not_started";
  if (session.status === "closed") {
    if (session.artifacts.some((artifact) => artifact.metadata?.taskStoppedByUser === true)) return "stopped";
    if (session.scribe?.terminalOutcome === "BLOCKED_NEEDS_HUMAN") return "blocked";
    if (session.scribe?.terminalOutcome === "FAILED") return "failed";
    return "completed";
  }
  return "running";
}

export function startScoutTask(input: StartScoutTaskInput): ScoutTaskResult {
  const goal = input.goal.trim();
  const targetPackage = input.kind === "walkthrough" ? input.targetPackage?.trim() || "" : "";
  const uiReferenceUrl = input.kind === "walkthrough" ? input.uiReferenceUrl?.trim() || "" : "";
  const workingDirectory = input.workingDirectory?.trim() || null;
  const scribe = {
    enabled: true,
    intensity: "key_moments" as const,
    permissionLevel: "auto_execute" as const,
    goal,
    ...(targetPackage ? { targetPackage } : {}),
    ...(uiReferenceUrl ? { uiReferenceUrl } : {}),
    agentActive: true,
    agentStartedAt: input.now,
    agentStoppedAt: null,
  };
  const session: EvidenceSession = {
    id: input.id,
    kind: input.kind,
    status: "active",
    title: goal || defaultScoutTaskTitle(input.kind),
    createdAt: input.now,
    updatedAt: input.now,
    deviceKey: input.deviceKey || input.deviceSerial || null,
    deviceSerial: input.deviceSerial || null,
    workingDirectory,
    capturePolicy: {
      screenshots: true,
      remoteAudit: true,
      logcatOnIssue: input.kind === "bug_repro",
    },
    scribe,
    artifacts: [],
  };

  return {
    session,
    events: [
      {
        type: "ScoutTaskStarted",
        taskId: session.id,
        kind: session.kind,
        deviceKey: session.deviceKey,
        deviceSerial: session.deviceSerial,
        workingDirectory: session.workingDirectory ?? null,
      },
      {
        type: "AgentRunStarted",
        taskId: session.id,
        permissionLevel: "auto_execute",
      },
    ],
  };
}

export function addScoutTaskArtifact(
  session: EvidenceSession,
  artifact: EvidenceArtifact,
  device: ScoutTaskDeviceContext,
): ScoutTaskResult {
  if (session.status !== "active") {
    return failedTaskResult(session, "task_not_active");
  }
  if (!isSameScoutTaskDevice(session, device)) {
    return failedTaskResult(session, "device_mismatch");
  }
  return {
    session: {
      ...session,
      updatedAt: Math.max(session.updatedAt, artifact.createdAt),
      artifacts: [...session.artifacts, artifact],
    },
    events: [
      {
        type: "ArtifactAdded",
        taskId: session.id,
        artifactId: artifact.id,
        artifactType: artifact.type,
      },
    ],
  };
}

export function stopScoutTaskWithReport(
  session: EvidenceSession,
  input: { now: number; reportBody: string; reportArtifact?: EvidenceArtifact },
): ScoutTaskResult {
  if (!input.reportBody.trim()) {
    return failScoutTaskReport(session, {
      now: input.now,
      error: "Final report was empty.",
    });
  }
  const artifact: EvidenceArtifact =
    input.reportArtifact ?? {
      id: `artifact-${input.now}-qa-report`,
      type: "agent_note",
      title: session.kind === "bug_repro" ? "Bug repro report" : "QA walkthrough report",
      body: input.reportBody,
      createdAt: input.now,
      metadata: {
        finalReport: true,
      },
    };
  const artifacts = session.artifacts.some((item) => item.id === artifact.id)
    ? session.artifacts
    : [...session.artifacts, artifact];
  const closedSession: EvidenceSession = {
    ...session,
    status: "closed",
    updatedAt: input.now,
    closedAt: input.now,
    scribe: session.scribe
      ? {
          ...session.scribe,
          agentActive: false,
          agentStoppedAt: input.now,
          coverageSummary: input.reportBody,
          terminalOutcome: parseScoutTerminalOutcome(input.reportBody),
        }
      : session.scribe,
    artifacts,
  };
  return {
    session: closedSession,
    events: [
      { type: "FinalReportGenerated", taskId: session.id, artifactId: artifact.id },
      { type: "ScoutTaskClosed", taskId: session.id },
    ],
  };
}

function parseScoutTerminalOutcome(value: string): ScoutTerminalOutcome | undefined {
  const match = value.match(/(?:Walkthrough|Bug repro|Scout task) outcome:\s*(COMPLETED|BLOCKED_NEEDS_HUMAN|FAILED)\s*$/im);
  return match?.[1] as ScoutTerminalOutcome | undefined;
}

export function stopScoutTaskByUser(
  session: EvidenceSession,
  input: { now: number; summary: string; title?: string },
): ScoutTaskResult {
  if (session.status === "closed") {
    return { session, events: [] };
  }
  const summary = input.summary.trim() || "Task stopped by user.";
  const artifact: EvidenceArtifact = {
    id: `artifact-${input.now}-task-stopped`,
    type: "agent_note",
    title: input.title?.trim() || "Task stopped",
    body: summary,
    createdAt: input.now,
    metadata: {
      taskStoppedByUser: true,
    },
  };
  const closedSession: EvidenceSession = {
    ...session,
    status: "closed",
    updatedAt: input.now,
    closedAt: input.now,
    scribe: session.scribe
      ? {
          ...session.scribe,
          agentActive: false,
          agentStoppedAt: input.now,
          coverageSummary: summary,
          nextAction: undefined,
        }
      : session.scribe,
    artifacts: [...session.artifacts, artifact],
  };
  return {
    session: closedSession,
    events: [
      { type: "ScoutTaskStopped", taskId: session.id, artifactId: artifact.id },
      { type: "ScoutTaskClosed", taskId: session.id },
    ],
  };
}

export function failScoutTaskReport(
  session: EvidenceSession,
  input: { now: number; error: string },
): ScoutTaskResult {
  const failedSession: EvidenceSession = {
    ...session,
    updatedAt: input.now,
    scribe: session.scribe
      ? {
          ...session.scribe,
          agentActive: true,
          agentStoppedAt: null,
          gapsSummary: input.error,
          nextAction: "Retry report generation after fixing the Agent runtime or collecting more evidence.",
        }
      : session.scribe,
  };
  return {
    session: failedSession,
    events: [{ type: "ScoutTaskFailed", taskId: session.id, reason: "report_generation_failed", error: input.error }],
  };
}

export function decideScoutToolExecution(policy: ScoutExecutionPolicy): ScoutToolExecutionDecision {
  if (policy.risk === "high") {
    return policy.permissionLevel === "auto_execute"
      ? { action: "block", reason: "high_risk" }
      : { action: "request_approval", reason: "high_risk" };
  }
  if (isProtectedScoutCommand(policy.command)) {
    return policy.permissionLevel === "auto_execute"
      ? { action: "block", reason: "always_confirm" }
      : { action: "request_approval", reason: "always_confirm" };
  }
  if (policy.permissionLevel === "auto_execute") {
    return { action: "auto_execute" };
  }
  return { action: "request_approval", reason: "permission_level" };
}

export function resolveActiveScoutTaskForMode(
  sessions: EvidenceSession[],
  input: { mode: "chat" | EvidenceSessionKind; deviceKey: string | null | undefined; deviceSerial: string | null | undefined },
): EvidenceSession | null {
  const requiredKind = input.mode === "chat" ? null : input.mode;
  return (
    sessions.find((session) => {
      if (session.status !== "active") return false;
      if (requiredKind && session.kind !== requiredKind) return false;
      return isSameScoutTaskDevice(session, input);
    }) ?? null
  );
}

export function isSameScoutTaskDevice(session: EvidenceSession, device: ScoutTaskDeviceContext): boolean {
  const sessionKey = session.deviceKey || session.deviceSerial;
  const deviceKey = device.deviceKey || device.deviceSerial;
  if (!sessionKey || !deviceKey) return false;
  return sessionKey === deviceKey || Boolean(session.deviceSerial && session.deviceSerial === device.deviceSerial);
}

function failedTaskResult(session: EvidenceSession, reason: string): ScoutTaskResult {
  return {
    session,
    events: [{ type: "ScoutTaskFailed", taskId: session.id, reason }],
  };
}

function defaultScoutTaskTitle(kind: EvidenceSessionKind): string {
  return kind === "bug_repro" ? "Bug repro" : "Feature walkthrough";
}

export function isProtectedScoutCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return PROTECTED_SCOUT_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isProtectedScoutUiTarget(target: string): boolean {
  if (PROTECTED_SCOUT_UI_NAVIGATION_PATTERNS.some((pattern) => pattern.test(target))) return false;
  return PROTECTED_SCOUT_UI_TARGET_PATTERNS.some((pattern) => pattern.test(target));
}

const PROTECTED_SCOUT_UI_NAVIGATION_PATTERNS = [
  /^\s*(?:(?:open|view|manage)[\s_-]+)?(?:payment|purchase|subscription|permission|authentication|login|sign[\s_-]*in)[\s_-]+(?:methods?|history|settings?|manager|options?|schedule|timer)\s*$/i,
  /^\s*(?:power[\s_-]+off|restart)[\s_-]+(?:timer|schedule)\s*$/i,
  /^\s*(?:permissions?|authentication)\s*$/i,
  /^\s*(?:查看|打开|管理)?(?:支付方式|购买记录|订阅设置|权限管理|身份验证设置|认证设置|登录设置|登录选项|关机定时|重启计划)\s*$/i,
  /^\s*权限\s*$/i,
];

const PROTECTED_SCOUT_UI_TARGET_PATTERNS = [
  /\buninstall\b|卸载/i,
  /\bclear[\s_-]+(?:(?:app|all|user)[\s_-]+)?(?:data|storage|cache)\b|清(?:空|除|理)(?:应用|所有|全部|用户)?(?:数据|存储|缓存)/i,
  /\bfactory[\s_-]+reset\b|\brestore[\s_-]+default[\s_-]+settings\b|\breset[\s_-]+(?:device|phone|tablet|all|settings|password|account|network(?:[\s_-]+settings)?|app[\s_-]+preferences?)\b|\breset[\s_-]+(?:wi-?fi|wifi|mobile|bluetooth)(?:[\s,;&_-]+(?:wi-?fi|wifi|mobile|bluetooth))*\b|恢复出厂|恢复默认设置|重置[\s_-]*(?:设备|手机|平板|全部|设置|密码|账户|账号|网络设置|应用偏好设置|WLAN(?:、移动数据)?(?:和蓝牙)?|Wi-?Fi(?:、移动数据)?(?:和蓝牙)?)/i,
  /\b(?:delete|remove)[\s_-]+account\b|\b(?:delete|erase|wipe)[\s_-]+(?:(?:all|app)[\s_-]+)?data\b|\berase[\s_-]+(?:all(?:[\s_-]+content)?|device)\b|删除(?:账户|账号|所有数据|全部数据|应用数据)|移除(?:账户|账号)|抹掉(?:所有内容|全部内容|应用数据|数据|设备)/i,
  /\b(?:restart|reboot|shutdown|shut[\s_-]+down|power[\s_-]*(?:off|down)|turn[\s_-]+off[\s_-]+device)\b|重启|重新启动|关机/i,
  /\b(?:purchase|payment|checkout|subscribe|subscription|pay|buy)\b|\b(?:place|confirm|submit|complete)[\s_-]+order\b|\border[\s_-]+now\b|购买|支付|订阅|下单|提交订单|确认订单/i,
  /\b(?:allow|sign[\s_-]*(?:in|out|off)|log[\s_-]*(?:in|out|off)|login|logout|permission|authorize|authorization|authenticate|authentication|grant|revoke)\b|允许|登录|登入|退出|授权|权限/i,
];

const PROTECTED_SCOUT_COMMAND_PATTERNS = [
  /\bpm\s+clear\b/,
  /\buninstall\b/,
  /\breboot\b/,
  /\bsvc\s+power\s+(?:shutdown|reboot)\b/,
  /\bandroid\.intent\.action\.action_request_shutdown\b/,
  /\bfactory\s*reset\b/,
  /\bwipe\b/,
  /\bfastboot\b/,
  /\bflash\b/,
  /\brm\s+(-r|-rf|-fr)\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bsettings\s+put\s+secure\b/,
  /\bpm\s+(grant|revoke)\b/,
  /\bappops\s+set\b/,
  /\block[_\s-]?screen\b/,
  /\bdevice[_\s-]?admin\b/,
  /\badbkey\b/,
  /\binstall-multiple\b/,
  /\b--downgrade\b/,
];
