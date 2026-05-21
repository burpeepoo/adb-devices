import assert from "node:assert/strict";
import test from "node:test";
import {
  UPDATE_AUTO_CHECK_INTERVAL_MS,
  canRunAutomaticUpdateCheck,
  isAutoUpdateCheckEnabled,
} from "../src/updaterPolicy.ts";

test("auto update checks default to enabled", () => {
  assert.equal(isAutoUpdateCheckEnabled(undefined), true);
  assert.equal(isAutoUpdateCheckEnabled(true), true);
});

test("auto update checks can be disabled explicitly", () => {
  assert.equal(isAutoUpdateCheckEnabled(false), false);
});

test("auto update checks run every six hours", () => {
  assert.equal(UPDATE_AUTO_CHECK_INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test("automatic checks avoid active update states", () => {
  assert.equal(canRunAutomaticUpdateCheck("idle"), true);
  assert.equal(canRunAutomaticUpdateCheck("not-available"), true);
  assert.equal(canRunAutomaticUpdateCheck("error"), true);
  assert.equal(canRunAutomaticUpdateCheck("checking"), false);
  assert.equal(canRunAutomaticUpdateCheck("available"), false);
  assert.equal(canRunAutomaticUpdateCheck("downloading"), false);
  assert.equal(canRunAutomaticUpdateCheck("ready"), false);
});
