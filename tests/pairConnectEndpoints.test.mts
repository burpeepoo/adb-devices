import assert from "node:assert/strict";
import test from "node:test";
import {
  recentConnectEndpointsFromDevices,
  reconnectCandidatesWithCurrentEndpoint,
  reconnectEndpointWithCurrentPort,
  reconnectEndpointsAfterAdbRestart,
} from "../src/pairConnectEndpoints.ts";
import type { DeviceInfo, MdnsDevice, RecentConnectEndpoint } from "../src/types/index.ts";

test("uses the current mDNS port for a recent endpoint on the same IP", () => {
  const endpoints = reconnectEndpointsAfterAdbRestart(
    [recent("192.168.110.111", "38733")],
    [mdns("adb-LCVC100003C-TRxUr5", "192.168.110.111", "36887")],
  );

  assert.deepEqual(endpoints, [recent("192.168.110.111", "36887")]);
});

test("keeps recent endpoints when mDNS does not discover a replacement port", () => {
  const endpoints = reconnectEndpointsAfterAdbRestart(
    [recent("192.168.110.111", "36887")],
    [mdns("adb-NCRC10008CC-nbaOti", "192.168.110.131", "40913")],
  );

  assert.deepEqual(endpoints, [recent("192.168.110.111", "36887")]);
});

test("deduplicates endpoints after mDNS port replacement", () => {
  const endpoints = reconnectEndpointsAfterAdbRestart(
    [recent("192.168.110.111", "36887"), recent("192.168.110.111", "38733")],
    [mdns("adb-LCVC100003C-TRxUr5", "192.168.110.111", "36887")],
  );

  assert.deepEqual(endpoints, [recent("192.168.110.111", "36887")]);
});

test("retries the valid current manual endpoint even before it enters recent history", () => {
  const candidates = reconnectCandidatesWithCurrentEndpoint(
    [recent("192.168.110.111", "36887")],
    " 10.0.0.200 ",
    " 46829 ",
    2000,
  );

  assert.deepEqual(candidates, [
    recent("10.0.0.200", "46829", 2000),
    recent("192.168.110.111", "36887"),
  ]);
});

test("does not add an invalid current manual endpoint to restart candidates", () => {
  const recentEndpoints = [recent("192.168.110.111", "36887")];

  assert.deepEqual(
    reconnectCandidatesWithCurrentEndpoint(recentEndpoints, "10.0.0.999", "46829"),
    recentEndpoints,
  );
});

test("single reconnect uses the currently connected port for the same IP", () => {
  const endpoint = reconnectEndpointWithCurrentPort(
    recent("192.168.110.131", "38733"),
    [],
    [device("192.168.110.131:42933", "device")],
  );

  assert.deepEqual(endpoint, recent("192.168.110.131", "42933"));
});

test("single reconnect falls back to the current mDNS port for the same IP", () => {
  const endpoint = reconnectEndpointWithCurrentPort(
    recent("192.168.110.111", "38733"),
    [mdns("adb-LCVC100003C-TRxUr5", "192.168.110.111", "36887")],
    [],
  );

  assert.deepEqual(endpoint, recent("192.168.110.111", "36887"));
});

test("learns recent endpoints from connected wireless devices", () => {
  const endpoints = recentConnectEndpointsFromDevices(
    [
      device("192.168.110.131:42933", "device"),
      device("192.168.110.131:38733", "offline"),
      device("USB123", "device"),
    ],
    [],
    2000,
  );

  assert.deepEqual(endpoints, [recent("192.168.110.131", "42933", 2000)]);
});

test("keeps existing timestamps when learning an already-known connected endpoint", () => {
  const endpoints = recentConnectEndpointsFromDevices(
    [device("192.168.110.131:42933", "device")],
    [recent("192.168.110.131", "42933", 1000)],
    2000,
  );

  assert.deepEqual(endpoints, [recent("192.168.110.131", "42933", 1000)]);
});

function recent(ip: string, port: string, lastConnectedAt = 1000): RecentConnectEndpoint {
  return { ip, port, lastConnectedAt };
}

function mdns(serviceName: string, ip: string, port: string): MdnsDevice {
  return {
    service_name: serviceName,
    service_type: "_adb-tls-connect._tcp",
    ip,
    port,
    address: `${ip}:${port}`,
    connectable: true,
  };
}

function device(serial: string, state: DeviceInfo["state"]): DeviceInfo {
  return {
    serial,
    device_sn: "",
    state,
    model: "",
    product: "",
    connection_type: serial.includes(":") ? "wireless" : "usb",
  };
}
