import assert from "node:assert/strict";
import test from "node:test";
import { retryPairAfterAdbRestart } from "../src/pairRecovery.ts";

test("forwards the immutable captured failed pairing request unchanged", async () => {
  const failedRequest = Object.freeze({
    ip: "10.0.0.221",
    port: "36607",
    code: "773659",
  });
  const calls: Array<{ command: string; args: unknown }> = [];

  const result = await retryPairAfterAdbRestart(failedRequest, async (command, args) => {
    calls.push({ command, args });
    return "Successfully paired";
  });

  assert.deepEqual(calls, [
    {
      command: "adb_restart_and_retry_pair",
      args: failedRequest,
    },
  ]);
  assert.deepEqual(result, { ok: true, msg: "Successfully paired" });
});

test("returns the latest pairing failure instead of reporting the daemon restart as success", async () => {
  const failedRequest = {
    ip: "10.0.0.221",
    port: "36607",
    code: "773659",
  };

  const result = await retryPairAfterAdbRestart(failedRequest, async () => {
    throw new Error("Pairing code rejected");
  });

  assert.deepEqual(result, { ok: false, msg: "Error: Pairing code rejected" });
});
