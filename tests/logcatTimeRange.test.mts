import assert from "node:assert/strict";
import test from "node:test";

import {
  LOGCAT_CUSTOM_RANGE,
  MAX_LOGCAT_LOOKBACK_MINUTES,
  logcatRangeAmount,
  resolveLogcatLookbackSeconds,
} from "../src/logcatTimeRange.ts";

test("resolves preset, all-buffer, and custom logcat ranges", () => {
  assert.equal(resolveLogcatLookbackSeconds("900", ""), 900);
  assert.equal(resolveLogcatLookbackSeconds("0", ""), 0);
  assert.equal(resolveLogcatLookbackSeconds(LOGCAT_CUSTOM_RANGE, "90"), 5400);
});

test("rejects invalid custom ranges outside one minute through seven days", () => {
  assert.equal(resolveLogcatLookbackSeconds(LOGCAT_CUSTOM_RANGE, "0"), null);
  assert.equal(resolveLogcatLookbackSeconds(LOGCAT_CUSTOM_RANGE, "1.5"), null);
  assert.equal(resolveLogcatLookbackSeconds("unexpected", "10"), null);
  assert.equal(resolveLogcatLookbackSeconds(
    LOGCAT_CUSTOM_RANGE,
    String(MAX_LOGCAT_LOOKBACK_MINUTES + 100),
  ), null);
});

test("formats only whole-hour ranges as hours", () => {
  assert.deepEqual(logcatRangeAmount(3600), { unit: "hours", count: 1 });
  assert.deepEqual(logcatRangeAmount(3660), { unit: "minutes", count: 61 });
  assert.deepEqual(logcatRangeAmount(5400), { unit: "minutes", count: 90 });
});
