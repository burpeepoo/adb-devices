import assert from "node:assert/strict";
import test from "node:test";
import { buildMdnsPairingViewModel } from "../src/pairConnectMdns.ts";
import type { DeviceInfo, MdnsDevice, RecentConnectEndpoint } from "../src/types/index.ts";

test("connect mDNS service without local pairing history asks for pairing first", () => {
  const view = buildMdnsPairingViewModel(
    [mdns("adb-NCRN100025C-MLkb4g", "_adb-tls-connect._tcp", "192.168.110.253", "45277", true)],
    [],
    [],
  );

  assert.deepEqual(view.trustedConnectDevices, []);
  assert.equal(view.unpairedConnectDevices.length, 1);
  assert.equal(view.unpairedConnectDevices[0].connectDevice.address, "192.168.110.253:45277");
  assert.equal(view.unpairedConnectDevices[0].pairingDevice, undefined);
  assert.deepEqual(view.pairingDevices, []);
});

test("connect mDNS service with recent history remains a direct reconnect candidate", () => {
  const connectService = mdns("adb-NCRN100025C-MLkb4g", "_adb-tls-connect._tcp", "192.168.110.253", "45277", true);
  const view = buildMdnsPairingViewModel([connectService], [], [recent("192.168.110.253", "41145")]);

  assert.deepEqual(view.trustedConnectDevices, [connectService]);
  assert.deepEqual(view.unpairedConnectDevices, []);
});

test("unpaired connect service adopts discovered pairing port from the same device", () => {
  const connectService = mdns("adb-NCRN100025C-MLkb4g", "_adb-tls-connect._tcp", "192.168.110.253", "45277", true);
  const pairingService = mdns("adb-NCRN100025C-pair", "_adb-tls-pairing._tcp", "192.168.110.253", "45741", false);
  const view = buildMdnsPairingViewModel([connectService, pairingService], [], []);

  assert.equal(view.unpairedConnectDevices.length, 1);
  assert.deepEqual(view.unpairedConnectDevices[0].pairingDevice, pairingService);
  assert.deepEqual(view.pairingDevices, []);
});

test("currently connected mDNS service is not shown as first-time pairing", () => {
  const connectService = mdns("adb-NCRC10008CC-ALDBGe", "_adb-tls-connect._tcp", "192.168.110.35", "34263", true);
  const view = buildMdnsPairingViewModel(
    [connectService],
    [device("adb-NCRC10008CC-ALDBGe._adb-tls-connect._tcp", "NCRC10008CC")],
    [],
  );

  assert.deepEqual(view.trustedConnectDevices, [connectService]);
  assert.deepEqual(view.unpairedConnectDevices, []);
});

test("duplicate connect services for one physical device collapse to the connected endpoint", () => {
  const staleService = mdns("adb-NCRN100025C-MLkb4g", "_adb-tls-connect._tcp", "192.168.110.253", "36233", true);
  const currentService = mdns(
    "adb-NCRN100025C-MLkb4g (2)",
    "_adb-tls-connect._tcp",
    "192.168.110.253",
    "44691",
    true,
  );
  const view = buildMdnsPairingViewModel(
    [staleService, currentService],
    [device("192.168.110.253:44691", "NCRN100025C")],
    [],
  );

  assert.deepEqual(view.trustedConnectDevices, [currentService]);
  assert.deepEqual(view.unpairedConnectDevices, []);
});

test("duplicate unpaired connect services ask for pairing only once", () => {
  const firstService = mdns("adb-NCRN100025C-MLkb4g", "_adb-tls-connect._tcp", "192.168.110.253", "36233", true);
  const duplicateService = mdns(
    "adb-NCRN100025C-MLkb4g (2)",
    "_adb-tls-connect._tcp",
    "192.168.110.253",
    "44691",
    true,
  );
  const view = buildMdnsPairingViewModel([firstService, duplicateService], [], []);

  assert.deepEqual(view.trustedConnectDevices, []);
  assert.equal(view.unpairedConnectDevices.length, 1);
  assert.deepEqual(view.unpairedConnectDevices[0].connectDevice, firstService);
});

function recent(ip: string, port: string): RecentConnectEndpoint {
  return { ip, port, lastConnectedAt: 1000 };
}

function mdns(serviceName: string, serviceType: string, ip: string, port: string, connectable: boolean): MdnsDevice {
  return {
    service_name: serviceName,
    service_type: serviceType,
    ip,
    port,
    address: `${ip}:${port}`,
    connectable,
  };
}

function device(serial: string, deviceSn: string): DeviceInfo {
  return {
    serial,
    device_sn: deviceSn,
    state: "device",
    model: "",
    product: "",
    connection_type: "wireless",
  };
}
