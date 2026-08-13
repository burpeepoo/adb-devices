import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeAdbRestartRecovery } from "../src/adbRestartRecovery.ts";
import { buildWirelessRecoverySteps } from "../src/wirelessRecovery.ts";
import type { MdnsDevice, RecentConnectEndpoint } from "../src/types/index.ts";

test("restart recovery fails when no device reconnects and preserves the last endpoint error", () => {
  assert.deepEqual(
    summarizeAdbRestartRecovery({
      reconnectedCount: 0,
      visibleServiceCount: 1,
      reconnectErrors: [
        "mDNS refresh failed",
        "ADB command failed: Connection failed: No route to host",
      ],
    }),
    {
      recovered: false,
      outcome: "services_only",
      lastError: "ADB command failed: Connection failed: No route to host",
    },
  );
});

test("restart recovery succeeds only after a real endpoint reconnect", () => {
  assert.deepEqual(
    summarizeAdbRestartRecovery({
      reconnectedCount: 1,
      visibleServiceCount: 0,
      reconnectErrors: [],
    }),
    {
      recovered: true,
      outcome: "reconnected",
      lastError: null,
    },
  );
});

test("macOS bundle declares local-network and wireless ADB Bonjour usage", () => {
  const plist = readFileSync(new URL("../src-tauri/Info.plist", import.meta.url), "utf8");
  const config = readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8");
  const english = readFileSync(new URL("../src-tauri/en.lproj/InfoPlist.strings", import.meta.url), "utf8");
  const chinese = readFileSync(new URL("../src-tauri/zh-Hans.lproj/InfoPlist.strings", import.meta.url), "utf8");

  assert.match(config, /"infoPlist"\s*:\s*"Info\.plist"/);
  assert.match(plist, /<key>NSLocalNetworkUsageDescription<\/key>/);
  assert.match(plist, /<key>NSBonjourServices<\/key>/);
  assert.match(plist, /_adb-tls-connect\._tcp/);
  assert.match(plist, /_adb-tls-pairing\._tcp/);
  assert.match(config, /en\.lproj\/InfoPlist\.strings/);
  assert.match(config, /zh-Hans\.lproj\/InfoPlist\.strings/);
  assert.match(english, /NSLocalNetworkUsageDescription/);
  assert.match(chinese, /使用本地网络发现并连接/);
});

test("restart health checks the responding ADB server and failed reconnects are not swallowed", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../src-tauri/src/commands/device.rs", import.meta.url), "utf8");
  const restartFlow = componentSlice(source, "const restartAdbAndReconnect", "useEffect(() => {");
  const startServer = componentSlice(backend, "fn start_adb_server", "fn restart_adb_server");

  assert.match(startServer, /verify_adb_server_identity_and_health/);
  assert.match(backend, /\["server-status"\]/);
  assert.match(backend, /\["devices", "-l"\]/);
  assert.match(backend, /let direct_error = connect_failed_error\(&output\);/);
  assert.match(backend, /if let Ok\(Some\(message\)\) = connect_via_mdns_autoconnect/);
  assert.match(restartFlow, /reconnectCandidatesWithCurrentEndpoint\(\s*recentConnects,\s*connectIp,\s*connectPort/);
  assert.match(restartFlow, /authoritativeDevices = await invoke<DeviceInfo\[\]>\("adb_devices"\)/);
  assert.doesNotMatch(restartFlow, /Array\.isArray\(refreshedDevices\)[\s\S]*devicesRef\.current/);
  assert.match(restartFlow, /reconnectErrors\.push\(String\(error\)\)/);
  assert.match(restartFlow, /ok:\s*recoverySummary\.recovered/);
  assert.match(restartFlow, /return recoverySummary\.recovered/);
  assert.doesNotMatch(restartFlow, /catch\s*\{\s*setEndpointProbeStates/);
});

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

test("failed pairing and mDNS scans do not disturb the shared online device list", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const deviceCommand = readFileSync(new URL("../src-tauri/src/commands/device.rs", import.meta.url), "utf8");
  const pairCommand = componentSlice(
    deviceCommand,
    "pub fn adb_pair",
    "#[tauri::command(async)]\npub fn adb_restart_and_retry_pair",
  );
  const scanAction = componentSlice(source, "const handleScan", "const handlePair");

  assert.doesNotMatch(pairCommand, /restart_adb_server/);
  assert.doesNotMatch(scanAction, /await onConnected\(\)/);
});

test("manual pairing recovery preserves pairing records and retries the submitted request", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const deviceCommand = readFileSync(new URL("../src-tauri/src/commands/device.rs", import.meta.url), "utf8");
  const tauriCommands = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const pairAction = componentSlice(
    source,
    "const handlePair = async () =>",
    "const handleRestartAndRetryPair",
  );
  const retryAction = componentSlice(
    source,
    "const handleRestartAndRetryPair",
    "const handleConnect = async () =>",
  );
  const retryCommand = componentSlice(
    deviceCommand,
    "pub fn adb_restart_and_retry_pair",
    "#[tauri::command(async)]\npub fn adb_connect",
  );

  assert.match(pairAction, /const request = \{ ip, port, code \}/);
  assert.match(pairAction, /lastFailedPairRequestRef\.current = request/);
  assert.ok(
    pairAction.indexOf("await runAdbOperation")
      < pairAction.indexOf("lastFailedPairRequestRef.current = request"),
  );
  assert.ok(
    pairAction.indexOf("lastFailedPairRequestRef.current = request")
      < pairAction.indexOf('invoke<string>("adb_pair"'),
  );
  assert.match(retryAction, /retryPairAfterAdbRestart\(\s*request/);
  assert.match(retryAction, /\(command, args\) => invoke<string>\(command, args\)/);
  assert.match(retryAction, /setPairResult\(result\)/);
  assert.match(retryAction, /if \(!result\.ok\)/);
  assert.match(retryAction, /setPairResult\(\{ ok: false, msg: String\(e\) \}\)/);
  assert.match(retryCommand, /restart_adb_server_preserving_pairing\(&app\)\?/);
  assert.match(retryCommand, /pair_device\(&app, &ip, &port, &code\)/);
  assert.ok(
    retryCommand.indexOf("restart_adb_server_preserving_pairing(&app)?")
      < retryCommand.indexOf("pair_device(&app, &ip, &port, &code)"),
  );
  assert.doesNotMatch(retryCommand, /restart_adb_server\(&app\)\?/);
  assert.match(tauriCommands, /commands::device::adb_restart_and_retry_pair/);
});

test("mDNS result recovery binds the disclosed pairing-cache refresh action", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const english = readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8");
  const chinese = readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8");
  const resultRecovery = componentSlice(
    source,
    "{mdnsResult && (",
    "onClick={() => setShowManual",
  );

  assert.match(resultRecovery, /onRepairWirelessPairing=\{handleRepairWirelessPairing\}/);
  assert.doesNotMatch(resultRecovery, /onRepairWirelessPairing=\{handleRestartAdbAndScan\}/);
  assert.doesNotMatch(english, /Try safe repair first/);
  assert.doesNotMatch(chinese, /请先尝试安全修复/);
  assert.match(english, /retry once with the originally submitted IP, port, and pairing code/);
  assert.match(chinese, /用原先提交的 IP、端口和配对码重试一次/);
  assert.match(english, /Use only after refreshing the pairing cache still fails/);
  assert.match(chinese, /仅在刷新配对缓存后仍失败时使用/);
});

test("failed restart reconnect surfaces pairing-cache refresh before identity reset", () => {
  const source = readFileSync(new URL("../src/components/PairConnect.tsx", import.meta.url), "utf8");
  const recentReconnect = componentSlice(
    source,
    "const handleRecentReconnect",
    "const restartAdbAndReconnect",
  );

  assert.match(
    recentReconnect,
    /if \(restartAdb\) \{\s*setPairRepairVisible\(true\);\s*setHostIdentityResetVisible\(true\);\s*\}/,
  );
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
  assert.doesNotMatch(reconnectCommand, /restart_adb_server\(&app\)\?/);
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
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} should exist`);
  assert.ok(end > start, `${endMarker} should appear after ${startMarker}`);
  return source.slice(start, end);
}
