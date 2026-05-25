import type { MdnsDevice, RecentConnectEndpoint } from "./types";

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
