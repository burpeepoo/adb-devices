import type { RecentConnectEndpoint } from "./types";

export type WirelessRecoveryStepId = "network" | "mdns" | "recent" | "manual" | "repair" | "reset";
export type WirelessRecoveryStepState = "idle" | "done" | "recommended" | "warning" | "danger";

export interface WirelessRecoveryStep {
  id: WirelessRecoveryStepId;
  state: WirelessRecoveryStepState;
  hasMultiNetworkHint?: boolean;
}

export interface WirelessRecoveryInput {
  mdnsDeviceCount: number;
  recentConnects: RecentConnectEndpoint[];
  reachableRecentCount: number;
  showRepair: boolean;
  showResetHostIdentity: boolean;
  localIps: string[];
}

export function buildWirelessRecoverySteps(input: WirelessRecoveryInput): WirelessRecoveryStep[] {
  const hasMdnsDevices = input.mdnsDeviceCount > 0;
  const hasRecent = input.recentConnects.length > 0;
  const hasReachableRecent = input.reachableRecentCount > 0;
  const hasMultiNetworkHint = localNetworkCount(input.localIps) > 1;

  return [
    {
      id: "network",
      state: hasMultiNetworkHint ? "warning" : "done",
      hasMultiNetworkHint,
    },
    {
      id: "mdns",
      state: hasMdnsDevices ? "done" : hasRecent ? "warning" : "recommended",
    },
    {
      id: "recent",
      state: hasReachableRecent ? "done" : !hasMdnsDevices && hasRecent ? "recommended" : "idle",
    },
    {
      id: "manual",
      state: hasReachableRecent ? "recommended" : "idle",
    },
    {
      id: "repair",
      state: input.showRepair ? "recommended" : "idle",
    },
    {
      id: "reset",
      state: input.showResetHostIdentity ? "danger" : "idle",
    },
  ];
}

function localNetworkCount(ips: string[]) {
  return new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".")).filter(Boolean)).size;
}
