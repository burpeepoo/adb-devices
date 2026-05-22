import assert from "node:assert/strict";
import test from "node:test";
import { deviceIdentityKey, setDeviceNote } from "../src/deviceNotes.ts";

test("uses device SN as the stable note key when available", () => {
  assert.equal(deviceIdentityKey({ serial: "192.168.1.20:37123", device_sn: "NCRC10008CC" }), "NCRC10008CC");
  assert.equal(deviceIdentityKey({ serial: "emulator-5554", device_sn: "" }), "emulator-5554");
});

test("saves trimmed notes without mutating the previous map", () => {
  const current = { "old-device": "Kitchen display" };
  const next = setDeviceNote(current, { serial: "adb-123", device_sn: "NCRC10008CC" }, "  Lab tablet  ");

  assert.deepEqual(current, { "old-device": "Kitchen display" });
  assert.deepEqual(next, {
    "old-device": "Kitchen display",
    NCRC10008CC: "Lab tablet",
  });
});

test("removes blank notes from the map", () => {
  const next = setDeviceNote(
    { NCRC10008CC: "Lab tablet", "old-device": "Kitchen display" },
    { serial: "adb-123", device_sn: "NCRC10008CC" },
    "   ",
  );

  assert.deepEqual(next, { "old-device": "Kitchen display" });
});
