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
  const connectDevices = dedupeConnectDevices(
    mdnsDevices.filter((device) => device.connectable),
    connectedDevices,
    recentConnects,
  );
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

interface RankedMdnsDevice {
  device: MdnsDevice;
  orderIndex: number;
  score: number;
}

function dedupeConnectDevices(
  connectDevices: MdnsDevice[],
  connectedDevices: DeviceInfo[],
  recentConnects: RecentConnectEndpoint[],
) {
  const groupedDevices = new Map<string, RankedMdnsDevice>();

  connectDevices.forEach((device, index) => {
    const groupKey = mdnsDeviceGroupKey(device);
    const candidate: RankedMdnsDevice = {
      device,
      orderIndex: index,
      score: mdnsConnectDeviceScore(device, connectedDevices, recentConnects),
    };
    const existing = groupedDevices.get(groupKey);

    if (!existing) {
      groupedDevices.set(groupKey, candidate);
      return;
    }

    if (candidate.score > existing.score) {
      groupedDevices.set(groupKey, { ...candidate, orderIndex: existing.orderIndex });
    }
  });

  return [...groupedDevices.values()]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((rankedDevice) => rankedDevice.device);
}

function mdnsDeviceGroupKey(device: MdnsDevice) {
  const key = mdnsDeviceKey(device);
  return key ? `device:${key}` : `ip:${device.ip}`;
}

function mdnsConnectDeviceScore(
  device: MdnsDevice,
  connectedDevices: DeviceInfo[],
  recentConnects: RecentConnectEndpoint[],
) {
  if (isExactConnectedMdnsDevice(device, connectedDevices)) {
    return 40;
  }
  if (recentConnects.some((endpoint) => endpoint.ip === device.ip && endpoint.port === device.port)) {
    return 30;
  }
  if (isMdnsDeviceConnected(device, connectedDevices)) {
    return 20;
  }
  if (recentConnects.some((endpoint) => endpoint.ip === device.ip)) {
    return 10;
  }
  return 0;
}

function isExactConnectedMdnsDevice(device: MdnsDevice, connectedDevices: DeviceInfo[]) {
  return connectedDevices.some((connectedDevice) => {
    const serial = connectedDevice.serial;
    return (
      serial === device.address ||
      serial.includes(device.address) ||
      serial === device.service_name ||
      serial.startsWith(`${device.service_name}.`)
    );
  });
}

function findPairingDeviceForConnectService(device: MdnsDevice, pairingDevices: MdnsDevice[]) {
  return pairingDevices.find((pairingDevice) => isSameMdnsDevice(device, pairingDevice));
}

function isSameMdnsDevice(left: MdnsDevice, right: MdnsDevice) {
  const leftKey = mdnsDeviceKey(left);
  const rightKey = mdnsDeviceKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey) || left.ip === right.ip;
}
