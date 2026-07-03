import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const devicePanelPath = new URL("../src/components/layout/DevicePanel.tsx", import.meta.url);
const devicePanelCssPath = new URL("../src/components/layout/DevicePanel.css", import.meta.url);
const retiredDeviceListPath = new URL("../src/components/DeviceList.tsx", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);

test("device panel is the only active device list surface", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /import DevicePanel from "\.\/components\/layout\/DevicePanel"/);
  assert.doesNotMatch(app, /DeviceList/);
  assert.equal(existsSync(retiredDeviceListPath), false);
});

test("device panel uses Marque semantic classes instead of legacy blue-gray chips", () => {
  const source = readFileSync(devicePanelPath, "utf8");
  const css = readFileSync(devicePanelCssPath, "utf8");

  assert.match(source, /import "\.\/DevicePanel\.css"/);
  assert.match(source, /device-panel-row__connection/);
  assert.match(source, /device-panel-row__inline-state/);
  assert.doesNotMatch(source, /Badge/);
  assert.doesNotMatch(source, /bg-blue-|text-blue-|border-blue-|bg-gray-|text-gray-|border-gray-|rounded-full/);

  assert.match(css, /\.device-panel-row\.is-selected/);
  assert.match(css, /var\(--color-indigo\)/);
  assert.match(css, /\.device-panel-row__connection::before/);
  assert.doesNotMatch(css, /#2563eb|#1d4ed8|blue-600|gray-50/);
});
