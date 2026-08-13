import type { DeviceInfo, MdnsDevice, RecentConnectEndpoint } from "./types";

export function reconnectEndpointsAfterAdbRestart(
  recentConnects: RecentConnectEndpoint[],
  mdnsDevices: MdnsDevice[],
) {
  const currentConnectPortByIp = new Map(
    mdnsDevices
      .filter((device) => device.connectable)
      .map((device) => [device.ip.trim(), device.port.trim()]),
  );

  const seen = new Set<string>();
  const endpoints: RecentConnectEndpoint[] = [];

  for (const endpoint of recentConnects) {
    const ip = endpoint.ip.trim();
    const port = currentConnectPortByIp.get(ip) || endpoint.port.trim();
    const key = `${ip}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({ ...endpoint, ip, port });
  }

  return endpoints;
}

export function reconnectCandidatesWithCurrentEndpoint(
  recentConnects: RecentConnectEndpoint[],
  currentIp: string,
  currentPort: string,
  now = Date.now(),
) {
  const current = parseAdbIpEndpoint(`${currentIp.trim()}:${currentPort.trim()}`);
  if (!current) return recentConnects;

  const currentKey = endpointKey(current);
  return [
    { ...current, lastConnectedAt: now },
    ...recentConnects.filter((endpoint) => endpointKey(endpoint) !== currentKey),
  ];
}

export function reconnectEndpointWithCurrentPort(
  endpoint: RecentConnectEndpoint,
  mdnsDevices: MdnsDevice[],
  devices: DeviceInfo[],
) {
  const ip = endpoint.ip.trim();
  const currentConnectedPort = devices
    .filter((device) => device.state === "device")
    .map((device) => parseAdbIpEndpoint(device.serial))
    .find((currentEndpoint) => currentEndpoint?.ip === ip)?.port;
  const currentMdnsPort = mdnsDevices
    .filter((device) => device.connectable)
    .find((device) => device.ip.trim() === ip)?.port.trim();

  return {
    ...endpoint,
    ip,
    port: currentConnectedPort || currentMdnsPort || endpoint.port.trim(),
  };
}

export function recentConnectEndpointsFromDevices(
  devices: DeviceInfo[],
  knownEndpoints: RecentConnectEndpoint[],
  now = Date.now(),
) {
  const knownByKey = new Map(
    knownEndpoints.map((endpoint) => [endpointKey(endpoint), endpoint]),
  );
  const seen = new Set<string>();
  const endpoints: RecentConnectEndpoint[] = [];

  for (const device of devices) {
    if (device.state !== "device") continue;
    const parsed = parseAdbIpEndpoint(device.serial);
    if (!parsed) continue;
    const key = endpointKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({
      ...parsed,
      lastConnectedAt: knownByKey.get(key)?.lastConnectedAt || now,
    });
  }

  return endpoints;
}

export function endpointKey(endpoint: Pick<RecentConnectEndpoint, "ip" | "port">) {
  return `${endpoint.ip.trim()}:${endpoint.port.trim()}`;
}

function parseAdbIpEndpoint(serial: string) {
  const match = serial.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!match) return null;
  const [, ip, port] = match;
  const octets = ip.split(".").map(Number);
  const portNumber = Number(port);
  if (octets.some((octet) => octet < 0 || octet > 255) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  return { ip, port };
}
