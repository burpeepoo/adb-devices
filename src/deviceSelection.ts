import type { DeviceInfo } from "./types";

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

function deviceIdentityKey(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}
