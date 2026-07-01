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
  const componentStart = source.indexOf("function WirelessRecoverySteps");
  const componentEnd = source.indexOf("function recoveryAction");
  const componentSource = source.slice(componentStart, componentEnd);

  assert.match(componentSource, /<div key=\{step\.id\} className="px-3 py-2">/);
  assert.match(componentSource, /<Text size="sm" fw=\{600\} c="gray\.8"/);
  assert.doesNotMatch(componentSource, /rounded-md border border-gray-200 bg-white/);
  assert.doesNotMatch(componentSource, /<Badge size="xs" color="gray" variant="light">\s*\{index \+ 1\}/);
});

function recent(ip: string, port: string): RecentConnectEndpoint {
  return { ip, port, lastConnectedAt: 1000 };
}
