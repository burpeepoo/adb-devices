import assert from "node:assert/strict";
import test from "node:test";
import { hashForTab, initialTabKeyFrom, markTabVisited, primaryTabKey, tabKeyFromValue, TAB_KEYS } from "../src/tabState.ts";

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

test("tab keys can be resolved from automation-friendly hash values", () => {
  assert.equal(tabKeyFromValue("#agent"), "agent");
  assert.equal(tabKeyFromValue("tab=agent"), "agent");
  assert.equal(tabKeyFromValue("#unknown"), null);
  assert.equal(initialTabKeyFrom("#settings-updates", null), "pair");
  assert.equal(initialTabKeyFrom("#pair", "agent"), "agent");
  assert.equal(hashForTab("agent"), "#agent");
});
