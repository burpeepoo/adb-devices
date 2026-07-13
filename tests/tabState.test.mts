import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toolNavigationLabelKeys } from "../src/toolNavigationLabels.ts";
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

test("compact English navigation labels stay distinct from full page titles", () => {
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.deepEqual(toolNavigationLabelKeys, {
    pair: "layout.toolNavigation.pair",
    remote: "layout.toolNavigation.remote",
    workbench: "layout.toolNavigation.workbench",
    performance: "layout.toolNavigation.performance",
  });
  assert.deepEqual(en.layout.toolNavigation, {
    pair: "Devices",
    remote: "Remote",
    workbench: "ADB Tools",
    performance: "Performance",
  });
  assert.equal(en.tabs.pairConnect, "Device Console");
  assert.equal(en.tabs.remoteControl, "Remote Console");
  assert.equal(en.tabs.workbench, "ADB Workbench");
  assert.equal(en.tabs.performance, "Performance Sampling");
  assert.deepEqual(zh.layout.toolNavigation, {
    pair: zh.tabs.pairConnect,
    remote: zh.tabs.remoteControl,
    workbench: zh.tabs.workbench,
    performance: zh.tabs.performance,
  });
  assert.match(appSource, /label: t\(toolNavigationLabelKeys\[item\.key\] \?\? toolLabelKeys\[item\.key\]\)/);
});

test("tab keys can be resolved from automation-friendly hash values", () => {
  assert.equal(tabKeyFromValue("#agent"), "agent");
  assert.equal(tabKeyFromValue("tab=agent"), "agent");
  assert.equal(tabKeyFromValue("#unknown"), null);
  assert.equal(initialTabKeyFrom("#settings-updates", null), "pair");
  assert.equal(initialTabKeyFrom("#pair", "agent"), "agent");
  assert.equal(hashForTab("agent"), "#agent");
});
