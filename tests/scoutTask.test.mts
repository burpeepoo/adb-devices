import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceArtifact, EvidenceSession } from "../src/types/index.ts";
import {
  addScoutTaskArtifact,
  decideScoutToolExecution,
  deriveScoutTaskRunState,
  evaluateScoutTaskStartGate,
  failScoutTaskReport,
  hasDeterministicScoutCompletionEvidence,
  isBlockingSystemUiSnapshot,
  isProtectedScoutCommand,
  isProtectedScoutUiTarget,
  isScoutTerminalOutcomeResponse,
  planScoutCrashRecoveryAction,
  resolveScoutWalkthroughLaunchApp,
  resolveScoutUiTapTarget,
  resolveActiveScoutTaskForMode,
  SCOUT_CRASH_RECOVERY_LIMIT,
  shouldRecoverScoutEmptyUiSurface,
  startScoutTask,
  stopScoutTaskByUser,
  stopScoutTaskWithReport,
} from "../src/scoutTask/index.ts";
import { featureWalkthroughReviewPromptRules } from "../src/scoutTask/featureWalkthroughReview.ts";

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
      permissionLevel: "auto_execute",
      goal: "Calendar smoke",
      agentActive: true,
    },
    artifacts: [],
    ...overrides,
  };
}

test("start gate requires device, CLI runtime, save directory, goal, and no running task in the selected mode", () => {
  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: null,
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
    }),
    { ok: false, reason: "device_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: false,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
    }),
    { ok: false, reason: "runtime_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "",
      goal: "Calendar smoke",
    }),
    { ok: false, reason: "screenshot_dir_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "   ",
    }),
    { ok: false, reason: "goal_required" },
  );

  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Calendar smoke",
      runningTask: activeTask({ id: "running-walkthrough" }),
    }),
    { ok: false, reason: "task_already_running", runningTaskId: "running-walkthrough" },
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
    targetPackage: " com.elclcd.calendar ",
    uiReferenceUrl: " https://www.figma.com/file/calendar-smoke ",
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
    workingDirectory: "/Users/test/calendar",
    permissionLevel: "auto_execute",
  });

  assert.equal(started.session.status, "active");
  assert.equal(started.session.workingDirectory, "/Users/test/calendar");
  assert.equal(started.session.scribe?.permissionLevel, "auto_execute");
  assert.equal(started.session.scribe?.targetPackage, "com.elclcd.calendar");
  assert.equal(started.session.scribe?.uiReferenceUrl, "https://www.figma.com/file/calendar-smoke");
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

test("user stop closes an Agent-completed active task and releases the next-task gate", () => {
  const session = activeTask({
    scribe: {
      enabled: true,
      intensity: "key_moments",
      permissionLevel: "auto_execute",
      goal: "Calendar smoke",
      agentActive: false,
      agentStoppedAt: now + 1,
    },
  });

  const stopped = stopScoutTaskByUser(session, {
    now: now + 2,
    summary: "Task stopped by user.",
  });

  assert.equal(stopped.session.status, "closed");
  assert.equal(stopped.session.closedAt, now + 2);
  assert.equal(stopped.session.scribe?.agentActive, false);
  assert.equal(stopped.session.scribe?.agentStoppedAt, now + 2);
  assert.equal(stopped.session.artifacts.at(-1)?.metadata?.taskStoppedByUser, true);
  assert.equal(deriveScoutTaskRunState(stopped.session), "stopped");
  assert.deepEqual(stopped.events.map((event) => event.type), ["ScoutTaskStopped", "ScoutTaskClosed"]);
  assert.deepEqual(
    evaluateScoutTaskStartGate({
      deviceSerial: "device-1",
      cliConfigured: true,
      screenshotDir: "/tmp/screens",
      goal: "Next walkthrough",
      runningTask: stopped.session,
    }),
    { ok: true },
  );
});

test("bug repro tasks do not persist walkthrough UI reference URLs", () => {
  const started = startScoutTask({
    id: "evidence-bug-1",
    kind: "bug_repro",
    now,
    goal: "Crash after launch",
    targetPackage: "com.elclcd.calendar",
    uiReferenceUrl: "https://www.figma.com/file/not-for-repro",
    deviceKey: "device-sn-1",
    deviceSerial: "192.168.1.10:5555",
    permissionLevel: "semi_auto",
  });

  assert.equal(started.session.scribe?.uiReferenceUrl, undefined);
  assert.equal(started.session.scribe?.targetPackage, undefined);
  assert.equal(started.session.scribe?.permissionLevel, "auto_execute");
  assert.deepEqual(
    started.events.find((event) => event.type === "AgentRunStarted"),
    { type: "AgentRunStarted", taskId: started.session.id, permissionLevel: "auto_execute" },
  );
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

test("auto execute runs allowed commands and blocks protected actions without approval cards", () => {
  assert.equal(isProtectedScoutCommand("shell pm grant com.example.app android.permission.CAMERA"), true);
  assert.equal(isProtectedScoutCommand("shell svc power shutdown"), true);
  assert.equal(isProtectedScoutCommand("am start -a android.intent.action.ACTION_REQUEST_SHUTDOWN"), true);
  assert.equal(isProtectedScoutCommand("shell input keyevent HOME"), false);
  assert.equal(isProtectedScoutUiTarget("Confirm"), false);
  assert.equal(isProtectedScoutUiTarget("Submit"), false);
  assert.equal(isProtectedScoutUiTarget("Continue"), false);
  assert.equal(isProtectedScoutUiTarget("Clear search"), false);
  assert.equal(isProtectedScoutUiTarget("Reset filters"), false);
  assert.equal(isProtectedScoutUiTarget("Remove filter"), false);
  assert.equal(isProtectedScoutUiTarget("Delete draft"), false);
  assert.equal(isProtectedScoutUiTarget("Erase drawing"), false);
  assert.equal(isProtectedScoutUiTarget("Factory settings"), false);
  assert.equal(isProtectedScoutUiTarget("Payment methods"), false);
  assert.equal(isProtectedScoutUiTarget("Purchase history"), false);
  assert.equal(isProtectedScoutUiTarget("Subscription settings"), false);
  assert.equal(isProtectedScoutUiTarget("Permission manager"), false);
  assert.equal(isProtectedScoutUiTarget("Authentication settings"), false);
  assert.equal(isProtectedScoutUiTarget("Power off timer"), false);
  assert.equal(isProtectedScoutUiTarget("Restart schedule"), false);
  assert.equal(isProtectedScoutUiTarget("Login settings"), false);
  assert.equal(isProtectedScoutUiTarget("Sign-in options"), false);
  assert.equal(isProtectedScoutUiTarget("Permissions"), false);
  assert.equal(isProtectedScoutUiTarget("Reset network settings"), true);
  assert.equal(isProtectedScoutUiTarget("Reset Wi-Fi, mobile & Bluetooth"), true);
  assert.equal(isProtectedScoutUiTarget("Reset app preferences"), true);
  assert.equal(isProtectedScoutUiTarget("Clear data"), true);
  assert.equal(isProtectedScoutUiTarget("Clear app data"), true);
  assert.equal(isProtectedScoutUiTarget("Clear all data"), true);
  assert.equal(isProtectedScoutUiTarget("Clear user data"), true);
  assert.equal(isProtectedScoutUiTarget("Factory reset"), true);
  assert.equal(isProtectedScoutUiTarget("Restart device"), true);
  assert.equal(isProtectedScoutUiTarget("Reboot"), true);
  assert.equal(isProtectedScoutUiTarget("Power off"), true);
  assert.equal(isProtectedScoutUiTarget("Uninstall app"), true);
  assert.equal(isProtectedScoutUiTarget("Subscribe"), true);
  assert.equal(isProtectedScoutUiTarget("Start subscription"), true);
  assert.equal(isProtectedScoutUiTarget("Place order"), true);
  assert.equal(isProtectedScoutUiTarget("Confirm order"), true);
  assert.equal(isProtectedScoutUiTarget("Delete account"), true);
  assert.equal(isProtectedScoutUiTarget("Remove account"), true);
  assert.equal(isProtectedScoutUiTarget("Erase all content"), true);
  assert.equal(isProtectedScoutUiTarget("Delete all data"), true);
  assert.equal(isProtectedScoutUiTarget("Erase app data"), true);
  assert.equal(isProtectedScoutUiTarget("Wipe data"), true);
  assert.equal(isProtectedScoutUiTarget("Authenticate"), true);
  assert.equal(isProtectedScoutUiTarget("Shut down"), true);
  assert.equal(isProtectedScoutUiTarget("Turn off device"), true);
  assert.equal(isProtectedScoutUiTarget("Log in"), true);
  assert.equal(isProtectedScoutUiTarget("Log out"), true);
  assert.equal(isProtectedScoutUiTarget("Reset phone"), true);
  assert.equal(isProtectedScoutUiTarget("Reset tablet"), true);
  assert.equal(isProtectedScoutUiTarget("Reset settings"), true);
  assert.equal(isProtectedScoutUiTarget("Restore default settings"), true);
  assert.equal(isProtectedScoutUiTarget("Complete order"), true);
  assert.equal(isProtectedScoutUiTarget("Log off"), true);
  assert.equal(isProtectedScoutUiTarget("Sign off"), true);
  assert.equal(isProtectedScoutUiTarget("清空搜索"), false);
  assert.equal(isProtectedScoutUiTarget("重置筛选"), false);
  assert.equal(isProtectedScoutUiTarget("移除筛选条件"), false);
  assert.equal(isProtectedScoutUiTarget("删除草稿"), false);
  assert.equal(isProtectedScoutUiTarget("支付方式"), false);
  assert.equal(isProtectedScoutUiTarget("购买记录"), false);
  assert.equal(isProtectedScoutUiTarget("订阅设置"), false);
  assert.equal(isProtectedScoutUiTarget("权限管理"), false);
  assert.equal(isProtectedScoutUiTarget("身份验证设置"), false);
  assert.equal(isProtectedScoutUiTarget("关机定时"), false);
  assert.equal(isProtectedScoutUiTarget("重启计划"), false);
  assert.equal(isProtectedScoutUiTarget("登录设置"), false);
  assert.equal(isProtectedScoutUiTarget("权限"), false);
  assert.equal(isProtectedScoutUiTarget("重置网络设置"), true);
  assert.equal(isProtectedScoutUiTarget("重置 WLAN、移动数据和蓝牙"), true);
  assert.equal(isProtectedScoutUiTarget("重置应用偏好设置"), true);
  assert.equal(isProtectedScoutUiTarget("清空数据"), true);
  assert.equal(isProtectedScoutUiTarget("清除应用数据"), true);
  assert.equal(isProtectedScoutUiTarget("清除所有数据"), true);
  assert.equal(isProtectedScoutUiTarget("恢复出厂设置"), true);
  assert.equal(isProtectedScoutUiTarget("重启设备"), true);
  assert.equal(isProtectedScoutUiTarget("卸载应用"), true);
  assert.equal(isProtectedScoutUiTarget("订阅"), true);
  assert.equal(isProtectedScoutUiTarget("提交订单"), true);
  assert.equal(isProtectedScoutUiTarget("确认订单"), true);
  assert.equal(isProtectedScoutUiTarget("删除账号"), true);
  assert.equal(isProtectedScoutUiTarget("删除所有数据"), true);
  assert.equal(isProtectedScoutUiTarget("抹掉应用数据"), true);
  assert.equal(isProtectedScoutUiTarget("重置设置"), true);
  assert.equal(isProtectedScoutUiTarget("恢复默认设置"), true);
  assert.equal(isProtectedScoutUiTarget("Allow camera access"), true);
  assert.equal(isProtectedScoutUiTarget("Sign in"), true);
  assert.equal(isProtectedScoutUiTarget("Buy now"), true);
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
    { action: "block", reason: "always_confirm" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "reboot",
      risk: "high",
    }),
    { action: "block", reason: "high_risk" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "semi_auto",
      command: "shell input keyevent HOME",
      risk: "low",
    }),
    { action: "request_approval", reason: "permission_level" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "semi_auto",
      command: "reboot",
      risk: "high",
    }),
    { action: "request_approval", reason: "high_risk" },
  );

  assert.deepEqual(
    decideScoutToolExecution({
      permissionLevel: "auto_execute",
      command: "shell pm grant com.example.app android.permission.CAMERA",
      risk: "medium",
    }),
    { action: "block", reason: "always_confirm" },
  );
});

test("autonomous completion requires a declared outcome and rejects waiting language", () => {
  assert.equal(
    isScoutTerminalOutcomeResponse("Covered the target path.\n\nWalkthrough outcome: COMPLETED"),
    true,
  );
  assert.equal(
    isScoutTerminalOutcomeResponse("等待工具结果后继续。\n\nWalkthrough outcome: COMPLETED"),
    false,
  );
  assert.equal(isScoutTerminalOutcomeResponse("已完成当前检查。"), false);
});

test("autonomous closeout can complete from verified goal-related UI evidence", () => {
  const results = [
    {
      tool: "ui.tap",
      ok: true,
      data: {
        verified: true,
        snapshot: {
          nodes: [
            { text: "Day", contentDesc: "", resourceId: "com.cozyla.calendar:id/day" },
          ],
        },
      },
    },
  ];
  assert.equal(
    hasDeterministicScoutCompletionEvidence({
      results,
      goal: "Open Calendar and show the Day/Week/Month view selector.",
    }),
    true,
  );
  assert.equal(
    hasDeterministicScoutCompletionEvidence({
      results: [{ ...results[0], ok: false }],
      goal: "Open Calendar and show the Day/Week/Month view selector.",
    }),
    false,
  );
  assert.equal(
    hasDeterministicScoutCompletionEvidence({
      results: [{ tool: "ui.inspect", ok: true, data: { nodes: [{ text: "Day" }] } }],
      goal: "Open Calendar and show the Day/Week/Month view selector.",
    }),
    false,
  );
});

test("typed UI taps resolve semantic targets, clickable parents, and moved nodes", () => {
  const snapshot = {
    width: 1080,
    height: 1884,
    nodes: [
      {
        text: "",
        contentDesc: "",
        resourceId: "com.cozyla.calendar:id/rl_close",
        className: "android.widget.RelativeLayout",
        bounds: "[778,484][880,526]",
        clickable: true,
        enabled: true,
      },
      {
        text: "",
        contentDesc: "",
        resourceId: "com.cozyla.calendar:id/ll_connect",
        className: "android.widget.LinearLayout",
        bounds: "[240,1298][840,1380]",
        clickable: true,
        enabled: true,
      },
      {
        text: "Connect",
        contentDesc: "",
        resourceId: "",
        className: "android.widget.TextView",
        bounds: "[476,1318][604,1360]",
        clickable: false,
        enabled: true,
      },
      {
        text: "",
        contentDesc: "",
        resourceId: "com.example:id/delete_container",
        className: "android.widget.LinearLayout",
        bounds: "[240,1450][840,1532]",
        clickable: true,
        enabled: true,
      },
      {
        text: "Delete account",
        contentDesc: "",
        resourceId: "",
        className: "android.widget.TextView",
        bounds: "[460,1470][620,1512]",
        clickable: false,
        enabled: true,
      },
      {
        text: "",
        contentDesc: "",
        resourceId: "com.example:id/second_connect",
        className: "android.widget.LinearLayout",
        bounds: "[240,1560][840,1642]",
        clickable: true,
        enabled: true,
      },
      {
        text: "Connect",
        contentDesc: "",
        resourceId: "",
        className: "android.widget.TextView",
        bounds: "[476,1580][604,1622]",
        clickable: false,
        enabled: true,
      },
    ],
  };

  const semanticClose = resolveScoutUiTapTarget(snapshot, {
    x: 829,
    y: 505,
    target: "关闭同步错误弹窗",
  });
  assert.equal(semanticClose?.node.resourceId, "com.cozyla.calendar:id/rl_close");
  assert.deepEqual({ x: semanticClose?.x, y: semanticClose?.y }, { x: 829, y: 505 });

  const clickableParent = resolveScoutUiTapTarget(snapshot, {
    x: 540,
    y: 1339,
    target: "Connect",
  });
  assert.equal(clickableParent?.node.resourceId, "com.cozyla.calendar:id/ll_connect");
  assert.match(clickableParent?.label ?? "", /Connect/);
  assert.equal(clickableParent?.confidence, "clickable_node");

  const labeledChildWithResourceId = resolveScoutUiTapTarget(
    {
      nodes: [
        {
          text: "",
          contentDesc: "",
          resourceId: "com.cozyla.calendar:id/linear_bg",
          className: "android.widget.LinearLayout",
          bounds: "[696,218][956,278]",
          clickable: true,
          enabled: true,
        },
        {
          text: "Day",
          contentDesc: "",
          resourceId: "com.cozyla.calendar:id/tv_name",
          className: "android.widget.TextView",
          bounds: "[802,231][849,264]",
          clickable: false,
          enabled: true,
        },
      ],
    },
    { x: 0, y: 0, target: "Day" },
  );
  assert.equal(labeledChildWithResourceId?.node.resourceId, "com.cozyla.calendar:id/linear_bg");
  assert.equal(labeledChildWithResourceId?.confidence, "clickable_node");

  const labeledOnly = resolveScoutUiTapTarget(
    {
      nodes: [
        {
          text: "Open settings",
          contentDesc: "",
          resourceId: "",
          className: "android.widget.TextView",
          bounds: "[480,400][720,460]",
          clickable: false,
          enabled: true,
        },
      ],
    },
    { x: 0, y: 0, target: "Open settings" },
  );
  assert.deepEqual({ x: labeledOnly?.x, y: labeledOnly?.y }, { x: 600, y: 430 });
  assert.equal(labeledOnly?.confidence, "visible_label");

  const movedClose = resolveScoutUiTapTarget(snapshot, {
    x: 829,
    y: 541,
    target: "com.cozyla.calendar:id/rl_close",
  });
  assert.equal(movedClose?.node.resourceId, "com.cozyla.calendar:id/rl_close");
  assert.deepEqual({ x: movedClose?.x, y: movedClose?.y }, { x: 829, y: 505 });

  const protectedChild = resolveScoutUiTapTarget(snapshot, {
    x: 540,
    y: 1491,
    target: "Delete account",
  });
  assert.equal(protectedChild?.node.resourceId, "com.example:id/delete_container");
  assert.equal(isProtectedScoutUiTarget(protectedChild?.label ?? ""), true);

  const repeatedLabel = resolveScoutUiTapTarget(snapshot, {
    x: 540,
    y: 1601,
    target: "Connect",
  });
  assert.equal(repeatedLabel?.node.resourceId, "com.example:id/second_connect");
  assert.deepEqual({ x: repeatedLabel?.x, y: repeatedLabel?.y }, { x: 540, y: 1601 });

  const fullScreenRoot = resolveScoutUiTapTarget(
    {
      nodes: [
        {
          text: "",
          contentDesc: "",
          resourceId: "com.example:id/global_click",
          bounds: "[0,0][1080,1884]",
          clickable: true,
          enabled: true,
        },
        {
          text: "Delete account",
          contentDesc: "",
          resourceId: "",
          bounds: "[800,1600][1000,1700]",
          clickable: false,
          enabled: true,
        },
      ],
    },
    { x: 100, y: 100, target: "screen" },
  );
  assert.equal(fullScreenRoot?.node.resourceId, "com.example:id/global_click");
  assert.equal(isProtectedScoutUiTarget(fullScreenRoot?.label ?? ""), false);
});

test("an active task remains running until the single Scout Run is closed", () => {
  assert.equal(
    deriveScoutTaskRunState(
      activeTask({
        scribe: {
          enabled: true,
          intensity: "key_moments",
          permissionLevel: "auto_execute",
          goal: "Calendar smoke",
          agentActive: false,
          agentStoppedAt: now + 10,
        },
      }),
    ),
    "running",
  );
  assert.equal(deriveScoutTaskRunState(activeTask()), "running");
  assert.equal(deriveScoutTaskRunState(activeTask({ status: "closed", closedAt: now + 20 })), "completed");
  assert.equal(
    deriveScoutTaskRunState(
      activeTask({
        status: "closed",
        closedAt: now + 20,
        scribe: {
          enabled: true,
          intensity: "key_moments",
          permissionLevel: "auto_execute",
          goal: "Calendar smoke",
          agentActive: false,
          terminalOutcome: "BLOCKED_NEEDS_HUMAN",
        },
      }),
    ),
    "blocked",
  );
});

test("auto walkthrough plans bounded crash-dialog recovery before reporting a blocker", () => {
  const anrSnapshot = {
    width: 1080,
    height: 1884,
    nodes: [
      {
        text: "Screensaver isn't responding",
        contentDesc: "",
        resourceId: "android:id/alertTitle",
        bounds: "[211,863][868,904]",
        clickable: false,
        enabled: true,
      },
      {
        text: "Close app",
        contentDesc: "",
        resourceId: "android:id/aerr_close",
        bounds: "[175,927][904,999]",
        clickable: true,
        enabled: true,
      },
      {
        text: "Wait",
        contentDesc: "",
        resourceId: "android:id/aerr_wait",
        bounds: "[175,999][904,1071]",
        clickable: true,
        enabled: true,
      },
    ],
  };

  assert.equal(SCOUT_CRASH_RECOVERY_LIMIT, 5);
  assert.equal(isBlockingSystemUiSnapshot(anrSnapshot), true);
  assert.equal(isBlockingSystemUiSnapshot({ snapshot: anrSnapshot }), true);
  assert.equal(
    isBlockingSystemUiSnapshot({
      nodes: [
        {
          text: "Network not responding",
          contentDesc: "",
          resourceId: "com.example:id/status",
          bounds: "[0,0][100,100]",
          clickable: false,
          enabled: true,
        },
      ],
    }),
    false,
  );
  assert.deepEqual(planScoutCrashRecoveryAction(anrSnapshot), {
    tool: "ui.tap",
    args: { x: 540, y: 963, target: "Close app" },
  });
  assert.deepEqual(
    planScoutCrashRecoveryAction({
      nodes: [
        {
          text: "Calendar keeps stopping",
          contentDesc: "",
          resourceId: "android:id/alertTitle",
          bounds: "[200,800][880,900]",
          clickable: false,
          enabled: true,
        },
      ],
    }),
    { tool: "ui.press_back", args: {} },
  );
});

test("walkthrough treats an explicit empty UI snapshot as a recoverable surface", () => {
  assert.equal(shouldRecoverScoutEmptyUiSurface({ nodes: [] }), true);
  assert.equal(shouldRecoverScoutEmptyUiSurface({ snapshot: { nodes: [] } }), true);
  assert.equal(
    shouldRecoverScoutEmptyUiSurface({
      nodes: [
        {
          text: "Calendar",
          clickable: true,
          enabled: true,
        },
      ],
    }),
    false,
  );
  assert.equal(shouldRecoverScoutEmptyUiSurface({}), false);
});

test("walkthrough launch recovery honors the selected target package", () => {
  const apps = [
    {
      packageName: "com.elclcd.screensaver",
      label: "Screensaver",
      componentName: "com.elclcd.screensaver/.view.DreamSettingActivity",
    },
    {
      packageName: "com.elclcd.calendar",
      label: "Calendar",
      componentName: "com.elclcd.calendar/.MainActivity",
    },
  ];

  assert.deepEqual(
    resolveScoutWalkthroughLaunchApp({
      targetPackage: "com.elclcd.calendar",
      goal: "Something else",
      apps,
    }),
    apps[1],
  );
  assert.equal(
    resolveScoutWalkthroughLaunchApp({
      targetPackage: "com.example.missing",
      goal: "Calendar smoke",
      apps,
    }),
    null,
  );
});

test("walkthrough launch recovery finds Calendar from English or Chinese goals when no package is selected", () => {
  const apps = [
    {
      packageName: "com.elclcd.screensaver",
      label: "Screensaver",
      componentName: "com.elclcd.screensaver/.view.DreamSettingActivity",
    },
    {
      packageName: "com.elclcd.calendar",
      label: "Calendar",
      componentName: "com.elclcd.calendar/.MainActivity",
    },
  ];

  assert.equal(
    resolveScoutWalkthroughLaunchApp({ goal: "Calendar create, edit, and delete", apps })?.packageName,
    "com.elclcd.calendar",
  );
  assert.equal(
    resolveScoutWalkthroughLaunchApp({ goal: "日历功能走查", apps })?.packageName,
    "com.elclcd.calendar",
  );
});

test("chat mode reads the active task record without creating a new evidence record", () => {
  const active = activeTask();
  const activeBugRepro = activeTask({ id: "evidence-bug-repro", kind: "bug_repro" });
  const olderClosed = activeTask({ id: "evidence-closed", status: "closed", closedAt: now - 1 });
  const sessions = [olderClosed, active, activeBugRepro];

  assert.equal(
    resolveActiveScoutTaskForMode(sessions, {
      mode: "chat",
      deviceKey: "device-sn-1",
      deviceSerial: "192.168.1.10:5555",
    })?.id,
    "evidence-active",
  );
  assert.equal(sessions.length, 3);

  assert.equal(
    resolveActiveScoutTaskForMode(sessions, {
      mode: "bug_repro",
      deviceKey: "device-sn-1",
      deviceSerial: "192.168.1.10:5555",
    })?.id,
    "evidence-bug-repro",
  );

  assert.equal(
    resolveActiveScoutTaskForMode(sessions, {
      mode: "walkthrough",
      deviceKey: "other-device",
      deviceSerial: "other-serial",
    }),
    null,
  );
});

test("feature walkthrough review rules stay scoped to walkthrough tasks", () => {
  const walkthroughRules = featureWalkthroughReviewPromptRules("walkthrough");

  assert.ok(walkthroughRules.length > 0);
  assert.match(walkthroughRules.join("\n"), /coverage matrix/i);
  assert.match(walkthroughRules.join("\n"), /functional coverage/i);
  assert.match(walkthroughRules.join("\n"), /do not collect device summaries/i);
  assert.match(walkthroughRules.join("\n"), /performance baseline/i);
  assert.match(walkthroughRules.join("\n"), /non-empty user goal.*authoritative/i);
  assert.match(walkthroughRules.join("\n"), /first tool call must be ui\.inspect/i);
  assert.deepEqual(featureWalkthroughReviewPromptRules("bug_repro"), []);
});
