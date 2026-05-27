import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunAdbStartupRepair } from "../src/startupAdbRepair.ts";

test("runs startup ADB repair when this app version has not completed it", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: { completedVersion: "1.1.13" },
      now: 10_000,
    }),
    true,
  );
});

test("skips startup ADB repair after this app version recently completed it", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: { completedVersion: "1.1.14", completedAt: 9_000 },
      now: 10_000,
    }),
    false,
  );
});

test("allows startup ADB repair on a new app launch after completion cooldown expires", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: { completedVersion: "1.1.14", completedAt: 0 },
      now: 10 * 60 * 1000 + 1,
    }),
    true,
  );
});

test("runs once for installs that do not have startup ADB repair state yet", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: undefined,
      now: 10_000,
    }),
    true,
  );
});

test("cooldowns repeated startup ADB repair attempts for the same app version", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: { attemptedVersion: "1.1.14", attemptedAt: 9_000 },
      now: 10_000,
    }),
    false,
  );
});

test("allows retry after startup ADB repair cooldown expires", () => {
  assert.equal(
    shouldRunAdbStartupRepair({
      currentVersion: "1.1.14",
      saved: { attemptedVersion: "1.1.14", attemptedAt: 0 },
      now: 10 * 60 * 1000 + 1,
    }),
    true,
  );
});
