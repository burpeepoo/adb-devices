export type RemoteRole = "viewer" | "operator" | "admin";
export type RemoteAddressKind = "tailscale" | "lan" | "localhost";

export interface RemoteAddressSummaryInput {
  kind: RemoteAddressKind;
  label: string;
  host: string;
  url: string;
}

export interface RemoteSessionSummaryInput {
  id: string;
  role: RemoteRole;
  client_name: string;
  connected_at_ms: number;
  last_seen_ms: number;
}

export interface RemoteTrustedDeviceSummaryInput {
  id: string;
  role: RemoteRole;
  client_name: string;
  created_at_ms: number;
  expires_at_ms: number;
  last_seen_ms: number;
}

export interface RemoteControlOwnerSummaryInput {
  session_id: string | null;
  role: RemoteRole | null;
  acquired_at_ms: number | null;
}

export interface RemoteStreamDefaultsSummaryInput {
  fps: number;
  jpeg_quality: number;
  max_width: number;
}

export interface RemoteSafetySummaryInput {
  enabled: boolean;
  addresses: RemoteAddressSummaryInput[];
  sessions: RemoteSessionSummaryInput[];
  trusted_devices: RemoteTrustedDeviceSummaryInput[];
  control_owner: RemoteControlOwnerSummaryInput;
  stream_defaults: RemoteStreamDefaultsSummaryInput | null;
  nowMs?: number;
}

export interface RemoteSafetySummary {
  networkExposure: RemoteAddressKind | "off";
  roleCounts: Record<RemoteRole, number>;
  controlOwnerLabel: string;
  trustedDeviceCount: number;
  expiringTrustedDeviceCount: number;
  streamLabel: string;
}

const TRUST_EXPIRY_SOON_MS = 6 * 60 * 60 * 1000;

export function buildRemoteSafetySummary(input: RemoteSafetySummaryInput): RemoteSafetySummary {
  const roleCounts: Record<RemoteRole, number> = { viewer: 0, operator: 0, admin: 0 };
  for (const session of input.sessions) roleCounts[session.role] += 1;

  const ownerSession = input.sessions.find((session) => session.id === input.control_owner.session_id);
  const networkExposure = input.enabled ? strongestAddressKind(input.addresses) : "off";
  const nowMs = input.nowMs ?? Date.now();

  return {
    networkExposure,
    roleCounts,
    controlOwnerLabel: ownerSession?.client_name || "",
    trustedDeviceCount: input.trusted_devices.length,
    expiringTrustedDeviceCount: input.trusted_devices.filter(
      (device) => device.expires_at_ms - nowMs <= TRUST_EXPIRY_SOON_MS,
    ).length,
    streamLabel: input.stream_defaults ? `${input.stream_defaults.fps} fps · ${input.stream_defaults.max_width}px` : "",
  };
}

function strongestAddressKind(addresses: RemoteAddressSummaryInput[]): RemoteAddressKind {
  if (addresses.some((address) => address.kind === "tailscale")) return "tailscale";
  if (addresses.some((address) => address.kind === "lan")) return "lan";
  return "localhost";
}
