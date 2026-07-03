import type { DeviceInfo } from "./types";
import { deviceIdentityKey } from "./deviceNotes.ts";

export function resolveVisibleSelectedDevice(
  selectedSerial: string | null,
  onlineDevices: DeviceInfo[],
  visibleDevices: DeviceInfo[],
) {
  const visibleOnlineDevices = visibleDevices.filter((device) => device.state === "device");
  const firstVisibleOnline = visibleOnlineDevices[0]?.serial || null;

  if (!selectedSerial) return firstVisibleOnline;

  const selectedVisible = visibleOnlineDevices.some((device) => device.serial === selectedSerial);
  if (selectedVisible) return selectedSerial;

  const selectedOnline = onlineDevices.find(
    (device) => device.state === "device" && device.serial === selectedSerial,
  );
  if (!selectedOnline) return firstVisibleOnline;

  const selectedIdentity = deviceIdentityKey(selectedOnline);
  const visibleMatch = visibleOnlineDevices.find((device) => deviceIdentityKey(device) === selectedIdentity);

  return visibleMatch?.serial || firstVisibleOnline;
}

export function preferDeviceForIdentity(existing: DeviceInfo | undefined, candidate: DeviceInfo) {
  if (!existing) return candidate;

  if (candidate.state === "device" && existing.state !== "device") return candidate;
  if (existing.state === "device" && candidate.state !== "device") return existing;

  if (candidate.state === "device" && existing.state === "device") {
    const candidateExecutable = isExecutableAdbSerial(candidate.serial);
    const existingExecutable = isExecutableAdbSerial(existing.serial);
    if (candidateExecutable && !existingExecutable) return candidate;
    if (existingExecutable && !candidateExecutable) return existing;
  }

  return candidate;
}

export function isExecutableAdbSerial(serial: string) {
  return !/^adb-[^-]+-.+\._adb-tls-connect\._tcp$/.test(serial);
}
