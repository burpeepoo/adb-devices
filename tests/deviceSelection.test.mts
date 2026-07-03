import assert from "node:assert/strict";
import test from "node:test";
import {
  isExecutableAdbSerial,
  preferDeviceForIdentity,
  resolveVisibleSelectedDevice,
} from "../src/deviceSelection.ts";
import type { DeviceInfo } from "../src/types/index.ts";

const ipTransport = device({
  serial: "192.168.110.111:36887",
  device_sn: "LCVC100003C",
});
const mdnsTransport = device({
  serial: "adb-LCVC100003C-TRxUr5._adb-tls-connect._tcp",
  device_sn: "LCVC100003C",
});
const otherDevice = device({
  serial: "adb-NCRC10008CC-nbaOti._adb-tls-connect._tcp",
  device_sn: "NCRC10008CC",
});

test("maps a selected duplicate transport to the visible merged device row", () => {
  const selected = resolveVisibleSelectedDevice("192.168.110.111:36887", [ipTransport, mdnsTransport, otherDevice], [
    mdnsTransport,
    otherDevice,
  ]);

  assert.equal(selected, "adb-LCVC100003C-TRxUr5._adb-tls-connect._tcp");
});

test("selects the first visible online device when the selected transport is gone", () => {
  const selected = resolveVisibleSelectedDevice("192.168.110.131:40913", [ipTransport, mdnsTransport], [
    mdnsTransport,
  ]);

  assert.equal(selected, "adb-LCVC100003C-TRxUr5._adb-tls-connect._tcp");
});

test("returns null when no visible device is online", () => {
  const selected = resolveVisibleSelectedDevice("192.168.110.111:36887", [ipTransport], [
    { ...ipTransport, state: "disconnected" },
  ]);

  assert.equal(selected, null);
});

test("prefers executable adb transport over mdns service serial for the same device", () => {
  assert.equal(isExecutableAdbSerial("192.168.110.111:36887"), true);
  assert.equal(isExecutableAdbSerial("adb-LCVC100003C-TRxUr5._adb-tls-connect._tcp"), false);
  assert.equal(preferDeviceForIdentity(mdnsTransport, ipTransport).serial, "192.168.110.111:36887");
  assert.equal(preferDeviceForIdentity(ipTransport, mdnsTransport).serial, "192.168.110.111:36887");
});

function device(overrides: Pick<DeviceInfo, "serial" | "device_sn">): DeviceInfo {
  return {
    serial: overrides.serial,
    device_sn: overrides.device_sn,
    state: "device",
    model: "CD_8V545F0",
    product: "Calendar3_32",
    connection_type: "wireless",
  };
}
