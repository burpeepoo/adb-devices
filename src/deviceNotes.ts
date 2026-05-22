import type { DeviceInfo } from "./types";

export type DeviceNotes = Record<string, string>;

export function deviceIdentityKey(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}

export function setDeviceNote(
  notes: DeviceNotes,
  device: Pick<DeviceInfo, "serial" | "device_sn">,
  note: string,
): DeviceNotes {
  const key = deviceIdentityKey(device);
  const trimmed = note.trim();
  const next = { ...notes };

  if (trimmed) {
    next[key] = trimmed;
  } else {
    delete next[key];
  }

  return next;
}
