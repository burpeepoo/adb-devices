import type {
  EvidenceArtifact,
  EvidenceSession,
  EvidenceSessionKind,
  ScoutTaskPermissionLevel,
} from "../types";

export type ScoutTaskRunState = "not_started" | "running" | "generating_report" | "completed" | "failed";

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
  runningTask: EvidenceSession | null | undefined;
}

export interface StartScoutTaskInput {
  id: string;
  kind: EvidenceSessionKind;
  now: number;
  goal: string;
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
  return session.status === "closed" ? "completed" : "running";
}

export function startScoutTask(input: StartScoutTaskInput): ScoutTaskResult {
  const goal = input.goal.trim();
  const workingDirectory = input.workingDirectory?.trim() || null;
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
    scribe: {
      enabled: true,
      intensity: "key_moments",
      permissionLevel: input.permissionLevel,
      goal,
      agentActive: true,
      agentStartedAt: input.now,
      agentStoppedAt: null,
    },
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
        permissionLevel: input.permissionLevel,
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
    return { action: "request_approval", reason: "high_risk" };
  }
  if (isAlwaysConfirmCommand(policy.command)) {
    return { action: "request_approval", reason: "always_confirm" };
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

function isAlwaysConfirmCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return ALWAYS_CONFIRM_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

const ALWAYS_CONFIRM_COMMAND_PATTERNS = [
  /\bpm\s+clear\b/,
  /\buninstall\b/,
  /\breboot\b/,
  /\bfactory\s*reset\b/,
  /\bwipe\b/,
  /\bfastboot\b/,
  /\bflash\b/,
  /\brm\s+(-r|-rf|-fr)\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bsettings\s+put\s+secure\b/,
  /\block[_\s-]?screen\b/,
  /\bdevice[_\s-]?admin\b/,
  /\badbkey\b/,
  /\binstall-multiple\b/,
  /\b--downgrade\b/,
];
