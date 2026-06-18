import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteSafetySummary } from "../src/remoteSafety.ts";

test("summarizes remote role sessions and control ownership", () => {
  const summary = buildRemoteSafetySummary({
    enabled: true,
    addresses: [
      { kind: "localhost", label: "Localhost", host: "127.0.0.1", url: "http://127.0.0.1:3210/remote" },
      { kind: "lan", label: "LAN", host: "192.168.110.20", url: "http://192.168.110.20:3210/remote" },
    ],
    sessions: [
      { id: "viewer-1", role: "viewer", client_name: "Phone", connected_at_ms: 1, last_seen_ms: 2 },
      { id: "operator-1", role: "operator", client_name: "Support", connected_at_ms: 1, last_seen_ms: 2 },
    ],
    trusted_devices: [],
    control_owner: { session_id: "operator-1", role: "operator", acquired_at_ms: 3 },
    stream_defaults: { fps: 12, jpeg_quality: 75, max_width: 1080 },
  });

  assert.equal(summary.networkExposure, "lan");
  assert.deepEqual(summary.roleCounts, { viewer: 1, operator: 1, admin: 0 });
  assert.equal(summary.controlOwnerLabel, "Support");
  assert.equal(summary.streamLabel, "12 fps · 1080px");
});

test("reports trusted device expiry pressure", () => {
  const summary = buildRemoteSafetySummary({
    enabled: true,
    addresses: [],
    sessions: [],
    trusted_devices: [
      {
        id: "trusted-1",
        role: "admin",
        client_name: "Admin browser",
        created_at_ms: 0,
        expires_at_ms: 1_700_003_600_000,
        last_seen_ms: 1,
      },
    ],
    control_owner: { session_id: null, role: null, acquired_at_ms: null },
    stream_defaults: null,
    nowMs: 1_700_000_000_000,
  });

  assert.equal(summary.trustedDeviceCount, 1);
  assert.equal(summary.expiringTrustedDeviceCount, 1);
});
