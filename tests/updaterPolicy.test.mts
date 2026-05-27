import assert from "node:assert/strict";
import test from "node:test";
import {
  UPDATE_AUTO_CHECK_INTERVAL_MS,
  canRunAutomaticUpdateCheck,
  getUpdateCheckErrorKind,
  isAutoUpdateCheckEnabled,
  isLikelyUpdateNetworkError,
  shouldTreatUpdateCheckErrorAsNoUpdate,
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

test("invalid release JSON update check errors are treated as no update", () => {
  assert.equal(
    shouldTreatUpdateCheckErrorAsNoUpdate(new Error("Could not fetch a valid release JSON from the remote")),
    true
  );
  assert.equal(shouldTreatUpdateCheckErrorAsNoUpdate(new Error("Failed to download update")), false);
  assert.equal(
    shouldTreatUpdateCheckErrorAsNoUpdate(
      new Error(
        "error sending request for url (https://github.com/burpeepoo/adb-devices/releases/latest/download/latest.json)"
      )
    ),
    false
  );
});

test("update request transport failures are classified as network errors", () => {
  const error = new Error(
    "error sending request for url (https://github.com/burpeepoo/adb-devices/releases/latest/download/latest.json)"
  );
  assert.equal(getUpdateCheckErrorKind(error), "network");
  assert.equal(isLikelyUpdateNetworkError(error), true);
  assert.equal(isLikelyUpdateNetworkError(new Error("Failed to download update")), false);
});
