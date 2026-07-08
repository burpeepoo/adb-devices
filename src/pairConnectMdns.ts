import type { DeviceInfo, MdnsDevice, RecentConnectEndpoint } from "./types";

export interface UnpairedMdnsDevice {
  connectDevice: MdnsDevice;
  pairingDevice?: MdnsDevice;
}

export interface MdnsPairingViewModel {
  trustedConnectDevices: MdnsDevice[];
  unpairedConnectDevices: UnpairedMdnsDevice[];
  pairingDevices: MdnsDevice[];
}

export function buildMdnsPairingViewModel(
  mdnsDevices: MdnsDevice[],
  connectedDevices: DeviceInfo[],
  recentConnects: RecentConnectEndpoint[],
): MdnsPairingViewModel {
  const connectDevices = mdnsDevices.filter((device) => device.connectable);
  const discoveredPairingDevices = mdnsDevices.filter((device) => !device.connectable);
  const connectedDeviceKeys = new Set(connectedDevices.flatMap(deviceConnectionKeys));
  const recentIps = new Set(recentConnects.map((endpoint) => endpoint.ip));

  const trustedConnectDevices: MdnsDevice[] = [];
  const unpairedConnectDevices: UnpairedMdnsDevice[] = [];

  for (const device of connectDevices) {
    const pairedOnThisComputer = isMdnsDeviceConnected(device, connectedDevices) || recentIps.has(device.ip);
    if (pairedOnThisComputer) {
      trustedConnectDevices.push(device);
      continue;
    }
    unpairedConnectDevices.push({
      connectDevice: device,
      pairingDevice: findPairingDeviceForConnectService(device, discoveredPairingDevices),
    });
  }

  const displayedConnectDevices = [...trustedConnectDevices, ...unpairedConnectDevices.map((item) => item.connectDevice)];
  const pairingDevices = discoveredPairingDevices.filter((device) => {
    const key = mdnsDeviceKey(device);
    if (key && connectedDeviceKeys.has(key)) return false;
    return !displayedConnectDevices.some((connectDevice) => isSameMdnsDevice(connectDevice, device));
  });

  return { trustedConnectDevices, unpairedConnectDevices, pairingDevices };
}

export function isMdnsDeviceConnected(device: MdnsDevice, connectedDevices: DeviceInfo[]) {
  const key = mdnsDeviceKey(device);
  return connectedDevices.some((connectedDevice) => {
    const serial = connectedDevice.serial;
    return (
      (key && deviceConnectionKeys(connectedDevice).includes(key)) ||
      serial === device.address ||
      serial === device.service_name ||
      serial.startsWith(`${device.service_name}.`) ||
      serial.includes(device.address)
    );
  });
}

export function mdnsDeviceKey(device: MdnsDevice) {
  return device.service_name.match(/^adb-([^-]+)-/)?.[1] || null;
}

export function deviceConnectionKeys(device: DeviceInfo) {
  return [device.device_sn, device.serial.match(/^adb-([^-]+)-/)?.[1] || ""].filter(Boolean);
}

function findPairingDeviceForConnectService(device: MdnsDevice, pairingDevices: MdnsDevice[]) {
  return pairingDevices.find((pairingDevice) => isSameMdnsDevice(device, pairingDevice));
}

function isSameMdnsDevice(left: MdnsDevice, right: MdnsDevice) {
  const leftKey = mdnsDeviceKey(left);
  const rightKey = mdnsDeviceKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey) || left.ip === right.ip;
}
