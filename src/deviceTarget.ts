import { deviceIdentityKey, type DeviceNotes } from "./deviceNotes.ts";
import type { DeviceInfo } from "./types/index.ts";

export type DeviceTargetStatus = "ready" | "no-selection" | "selected-unavailable";
export type DeviceTargetBlockReason = "select-online-device" | "selected-device-not-online";

export interface DeviceTargetState {
  status: DeviceTargetStatus;
  blockReason: DeviceTargetBlockReason | null;
  selectedSerial: string | null;
  serial: string | null;
  device: DeviceInfo | null;
  identity: string;
  label: string;
  note: string;
  model: string;
  product: string;
  connectionType: DeviceInfo["connection_type"] | null;
  selectedDeviceState: DeviceInfo["state"] | null;
  onlineDeviceCount: number;
}

export function buildDeviceTargetState(
  devices: DeviceInfo[],
  selectedSerial: string | null,
  deviceNotes: DeviceNotes,
): DeviceTargetState {
  const onlineDevices = devices.filter((device) => device.state === "device");
  const selectedDevice = selectedSerial ? devices.find((device) => device.serial === selectedSerial) || null : null;
  const readyDevice = selectedDevice?.state === "device" ? selectedDevice : null;

  if (!readyDevice) {
    return {
      status: selectedSerial ? "selected-unavailable" : "no-selection",
      blockReason: selectedSerial ? "selected-device-not-online" : "select-online-device",
      selectedSerial,
      serial: null,
      device: selectedDevice,
      identity: selectedDevice ? deviceIdentityKey(selectedDevice) : "",
      label: selectedDevice ? deviceLabel(selectedDevice, deviceNotes) : "",
      note: selectedDevice ? deviceNotes[deviceIdentityKey(selectedDevice)]?.trim() || "" : "",
      model: selectedDevice?.model || "",
      product: selectedDevice?.product || "",
      connectionType: selectedDevice?.connection_type || null,
      selectedDeviceState: selectedDevice?.state || null,
      onlineDeviceCount: onlineDevices.length,
    };
  }

  const identity = deviceIdentityKey(readyDevice);
  const note = deviceNotes[identity]?.trim() || "";
  return {
    status: "ready",
    blockReason: null,
    selectedSerial,
    serial: readyDevice.serial,
    device: readyDevice,
    identity,
    label: note || identity,
    note,
    model: readyDevice.model,
    product: readyDevice.product,
    connectionType: readyDevice.connection_type,
    selectedDeviceState: readyDevice.state,
    onlineDeviceCount: onlineDevices.length,
  };
}

export function deviceTargetResultSuffix(target: DeviceTargetState, label: string) {
  if (target.status !== "ready") return "";
  const identity = target.identity && target.identity !== target.label ? ` (${target.identity})` : "";
  return `${label}: ${target.label}${identity}`;
}

function deviceLabel(device: DeviceInfo, deviceNotes: DeviceNotes) {
  const identity = deviceIdentityKey(device);
  return deviceNotes[identity]?.trim() || identity;
}
