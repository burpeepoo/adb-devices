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

test("keeps repair and host identity reset available while escalating recommendation state", () => {
  const defaultSteps = buildWirelessRecoverySteps({
    mdnsDeviceCount: 0,
    recentConnects: [],
    reachableRecentCount: 0,
    showRepair: false,
    showResetHostIdentity: false,
    localIps: ["192.168.110.20"],
  });

  assert.equal(defaultSteps.find((step) => step.id === "repair")?.state, "idle");
  assert.equal(defaultSteps.find((step) => step.id === "reset")?.state, "idle");

  const escalatedSteps = buildWirelessRecoverySteps({
    mdnsDeviceCount: 0,
    recentConnects: [],
    reachableRecentCount: 0,
    showRepair: true,
    showResetHostIdentity: true,
    localIps: ["192.168.110.20", "10.0.0.5"],
  });

  assert.equal(escalatedSteps.find((step) => step.id === "repair")?.state, "recommended");
  assert.equal(escalatedSteps.find((step) => step.id === "reset")?.state, "danger");
  assert.equal(escalatedSteps.some((step) => step.hasMultiNetworkHint), true);
});

test("repair and host identity reset actions stay clickable unless ADB is busy", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const actionSource = componentSlice(source, "function recoveryAction", "function PairRepairAction");
  const repairAction = componentSlice(actionSource, 'if (step.id === "repair")', 'if (step.id === "reset")');
  const resetAction = componentSlice(actionSource, 'if (step.id === "reset")', "return null;");

  assert.match(repairAction, /disabled=\{options\.disabled\}/);
  assert.match(resetAction, /disabled=\{options\.disabled\}/);
  assert.doesNotMatch(actionSource, /step\.state === "locked"/);
  assert.doesNotMatch(actionSource, /step\.state !== "danger"/);
});

test("wireless recovery ladder steps do not render as bordered cards", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const componentStart = source.indexOf("function WirelessRecoverySteps");
  const componentEnd = source.indexOf("function recoveryAction");
  const componentSource = source.slice(componentStart, componentEnd);

  assert.match(componentSource, /<div key=\{step\.id\} className="px-3 py-2">/);
  assert.match(componentSource, /\{index \+ 1\}\. \{t\(`pairConnect\.recovery\.steps\.\$\{step\.id\}\.title`\)\}/);
  assert.doesNotMatch(componentSource, /wireless-recovery-step-(meta|index|state)/);
  assert.doesNotMatch(componentSource, /pairConnect\.recovery\.states/);
  assert.doesNotMatch(indexCss, /\.wireless-recovery-step-(meta|index|state)/);
  assert.doesNotMatch(componentSource, /rounded-md border border-gray-200 bg-white/);
  assert.doesNotMatch(componentSource, /<Badge size="xs" color="gray" variant="light">\s*\{index \+ 1\}/);
  assert.doesNotMatch(componentSource, /<Badge[\s\S]*pairConnect\.recovery\.states/);
});

test("safe wireless repair action uses a dedicated deep burgundy control", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const recoveryRepairAction = componentSlice(source, 'if (step.id === "repair")', 'if (step.id === "reset")');
  const fallbackRepairAction = componentSlice(source, "function PairRepairAction", "function ResultMessage");

  assert.match(recoveryRepairAction, /pair-connect-safe-repair-button/);
  assert.match(fallbackRepairAction, /pair-connect-safe-repair-button/);
  assert.doesNotMatch(recoveryRepairAction, /color="orange"/);
  assert.doesNotMatch(fallbackRepairAction, /color="orange"/);
  assert.match(indexCss, /--pair-connect-safe-repair-bg:\s*#5a1c16;/i);
  assert.match(indexCss, /--pair-connect-safe-repair-hover:\s*#45110e;/i);
});

test("device connection row statuses are inline text instead of badge chips", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const mdnsRow = componentSlice(source, "function MdnsRow", "function MdnsNeedsPairRow");
  const connectedRow = componentSlice(source, "function ConnectedAdbDeviceRow", "function MdnsPairRow");

  assert.match(mdnsRow, /device-inline-status device-inline-status--positive/);
  assert.match(connectedRow, /device-inline-status device-inline-status--positive/);
  assert.match(indexCss, /\.device-inline-status::before/);
  assert.doesNotMatch(mdnsRow, /<Badge[\s\S]*pairConnect\.(connectable|connected|notConnected)/);
  assert.doesNotMatch(connectedRow, /<Badge[\s\S]*pairConnect\.(connected|adbConnected)/);
});

test("first-time connect services render a pairing action instead of direct connect", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const needsPairRow = componentSlice(source, "function MdnsNeedsPairRow", "function ConnectedAdbDeviceRow");

  assert.match(source, /buildMdnsPairingViewModel\(mdnsDevices, connectedDevices, recentConnects\)/);
  assert.match(source, /unpairedConnectDevices\.map/);
  assert.match(needsPairRow, /pairConnect\.inputPairCode/);
  assert.match(needsPairRow, /pairConnect\.pairPortDetectedShort/);
  assert.doesNotMatch(needsPairRow, /pairConnect\.oneClickConnect/);
});

test("mdns auto-connect reports refreshed device truth instead of stale command output", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const autoConnectBlock = componentSlice(source, "const handleMdnsAutoConnect", "const handleRecentReconnect");

  assert.match(autoConnectBlock, /await invoke<DeviceInfo\[\]>\("adb_mdns_auto_connect"\)/);
  assert.match(autoConnectBlock, /const refreshedDevices = await onConnected\(\)/);
  assert.match(autoConnectBlock, /Array\.isArray\(refreshedDevices\) \? refreshedDevices : devicesRef\.current/);
  assert.ok(autoConnectBlock.indexOf("adb_mdns_auto_connect") < autoConnectBlock.indexOf("await onConnected()"));
  assert.match(autoConnectBlock, /pairConnect\.autoConnected/);
});

test("recent endpoint restart reconnect is exposed and preserves pairing state", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const deviceCommand = readFileSync(new URL("../src-tauri/src/commands/device.rs", import.meta.url), "utf8");
  const recentFallback = componentSlice(source, "function RecentConnectFallback", "function probeBadgeColor");
  const restartScan = componentSlice(source, "const handleRestartAdbAndScan", "const handleRepairWirelessPairing");
  const reconnectCommand = componentSlice(
    deviceCommand,
    "pub fn adb_reconnect_endpoint",
    "#[tauri::command(async)]\npub fn adb_disconnect",
  );

  assert.match(source, /onRestartAdbAndReconnect=\{\(endpoint\) => handleRecentReconnect\(endpoint, true\)\}/);
  assert.match(recentFallback, /pairConnect\.restartAdbAndReconnect/);
  assert.match(restartScan, /preservePairing: true/);
  assert.match(reconnectCommand, /if restart_adb \{\s*restart_adb_server_preserving_pairing\(&app\)\?/);
  assert.doesNotMatch(reconnectCommand, /if restart_adb \{\s*restart_adb_server\(&app\)\?/);
});

test("wireless ADB authorization timeout uses a dedicated hidden ADB-backed command", () => {
  const deviceCommand = readFileSync(new URL("../src-tauri/src/commands/device.rs", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const readCommandBlock = componentSlice(
    deviceCommand,
    "pub fn adb_get_authorization_timeout_disabled",
    "#[tauri::command(async)]\npub fn adb_set_authorization_timeout_disabled",
  );
  const commandBlock = componentSlice(
    deviceCommand,
    "pub fn adb_set_authorization_timeout_disabled",
    "#[tauri::command(async)]\npub fn adb_mdns_discover",
  );

  assert.match(readCommandBlock, /settings/);
  assert.match(readCommandBlock, /get/);
  assert.match(readCommandBlock, /adb_allowed_connection_time/);
  assert.match(readCommandBlock, /value == "0"/);
  assert.match(readCommandBlock, /Some\(&device_serial\)/);
  assert.match(commandBlock, /adb_allowed_connection_time/);
  assert.match(commandBlock, /let value = if disabled \{ "0" \} else \{ "604800000" \}/);
  assert.match(commandBlock, /adb::run_adb_with_timeout/);
  assert.match(commandBlock, /Some\(&device_serial\)/);
  assert.match(lib, /commands::device::adb_get_authorization_timeout_disabled/);
  assert.match(lib, /commands::device::adb_set_authorization_timeout_disabled/);
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
