import assert from "node:assert/strict";
import test from "node:test";
import { groupLaunchableApps } from "../src/appDrawerGrouping.ts";
import type { LaunchableApp } from "../src/types/index.ts";

test("groups launchable apps by namespace after com", () => {
  const groups = groupLaunchableApps([
    app("com.google.android.apps.docs", "Docs"),
    app("com.cozyla.calendar", "Calendar"),
    app("com.android.settings", "Settings"),
    app("com.google.android.youtube", "Youtube"),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.title, group.apps.map((item) => item.label)]),
    [
      ["Android", ["Settings"]],
      ["Cozyla", ["Calendar"]],
      ["Google", ["Docs", "Youtube"]],
    ]
  );
});

test("groups elclcd packages into Cozyla", () => {
  const groups = groupLaunchableApps([
    app("com.elclcd.screensaver", "Screensaver"),
    app("com.cozyla.appstore", "Appstore"),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.title, group.apps.map((item) => item.package_name)]),
    [["Cozyla", ["com.cozyla.appstore", "com.elclcd.screensaver"]]]
  );
});

function app(packageName: string, label: string): LaunchableApp {
  return {
    package_name: packageName,
    activity_name: `${packageName}.MainActivity`,
    component_name: `${packageName}/${packageName}.MainActivity`,
    label,
    icon_data_url: null,
  };
}
