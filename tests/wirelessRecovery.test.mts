import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWirelessRecoverySteps } from "../src/wirelessRecovery.ts";
import type { MdnsDevice, RecentConnectEndpoint } from "../src/types/index.ts";

test("recommends recent endpoint probing when mDNS finds nothing but history exists", () => {
  const steps = buildWirelessRecoverySteps({
    mdnsDeviceCount: 0,
    recentConnects: [recent("192.168.110.111", "36887")],
    reachableRecentCount: 0,
    showRepair: false,
    showResetHostIdentity: false,
    localIps: ["192.168.110.20"],
  });

  assert.equal(steps.find((step) => step.id === "recent")?.state, "recommended");
  assert.equal(steps.find((step) => step.id === "mdns")?.state, "warning");
});

test("recommends manual current-port connection when a recent endpoint is reachable", () => {
  const steps = buildWirelessRecoverySteps({
    mdnsDeviceCount: 0,
    recentConnects: [recent("192.168.110.111", "36887")],
    reachableRecentCount: 1,
    showRepair: false,
    showResetHostIdentity: false,
    localIps: ["192.168.110.20"],
  });

  assert.equal(steps.find((step) => step.id === "manual")?.state, "recommended");
});

test("keeps host identity reset locked behind safe repair", () => {
  const steps = buildWirelessRecoverySteps({
    mdnsDeviceCount: 0,
    recentConnects: [],
    reachableRecentCount: 0,
    showRepair: true,
    showResetHostIdentity: true,
    localIps: ["192.168.110.20", "10.0.0.5"],
  });

  assert.equal(steps.find((step) => step.id === "repair")?.state, "recommended");
  assert.equal(steps.find((step) => step.id === "reset")?.state, "danger");
  assert.equal(steps.some((step) => step.hasMultiNetworkHint), true);
});

test("wireless recovery ladder steps do not render as bordered cards", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const componentStart = source.indexOf("function WirelessRecoverySteps");
  const componentEnd = source.indexOf("function recoveryAction");
  const componentSource = source.slice(componentStart, componentEnd);

  assert.match(componentSource, /<div key=\{step\.id\} className="px-3 py-2">/);
  assert.match(componentSource, /<Text className="wireless-recovery-step-index" size="sm" fw=\{600\}>/);
  assert.match(componentSource, /className="wireless-recovery-step-index"/);
  assert.match(componentSource, /wireless-recovery-step-state--\$\{step\.state\}/);
  assert.match(indexCss, /\.wireless-recovery-step-state/);
  assert.doesNotMatch(componentSource, /rounded-md border border-gray-200 bg-white/);
  assert.doesNotMatch(componentSource, /<Badge size="xs" color="gray" variant="light">\s*\{index \+ 1\}/);
  assert.doesNotMatch(componentSource, /<Badge[\s\S]*pairConnect\.recovery\.states/);
});

test("device connection row statuses are inline text instead of badge chips", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const mdnsRow = componentSlice(source, "function MdnsRow", "function ConnectedAdbDeviceRow");
  const connectedRow = componentSlice(source, "function ConnectedAdbDeviceRow", "function isMdnsDeviceConnected");

  assert.match(mdnsRow, /device-inline-status device-inline-status--positive/);
  assert.match(connectedRow, /device-inline-status device-inline-status--positive/);
  assert.match(indexCss, /\.device-inline-status::before/);
  assert.doesNotMatch(mdnsRow, /<Badge[\s\S]*pairConnect\.(connectable|connected|notConnected)/);
  assert.doesNotMatch(connectedRow, /<Badge[\s\S]*pairConnect\.(connected|adbConnected)/);
});

function recent(ip: string, port: string): RecentConnectEndpoint {
  return { ip, port, lastConnectedAt: 1000 };
}

function componentSlice(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  assert.ok(end > start, `${endMarker} should appear after ${startMarker}`);
  return source.slice(start, end);
}
