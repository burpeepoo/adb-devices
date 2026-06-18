import assert from "node:assert/strict";
import test from "node:test";
import { buildDeviceTargetState, deviceTargetResultSuffix } from "../src/deviceTarget.ts";
import type { DeviceInfo } from "../src/types/index.ts";

test("marks the selected online device as ready with stable identity and note", () => {
  const target = buildDeviceTargetState(
    [device({ serial: "192.168.110.111:36887", device_sn: "LCVC100003C" })],
    "192.168.110.111:36887",
    { LCVC100003C: "QA left shelf" },
  );

  assert.equal(target.status, "ready");
  assert.equal(target.serial, "192.168.110.111:36887");
  assert.equal(target.identity, "LCVC100003C");
  assert.equal(target.label, "QA left shelf");
  assert.equal(target.blockReason, null);
  assert.equal(deviceTargetResultSuffix(target, "Device"), "Device: QA left shelf (LCVC100003C)");
});

test("blocks device actions when no online device is selected", () => {
  const target = buildDeviceTargetState([device({ serial: "USB123" }), device({ serial: "USB456" })], null, {});

  assert.equal(target.status, "no-selection");
  assert.equal(target.serial, null);
  assert.equal(target.onlineDeviceCount, 2);
  assert.equal(target.blockReason, "select-online-device");
});

test("blocks device actions when the selected row is not online", () => {
  const target = buildDeviceTargetState(
    [device({ serial: "USB123", state: "disconnected" }), device({ serial: "USB456" })],
    "USB123",
    {},
  );

  assert.equal(target.status, "selected-unavailable");
  assert.equal(target.serial, null);
  assert.equal(target.selectedDeviceState, "disconnected");
  assert.equal(target.blockReason, "selected-device-not-online");
});

function device(overrides: Partial<DeviceInfo> & Pick<DeviceInfo, "serial">): DeviceInfo {
  return {
    serial: overrides.serial,
    device_sn: overrides.device_sn || "",
    state: overrides.state || "device",
    model: overrides.model || "CD_8V545F0",
    product: overrides.product || "Calendar3_32",
    connection_type: overrides.connection_type || "wireless",
  };
}
