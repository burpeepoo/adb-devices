import assert from "node:assert/strict";
import test from "node:test";
import { markTabVisited, primaryTabKey, TAB_KEYS } from "../src/tabState.ts";

test("tab order covers every workspace tab", () => {
  assert.deepEqual(TAB_KEYS, [
    "pair",
    "workbench",
    "agent",
    "install",
    "screenshot",
    "record",
    "mirror",
    "remote",
    "imageCast",
    "clipboard",
    "logcat",
    "displayCalibration",
    "performance",
    "packages",
  ]);
});

test("visited tabs accumulate without dropping previous tab state", () => {
  const initial = new Set(["pair"] as const);
  const withInstall = markTabVisited(initial, "install");
  const withClipboard = markTabVisited(withInstall, "clipboard");

  assert.deepEqual([...withClipboard], ["pair", "install", "clipboard"]);
  assert.deepEqual([...initial], ["pair"]);
});

test("pair tab remains the primary device console route", () => {
  assert.equal(primaryTabKey(), "pair");
});
