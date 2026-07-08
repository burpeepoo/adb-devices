import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceArtifact, EvidenceSession } from "../src/types/index.ts";
import {
  addScoutTaskArtifact,
  decideScoutToolExecution,
  evaluateScoutTaskStartGate,
  failScoutTaskReport,
  resolveActiveScoutTaskForMode,
  startScoutTask,
  stopScoutTaskWithReport,
} from "../src/scoutTask/index.ts";

const now = 1_725_000_000_000;

const baseArtifact: EvidenceArtifact = {
  id: "artifact-screen-1",
  type: "screen_state",
  title: "Screen state",
  body: "Foreground/window evidence",
  createdAt: now + 1,
};

function activeTask(overrides: Partial<EvidenceSession> = {}): EvidenceSession {
  return {
    id: "evidence-active",
    kind: "walkthrough",
    status: "active",
    title: "Calendar smoke",
    createdAt: now,
    updatedAt: now,
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
    capturePolicy: {
      screenshots: true,
      remoteAudit: true,
      logcatOnIssue: false,
    },
    scribe: {
      enabled: true,
      intensity: "key_moments",
      permissionLevel: "semi_auto",
      goal: "Calendar smoke",
      agentActive: true,
    },
    artifacts: [],
    ...overrides,
  };
}

test("start gate requires device, CLI runtime, save directory, goal, and no other running task", () => {
  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: null,
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
      runningTask: null,
    }),
    { ok: false, reason: "device_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: false,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
      runningTask: null,
    }),
    { ok: false, reason: "runtime_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "",
      goal: "Calendar smoke",
      runningTask: null,
    }),
    { ok: false, reason: "screenshot_dir_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "   ",
      runningTask: null,
    }),
    { ok: false, reason: "goal_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
      runningTask: activeTask(),
    }),
    { ok: false, reason: "task_already_running", runningTaskId: "evidence-active" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
      runningTask: null,
    }),
    { ok: true },
  );
});

test("task lifecycle records start, artifacts, final report, and close events", () => {
  const started = startScoutTask({
    id: "evidence-1",
    kind: "walkthrough",
    now,
    goal: "Calendar smoke",
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
    workingDirectory: "/Users/test/calendar",
    permissionLevel: "auto_execute",
  });

  assert.equal(started.session.status, "active");
  assert.equal(started.session.workingDirectory, "/Users/test/calendar");
  assert.equal(started.session.scribe?.permissionLevel, "auto_execute");
  assert.deepEqual(started.events.map((event) => event.type), ["ScoutTaskStarted", "AgentRunStarted"]);
  assert.deepEqual(started.events[0], {
    type: "ScoutTaskStarted",
    taskId: "evidence-1",
    kind: "walkthrough",
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
    workingDirectory: "/Users/test/calendar",
  });

  const appended = addScoutTaskArtifact(started.session, baseArtifact, {
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
  });
  assert.equal(appended.session.artifacts.length, 1);
  assert.deepEqual(appended.events.map((event) => event.type), ["ArtifactAdded"]);

  const stopped = stopScoutTaskWithReport(appended.session, {
    now: now + 2,
    reportBody: "## Engineering summary\nCalendar opened successfully.",
  });
  assert.equal(stopped.session.status, "closed");
  assert.equal(stopped.session.closedAt, now + 2);
  assert.equal(stopped.session.artifacts.at(-1)?.type, "agent_note");
  assert.deepEqual(stopped.events.map((event) => event.type), ["FinalReportGenerated", "ScoutTaskClosed"]);
});

test("report generation failure keeps the task active and retryable", () => {
  const session = activeTask();
  const result = failScoutTaskReport(session, {
    now: now + 2,
    error: "Agent CLI exited 1",
  });

  assert.equal(result.session.status, "active");
  assert.equal(result.session.closedAt, undefined);
  assert.equal(result.session.scribe?.agentActive, true);
  assert.equal(result.session.scribe?.agentStoppedAt, null);
  assert.match(result.session.scribe?.gapsSummary ?? "", /Agent CLI exited 1/);
  assert.deepEqual(result.events.map((event) => event.type), ["ScoutTaskFailed"]);
});

test("auto execute runs only allowed low and medium risk commands", () => {
  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "shell input keyevent HOME",
      risk: "low",
    }),
    { action: "auto_execute" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "shell settings put system screen_brightness 120",
      risk: "medium",
    }),
    { action: "auto_execute" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "shell pm clear com.example.app",
      risk: "medium",
    }),
    { action: "request_approval", reason: "always_confirm" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "reboot",
      risk: "high",
    }),
    { action: "request_approval", reason: "high_risk" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "semi_auto",
      command: "shell input keyevent HOME",
      risk: "low",
    }),
    { action: "request_approval", reason: "permission_level" },
  );
});

test("chat mode reads the active task record without creating a new evidence record", () => {
  const active = activeTask();
  const olderClosed = activeTask({ id: "evidence-closed", status: "closed", closedAt: now - 1 });
  const sessions = [olderClosed, active];

  assert.equal(
    resolveActiveScoutTaskForMode(sessions, {
      mode: "chat",
      deviceKey: "device-sn-1",
      deviceSerial: "192.168.1.10:5555",
    })?.id,
    "evidence-active",
  );
  assert.equal(sessions.length, 2);

  assert.equal(
    resolveActiveScoutTaskForMode(sessions, {
      mode: "walkthrough",
      deviceKey: "other-device",
      deviceSerial: "other-serial",
    }),
    null,
  );
});
