import assert from "node:assert/strict";
import test from "node:test";
import { reconnectEndpointsAfterAdbRestart } from "../src/pairConnectEndpoints.ts";
import type { MdnsDevice, RecentConnectEndpoint } from "../src/types/index.ts";

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

function recent(ip: string, port: string): RecentConnectEndpoint {
  return { ip, port, lastConnectedAt: 1000 };
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
