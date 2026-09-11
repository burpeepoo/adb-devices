import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import ts from "typescript";

import { resolveVisibleSelectedDevice } from "../src/deviceSelection.ts";
import { buildDeviceTargetState } from "../src/deviceTarget.ts";
import type { DeviceInfo } from "../src/types/index.ts";
import {
  HttpLogParser,
  buildNetworkCaptureExport,
  type NetworkCaptureInfo,
  type NetworkLogLine,
  type NetworkParserSnapshot,
} from "../src/networkInspector.ts";

interface CaptureSnapshot {
  session_id: string;
  lines: NetworkLogLine[];
  status: "running" | "stopped" | "error" | "app_restarted";
  dropped_lines: number;
  error_code: string | null;
}

interface CaptureModel {
  capture: NetworkCaptureInfo | null;
  snapshot: NetworkParserSnapshot;
  running: boolean;
  busy: boolean;
  status: string;
  error: string | null;
  droppedLines: number;
  start(packageName: string): Promise<void>;
  stop(): Promise<void>;
}

type Invoke = (command: string, args: Record<string, string>) => Promise<unknown>;
type Cleanup = (() => void) | void;
type DependencyList = readonly unknown[];
interface EffectSlot { dependencies: DependencyList; cleanup: Cleanup }
interface CallbackSlot { dependencies: DependencyList; callback: unknown }

const source = readFileSync(new URL("../src/hooks/useNetworkCapture.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function metadata(device: string): NetworkCaptureInfo {
  return {
    session_id: `${device}-session`, device_serial: device,
    package_name: "com.example.calendar", pid: "10", started_at_ms: 1,
  };
}

function lines(messages: string[]): NetworkLogLine[] {
  return messages.map((message, index) => ({
    message, pid: "10", tid: "11", timestamp: `09-11 12:00:00.${String(index).padStart(3, "0")}`,
  }));
}

function snapshot(
  device: string,
  messages: string[] = [],
  status: CaptureSnapshot["status"] = "running",
  errorCode: string | null = null,
): CaptureSnapshot {
  return { session_id: `${device}-session`, lines: lines(messages), status, dropped_lines: 0, error_code: errorCode };
}

const request = ["--> GET https://example.test/calendar", "--> END GET"];
const response = [
  "<-- 200 https://example.test/calendar (7ms)", "Content-Type: application/json", "", '{"ok":true}',
];
const responseEnd = "<-- END HTTP (8ms, 11-byte body)";

/**
 * Exercise the production hook with controlled Tauri promises. This small React
 * boundary preserves state/refs, callback dependencies and passive-effect
 * cleanup-before-setup order. Timers advance explicitly, so races need neither
 * a browser nor a device, wall-clock delays or new testing dependencies.
 */
function createHarness(invoke: Invoke) {
  const slots: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  let mounted = true;
  let target: [string | null, string | null] = [null, null];
  let model: CaptureModel;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const effectSlots = new Set<number>();
  let pendingEffects: Array<{ index: number; previous?: EffectSlot; dependencies: DependencyList; setup: () => Cleanup }> = [];
  const same = (a: DependencyList, b: DependencyList) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slots[index], (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slots[index] as T) : value;
        if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; }
      }];
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback<T>(callback: T, dependencies: DependencyList): T {
      const index = cursor++;
      const previous = slots[index] as CallbackSlot | undefined;
      if (!previous || !same(previous.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return (slots[index] as CallbackSlot).callback as T;
    },
    useEffect(setup: () => Cleanup, dependencies: DependencyList) {
      const index = cursor++;
      const previous = slots[index] as EffectSlot | undefined;
      if (!previous || !same(previous.dependencies, dependencies)) pendingEffects.push({ index, previous, dependencies, setup });
      effectSlots.add(index);
    },
  };
  const module = { exports: {} as { useNetworkCapture(selected: string | null, online: string | null): CaptureModel } };
  new Script(compiled, { filename: "useNetworkCapture.compiled.cjs" }).runInNewContext({
    module, exports: module.exports,
    require(name: string) {
      if (name === "react") return react;
      if (name === "@tauri-apps/api/core") return { invoke };
      if (name === "../networkInspector.ts") return { HttpLogParser };
      throw new Error(`Unexpected hook dependency: ${name}`);
    },
    window: {
      setInterval(callback: () => void) { const id = nextTimer++; timers.set(id, callback); return id; },
      clearInterval(id: number) { timers.delete(id); },
    },
  });

  function render(selected = target[0], online = target[1]): CaptureModel {
    assert.ok(mounted, "cannot render an unmounted hook");
    target = [selected, online];
    let renders = 0;
    do {
      assert.ok(++renders <= 20, "hook did not settle its synchronous effects");
      cursor = 0;
      dirty = false;
      pendingEffects = [];
      model = module.exports.useNetworkCapture(...target);
      for (const effect of pendingEffects) effect.previous?.cleanup?.();
      for (const effect of pendingEffects) slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.setup() };
    } while (dirty);
    return model;
  }

  return {
    render,
    current() { return dirty && mounted ? render() : model; },
    async flush() {
      // Each turn drains the whole promise queue; subsequent renders may enqueue
      // another bounded set of effects and promise continuations.
      for (let turn = 0; turn < 6; turn += 1) { await setImmediate(); if (dirty && mounted) render(); }
    },
    tick() { for (const callback of [...timers.values()]) callback(); },
    unmount() {
      if (!mounted) return;
      mounted = false;
      for (const index of effectSlots) (slots[index] as EffectSlot | undefined)?.cleanup?.();
      timers.clear();
    },
  };
}

test("target B waits for an outstanding start A and its stale-session stop", async (t) => {
  const startA = deferred<NetworkCaptureInfo>();
  const stopA = deferred<CaptureSnapshot>();
  const calls: string[] = [];
  let active: string | null = null;
  const harness = createHarness(async (command, args) => {
    if (command === "adb_network_capture_start") {
      calls.push(`start:${args.deviceSerial}`);
      if (active) throw new Error("CAPTURE_ALREADY_RUNNING");
      active = args.deviceSerial;
      return args.deviceSerial === "A" ? startA.promise : metadata("B");
    }
    if (command === "adb_network_capture_stop") {
      calls.push(`stop:${args.sessionId}`);
      if (args.sessionId === "A-session") {
        const final = await stopA.promise;
        active = null;
        return final;
      }
      active = null;
      return snapshot("B", [], "stopped");
    }
    return snapshot(active ?? "B");
  });
  t.after(async () => { startA.resolve(metadata("A")); stopA.resolve(snapshot("A", [], "stopped")); harness.unmount(); await harness.flush(); });

  const first = harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  const second = harness.render("B", "B").start("com.example.calendar");
  await harness.flush();
  assert.deepEqual(calls, ["start:A"], "B must not start while A is unresolved");
  assert.equal(harness.current().busy, true);

  startA.resolve(metadata("A"));
  await harness.flush();
  assert.deepEqual(calls, ["start:A", "stop:A-session"], "B must also await A's teardown");
  stopA.resolve(snapshot("A", [], "stopped"));
  await Promise.all([first, second]);
  await harness.flush();
  assert.deepEqual(calls, ["start:A", "stop:A-session", "start:B"]);
  assert.equal(harness.current().capture?.device_serial, "B");
  assert.equal(harness.current().running, true);
  assert.equal(harness.current().error, null);
});

test("an old stop cannot clear busy or permit a duplicate start for a new target", async (t) => {
  const stopA = deferred<CaptureSnapshot>();
  const startB = deferred<NetworkCaptureInfo>();
  const calls: string[] = [];
  const harness = createHarness(async (command, args) => {
    if (command === "adb_network_capture_start") {
      calls.push(`start:${args.deviceSerial}`);
      return args.deviceSerial === "A" ? metadata("A") : startB.promise;
    }
    if (command === "adb_network_capture_stop") {
      calls.push(`stop:${args.sessionId}`);
      return args.sessionId === "A-session" ? stopA.promise : snapshot("B", [], "stopped");
    }
    return snapshot(args.sessionId === "A-session" ? "A" : "B");
  });
  t.after(async () => { stopA.resolve(snapshot("A", [], "stopped")); startB.resolve(metadata("B")); harness.unmount(); await harness.flush(); });

  await harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  const firstStop = harness.current().stop();
  await harness.flush();
  const secondStart = harness.render("B", "B").start("com.example.calendar");
  await harness.flush();
  assert.equal(harness.current().busy, true);
  stopA.resolve(snapshot("A", [], "stopped"));
  await firstStop;
  await harness.flush();
  assert.ok(calls.includes("start:B"), "new start reaches the backend after old teardown");
  assert.equal(harness.current().busy, true, "old stop's finally must not clear the unresolved B start");
  void harness.current().start("com.example.calendar");
  await harness.flush();
  assert.equal(calls.filter((call) => call === "start:B").length, 1, "busy capture rejects duplicate starts");
  startB.resolve(metadata("B"));
  await secondStart;
  await harness.flush();
  assert.equal(harness.current().capture?.device_serial, "B");
  assert.equal(harness.current().busy, false);
});

test("temporary unavailability retains the selected capture and its terminal response", async (t) => {
  let next = snapshot("A", request);
  let starts = 0;
  const harness = createHarness(async (command) => {
    if (command === "adb_network_capture_start") { starts += 1; return metadata("A"); }
    if (command === "adb_network_capture_stop") return snapshot("A", [], "stopped");
    const result = next;
    next = snapshot("A");
    return result;
  });
  t.after(async () => { harness.unmount(); await harness.flush(); });

  await harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  assert.equal(harness.current().snapshot.requests.length, 1);
  harness.render("A", null);
  assert.equal(harness.current().capture?.session_id, "A-session");
  assert.equal(harness.current().snapshot.requests.length, 1, "disconnect must not erase accumulated requests");

  next = snapshot("A", [...response, responseEnd], "error", "DEVICE_UNAVAILABLE");
  harness.tick();
  await harness.flush();
  const ended = harness.current();
  assert.equal(ended.running, false);
  assert.equal(ended.status, "error");
  assert.equal(ended.error, "DEVICE_UNAVAILABLE");
  assert.equal(ended.snapshot.requests[0].state, "complete");
  assert.deepEqual(JSON.parse(ended.snapshot.requests[0].responseBody.text), { ok: true });
  await ended.start("com.example.calendar");
  await harness.flush();
  assert.equal(starts, 1, "a disconnected selected device cannot start another capture");
  const exported = JSON.parse(buildNetworkCaptureExport(ended.capture!, ended.snapshot, {
    droppedLines: ended.droppedLines, status: ended.status, exportedAtMs: 2,
  }));
  assert.equal(exported.capture.device_serial, "A");
  assert.equal(exported.requests.length, 1);
  assert.equal(exported.status, "error");
  harness.render("A", "A");
  assert.equal(harness.current().snapshot.requests.length, 1, "reconnection alone must not replace the saved capture");
});

test("stop applies an in-flight snapshot before the final drain and keeps the result exportable", async (t) => {
  const pendingPoll = deferred<CaptureSnapshot>();
  const finalDrain = deferred<CaptureSnapshot>();
  const calls: string[] = [];
  let polls = 0;
  const harness = createHarness(async (command) => {
    if (command === "adb_network_capture_start") return metadata("A");
    if (command === "adb_network_capture_stop") { calls.push("stop"); return finalDrain.promise; }
    polls += 1;
    calls.push(`poll:${polls}`);
    return polls === 1 ? snapshot("A", request) : pendingPoll.promise;
  });
  t.after(async () => { pendingPoll.resolve(snapshot("A", response)); finalDrain.resolve(snapshot("A", [responseEnd], "stopped")); harness.unmount(); await harness.flush(); });

  await harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  harness.tick();
  await harness.flush();
  const stopping = harness.current().stop();
  await harness.flush();
  assert.deepEqual(calls, ["poll:1", "poll:2"], "final drain waits for the outstanding poll");
  pendingPoll.resolve(snapshot("A", response));
  await harness.flush();
  assert.deepEqual(calls, ["poll:1", "poll:2", "stop"]);
  finalDrain.resolve(snapshot("A", [responseEnd], "stopped"));
  await stopping;
  await harness.flush();
  const ended = harness.current();
  assert.equal(ended.running, false);
  assert.equal(ended.busy, false);
  assert.equal(ended.status, "stopped");
  assert.equal(ended.capture?.session_id, "A-session");
  assert.equal(ended.snapshot.requests[0].state, "complete");
  assert.equal(ended.snapshot.requests[0].responseBody.state, "complete");
  assert.deepEqual(JSON.parse(ended.snapshot.requests[0].responseBody.text), { ok: true });
  const exported = JSON.parse(buildNetworkCaptureExport(ended.capture!, ended.snapshot, {
    droppedLines: ended.droppedLines, status: ended.status, exportedAtMs: 2,
  }));
  assert.equal(exported.requests[0].state, "complete");
  assert.equal(exported.status, "stopped");
  await ended.stop();
  assert.equal(calls.filter((call) => call === "stop").length, 1, "repeated stop must not drain another session");
});

test("device-list refresh retains the old final drain until a new capture starts successfully", async (t) => {
  const startB = deferred<NetworkCaptureInfo>();
  const finalA = deferred<CaptureSnapshot>();
  const calls: string[] = [];
  let nextA = snapshot("A", request);
  let nextB = snapshot("B");
  const harness = createHarness(async (command, args) => {
    if (command === "adb_network_capture_start") {
      calls.push(`start:${args.deviceSerial}`);
      return args.deviceSerial === "A" ? metadata("A") : startB.promise;
    }
    if (command === "adb_network_capture_stop") {
      calls.push(`stop:${args.sessionId}`);
      return args.sessionId === "A-session" ? finalA.promise : snapshot("B", [], "stopped");
    }
    if (args.sessionId === "A-session") { const result = nextA; nextA = snapshot("A"); return result; }
    const result = nextB;
    nextB = snapshot("B");
    return result;
  });
  t.after(async () => { startB.resolve(metadata("B")); finalA.resolve(snapshot("A", [...response, responseEnd], "stopped")); harness.unmount(); await harness.flush(); });

  await harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  const disconnected: DeviceInfo = {
    serial: "A", device_sn: "A", state: "disconnected", model: "synthetic", product: "synthetic", connection_type: "usb",
  };
  // This is the same selection/target composition that useDevices and App run
  // when the only connected device disappears during refresh or window focus.
  const selectionAfterRefresh = resolveVisibleSelectedDevice("A", [], [disconnected]);
  const unavailable = buildDeviceTargetState([disconnected], selectionAfterRefresh, {});
  assert.equal(unavailable.selectedSerial, null);
  harness.render(unavailable.selectedSerial, unavailable.serial);
  await harness.flush();
  assert.ok(calls.includes("stop:A-session"), "selection fallback releases the previous collector");
  assert.equal(harness.current().capture?.session_id, "A-session");
  assert.equal(harness.current().snapshot.requests.length, 1, "automatic deselection must preserve captured evidence");
  finalA.resolve(snapshot("A", [...response, responseEnd], "stopped"));
  await harness.flush();
  const retained = harness.current();
  assert.equal(retained.running, false);
  assert.equal(retained.snapshot.requests[0].state, "complete", "target cleanup must also apply its final response");
  assert.deepEqual(JSON.parse(retained.snapshot.requests[0].responseBody.text), { ok: true });
  const exported = JSON.parse(buildNetworkCaptureExport(retained.capture!, retained.snapshot, {
    droppedLines: retained.droppedLines, status: retained.status, exportedAtMs: 2,
  }));
  assert.equal(exported.capture.device_serial, "A");
  assert.equal(exported.requests.length, 1);

  const deviceB: DeviceInfo = { ...disconnected, serial: "B", device_sn: "B", state: "device" };
  const nextSelected = resolveVisibleSelectedDevice(null, [deviceB], [disconnected, deviceB]);
  const nextTarget = buildDeviceTargetState([disconnected, deviceB], nextSelected, {});
  const startingB = harness.render(nextTarget.selectedSerial, nextTarget.serial).start("com.example.calendar");
  await harness.flush();
  assert.ok(calls.includes("start:B"));
  assert.equal(harness.current().capture?.session_id, "A-session", "keep prior evidence while the new start is unresolved");
  assert.equal(harness.current().snapshot.requests.length, 1);
  startB.resolve(metadata("B"));
  await startingB;
  await harness.flush();
  assert.equal(harness.current().capture?.session_id, "B-session");
  assert.equal(harness.current().snapshot.requests.length, 0, "only the successful new session replaces prior records");
  nextB = snapshot("B", [
    "--> GET https://example.test/other-device", "--> END GET",
    "<-- 204 https://example.test/other-device (2ms)", "<-- END HTTP (0-byte body)",
  ]);
  harness.tick();
  await harness.flush();
  const fresh = harness.current().snapshot.requests;
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].id, "B-session:1");
  assert.equal(fresh[0].url, "https://example.test/other-device");
  assert.equal(fresh[0].statusCode, 204);
});

test("rapid A to B to C changes discard stale starts and keep late A drains out of C", async (t) => {
  const pendingA = deferred<CaptureSnapshot>();
  const finalA = deferred<CaptureSnapshot>();
  const calls: string[] = [];
  let pollsA = 0;
  let stopsA = 0;
  let nextC = snapshot("C", [
    "--> GET https://example.test/device-c", "--> END GET",
    "<-- 204 https://example.test/device-c (2ms)", "<-- END HTTP (0-byte body)",
  ]);
  const harness = createHarness(async (command, args) => {
    if (command === "adb_network_capture_start") { calls.push(`start:${args.deviceSerial}`); return metadata(args.deviceSerial); }
    if (command === "adb_network_capture_stop") {
      calls.push(`stop:${args.sessionId}`);
      if (args.sessionId === "A-session") {
        stopsA += 1;
        // A duplicated cleanup is harmless only if its response remains bound
        // to the old session. It may never populate the eventual C capture.
        return stopsA === 1 ? finalA.promise : snapshot("A", [...request, ...response, responseEnd], "stopped");
      }
      return snapshot("C", [], "stopped");
    }
    if (args.sessionId === "A-session") { pollsA += 1; return pollsA === 1 ? snapshot("A", request) : pendingA.promise; }
    const result = nextC;
    nextC = snapshot("C");
    return result;
  });
  t.after(async () => { pendingA.resolve(snapshot("A", response)); finalA.resolve(snapshot("A", [responseEnd], "stopped")); harness.unmount(); await harness.flush(); });

  await harness.render("A", "A").start("com.example.calendar");
  await harness.flush();
  harness.tick();
  await harness.flush();
  const startB = harness.render("B", "B").start("com.example.calendar");
  await harness.flush();
  const startC = harness.render("C", "C").start("com.example.calendar");
  await harness.flush();
  assert.deepEqual(calls, ["start:A"], "neither replacement starts while A has an outstanding snapshot");
  pendingA.resolve(snapshot("A", response));
  await harness.flush();
  assert.ok(calls.includes("stop:A-session"));
  assert.equal(calls.some((call) => call === "start:B" || call === "start:C"), false);
  finalA.resolve(snapshot("A", [responseEnd], "stopped"));
  await Promise.all([startB, startC]);
  await harness.flush();
  assert.deepEqual(calls.filter((call) => call.startsWith("start:")), ["start:A", "start:C"]);
  const result = harness.current();
  assert.equal(result.capture?.device_serial, "C");
  assert.equal(result.running, true);
  assert.equal(result.busy, false);
  assert.equal(result.error, null);
  assert.equal(result.snapshot.requests.length, 1);
  assert.equal(result.snapshot.requests[0].id, "C-session:1");
  assert.equal(result.snapshot.requests[0].url, "https://example.test/device-c");
});
