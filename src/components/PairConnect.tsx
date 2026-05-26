import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Badge, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import { DeviceInfo, MdnsDevice, PairConnectSettings, RecentConnectEndpoint } from "../types";
import {
  endpointKey,
  recentConnectEndpointsFromDevices,
  reconnectEndpointWithCurrentPort,
  reconnectEndpointsAfterAdbRestart,
} from "../pairConnectEndpoints";
import ResultAlert from "./common/ResultAlert";

const REPAIR_ACTION_FAILURE_THRESHOLD = 2;
const RECENT_CONNECT_LIMIT = 5;

type EndpointProbeStatus = "idle" | "checking" | "reachable" | "unreachable";
type EndpointProbeStates = Record<string, EndpointProbeStatus>;

interface Props {
  devices: DeviceInfo[];
  onConnected: () => void | Promise<void>;
}

export default function PairConnect({ devices, onConnected }: Props) {
  const { t } = useTranslation();
  const adbOperationRef = useRef(false);
  const discoveringRef = useRef(false);
  const pairCodeInputFocusedRef = useRef(false);
  const pairConnectFailureCountRef = useRef(0);
  const [pairIp, setPairIp] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairResult, setPairResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [connectIp, setConnectIp] = useState("");
  const [connectPort, setConnectPort] = useState("");
  const [lastConnect, setLastConnect] = useState<{ ip: string; port: string } | null>(null);
  const [recentConnects, setRecentConnects] = useState<RecentConnectEndpoint[]>([]);
  const [endpointProbeStates, setEndpointProbeStates] = useState<EndpointProbeStates>({});
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectResult, setConnectResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [mdnsDevices, setMdnsDevices] = useState<MdnsDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [mdnsResult, setMdnsResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [repairingAdb, setRepairingAdb] = useState(false);
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [pairRepairVisible, setPairRepairVisible] = useState(false);
  const localIpsRef = useRef<string[]>([]);

  const updateLocalIps = useCallback((ips: string[]) => {
    const previousSignature = ipv4NetworkSignature(localIpsRef.current);
    const nextSignature = ipv4NetworkSignature(ips);
    localIpsRef.current = ips;
    setLocalIps(ips);
    if (previousSignature && previousSignature !== nextSignature) {
      setMdnsDevices((devices) => filterMdnsDevicesForLocalNetworks(devices, ips));
    }
  }, []);

  const refreshLocalIps = useCallback(async () => {
    try {
      const ips = await invoke<string[]>("get_local_ipv4_addresses");
      updateLocalIps(ips);
      return ips;
    } catch {
      return localIpsRef.current;
    }
  }, [updateLocalIps]);

  useEffect(() => {
    getStore()
      .then((store) => store.get<PairConnectSettings>(STORE_KEYS.pairConnect))
      .then((saved) => {
        if (!saved) return;
        setPairIp(saved.pairIp || "");
        setPairPort(saved.pairPort || "");
        setConnectIp(saved.connectIp || "");
        setConnectPort(saved.connectPort || "");
        const recent = normalizeRecentConnects(saved.recentConnects, saved.connectIp, saved.connectPort);
        setRecentConnects(recent);
        if (saved.connectIp && saved.connectPort) {
          setLastConnect({ ip: saved.connectIp, port: saved.connectPort });
        } else if (recent[0]) {
          setLastConnect({ ip: recent[0].ip, port: recent[0].port });
        }
      })
      .catch(() => {
        // Keep fields empty when local cache cannot be read.
      });
  }, []);

  useEffect(() => {
    refreshLocalIps();
    const timer = window.setInterval(() => {
      refreshLocalIps();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshLocalIps]);

  const savePairConnect = useCallback((next: Partial<PairConnectSettings>, recentOverride = recentConnects) => {
    const value: PairConnectSettings = {
      pairIp,
      pairPort,
      connectIp,
      connectPort,
      recentConnects: recentOverride,
      ...next,
    };
    saveStoreValue(STORE_KEYS.pairConnect, value).catch(() => {
      // Cache failure should not block ADB actions.
    });
  }, [connectIp, connectPort, pairIp, pairPort, recentConnects]);

  const rememberRecentConnect = useCallback((ip: string, port: string) => {
    const nextRecent = mergeRecentConnects(recentConnects, { ip, port, lastConnectedAt: Date.now() });
    setRecentConnects(nextRecent);
    setLastConnect({ ip, port });
    savePairConnect({ connectIp: ip, connectPort: port, recentConnects: nextRecent }, nextRecent);
  }, [recentConnects, savePairConnect]);

  useEffect(() => {
    const learnedEndpoints = recentConnectEndpointsFromDevices(devices, recentConnects);
    if (learnedEndpoints.length === 0) return;

    const primaryEndpoint = learnedEndpoints[0];
    const primaryKey = endpointKey(primaryEndpoint);
    const lastConnectKey = lastConnect ? endpointKey(lastConnect) : "";
    const knownKeys = new Set(recentConnects.map(endpointKey));
    const hasNewEndpoint = learnedEndpoints.some((endpoint) => !knownKeys.has(endpointKey(endpoint)));

    if (!hasNewEndpoint && lastConnectKey === primaryKey) return;

    const now = Date.now();
    let nextRecent = recentConnects;
    for (const [index, endpoint] of learnedEndpoints.entries()) {
      nextRecent = mergeRecentConnects(nextRecent, {
        ...endpoint,
        lastConnectedAt: hasNewEndpoint || lastConnectKey !== primaryKey
          ? now - index
          : endpoint.lastConnectedAt,
      });
    }

    if (recentConnectsEqual(nextRecent, recentConnects) && lastConnectKey === primaryKey) return;

    setRecentConnects(nextRecent);
    setLastConnect({ ip: primaryEndpoint.ip, port: primaryEndpoint.port });
    savePairConnect(
      { connectIp: primaryEndpoint.ip, connectPort: primaryEndpoint.port, recentConnects: nextRecent },
      nextRecent,
    );
  }, [devices, lastConnect, recentConnects, savePairConnect]);

  const fillConnectEndpoint = (ip: string, port: string) => {
    setConnectIp(ip);
    setConnectPort(port);
    setShowManual(true);
  };

  const handleConnectIpChange = (value: string) => {
    const endpoint = parseConnectEndpoint(value);
    if (endpoint) {
      fillConnectEndpoint(endpoint.ip, endpoint.port);
      return;
    }
    setConnectIp(value.trim());
  };

  const handleConnectPortChange = (value: string) => {
    const endpoint = parseConnectEndpoint(value);
    if (endpoint) {
      fillConnectEndpoint(endpoint.ip, endpoint.port);
      return;
    }
    setConnectPort(value.trim());
  };

  const runAdbOperation = useCallback(async <T,>(operation: () => Promise<T>) => {
    if (adbOperationRef.current) return null;
    adbOperationRef.current = true;
    try {
      return await operation();
    } finally {
      adbOperationRef.current = false;
    }
  }, []);

  const clearPairConnectFailures = useCallback(() => {
    pairConnectFailureCountRef.current = 0;
    setPairRepairVisible(false);
  }, []);

  const recordPairConnectFailure = useCallback(() => {
    pairConnectFailureCountRef.current += 1;
    if (pairConnectFailureCountRef.current >= REPAIR_ACTION_FAILURE_THRESHOLD) {
      setPairRepairVisible(true);
    }
  }, []);

  const probeRecentEndpoint = useCallback(async (endpoint: RecentConnectEndpoint) => {
    const key = endpointKey(endpoint);
    setEndpointProbeStates((current) => ({ ...current, [key]: "checking" }));
    try {
      const reachable = await invoke<boolean>("tcp_probe_endpoint", {
        ip: endpoint.ip,
        port: endpoint.port,
      });
      setEndpointProbeStates((current) => ({
        ...current,
        [key]: reachable ? "reachable" : "unreachable",
      }));
      return reachable;
    } catch {
      setEndpointProbeStates((current) => ({ ...current, [key]: "unreachable" }));
      return false;
    }
  }, []);

  const probeRecentConnects = useCallback(async () => {
    await Promise.all(recentConnects.map((endpoint) => probeRecentEndpoint(endpoint)));
  }, [probeRecentEndpoint, recentConnects]);

  const discoverMdns = useCallback(async (silent = false, force = false) => {
    if (!force && (discoveringRef.current || adbOperationRef.current || (silent && pairCodeInputFocusedRef.current))) {
      return;
    }
    discoveringRef.current = true;
    if (!silent) {
      setDiscovering(true);
      setMdnsResult(null);
      setPairRepairVisible(false);
    }
    try {
      const currentLocalIps = await refreshLocalIps();
      const devices = await invoke<MdnsDevice[]>("adb_mdns_discover");
      const visibleDevices = filterMdnsDevicesForLocalNetworks(devices, currentLocalIps);
      setMdnsDevices(visibleDevices);
      if (!silent) {
        setMdnsResult({ ok: true, msg: visibleDevices.length ? t('pairConnect.discovered', { count: visibleDevices.length }) : t('pairConnect.notDiscovered') });
      }
      if (visibleDevices.length === 0 && recentConnects.length > 0) {
        void probeRecentConnects();
      }
    } catch (e) {
      if (!silent) {
        setMdnsResult({ ok: false, msg: String(e) });
      }
    } finally {
      discoveringRef.current = false;
      if (!silent) setDiscovering(false);
    }
  }, [probeRecentConnects, recentConnects.length, refreshLocalIps, t]);

  useEffect(() => {
    discoverMdns(true);
    const timer = window.setInterval(() => {
      discoverMdns(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [discoverMdns]);

  const handleMdnsConnect = async (device: MdnsDevice) => {
    await runAdbOperation(async () => {
      setBusyAddress(device.address);
      setMdnsResult(null);
      setPairRepairVisible(false);
      try {
        const result = await invoke<string>("adb_auto_connect", {
          address: device.address,
        });
        setMdnsResult({ ok: true, msg: result });
        clearPairConnectFailures();
        rememberRecentConnect(device.ip, device.port);
        await onConnected();
      } catch (e) {
        recordPairConnectFailure();
        setMdnsResult({ ok: false, msg: `${String(e)}。${t('pairConnect.firstTimeHint')}` });
      } finally {
        setBusyAddress(null);
      }
    });
  };

  const handleMdnsPair = async (device: MdnsDevice) => {
    const code = pairCodes[device.address]?.trim();
    if (!code) return;
    await runAdbOperation(async () => {
      setBusyAddress(device.address);
      setMdnsResult(null);
      setPairRepairVisible(false);
      try {
        const result = await invoke<string>("adb_pair", {
          ip: device.ip,
          port: device.port,
          code,
        });
        setMdnsResult({ ok: true, msg: result });
        savePairConnect({ pairIp: device.ip, pairPort: device.port });
        setPairCodes((prev) => {
          const next = { ...prev };
          delete next[device.address];
          return next;
        });
        setMdnsDevices((prev) => prev.filter((item) => item.address !== device.address));
        clearPairConnectFailures();
        await discoverMdns(true, true);
        await onConnected();
      } catch (e) {
        recordPairConnectFailure();
        setMdnsResult({ ok: false, msg: String(e) });
      } finally {
        setBusyAddress(null);
      }
    });
  };

  const handleMdnsAutoConnect = async () => {
    await runAdbOperation(async () => {
      setBusyAddress("__auto__");
      setMdnsResult(null);
      setPairRepairVisible(false);
      try {
        const devices = await invoke<DeviceInfo[]>("adb_mdns_auto_connect");
        const onlineDevices = devices.filter((device) => device.state === "device");
        const count = onlineDevices.length;
        setMdnsResult({ ok: true, msg: count ? t('pairConnect.autoConnected', { count }) : t('pairConnect.autoConnectNone') });
        if (count === 0) setShowManual(true);
        if (count > 0) clearPairConnectFailures();
        await onConnected();
        await discoverMdns(true, true);
      } catch (e) {
        recordPairConnectFailure();
        setMdnsResult({ ok: false, msg: String(e) });
        setShowManual(true);
      } finally {
        setBusyAddress(null);
      }
    });
  };

  const handleRecentReconnect = async (endpoint: RecentConnectEndpoint, restartAdb = false) => {
    await runAdbOperation(async () => {
      const key = endpointKey(endpoint);
      const currentEndpoint = reconnectEndpointWithCurrentPort(endpoint, mdnsDevices, devices);
      const currentKey = endpointKey(currentEndpoint);
      setBusyAddress(restartAdb ? `__recent_repair__:${key}` : `__recent__:${key}`);
      setMdnsResult(null);
      setPairRepairVisible(false);
      try {
        const result = await invoke<string>("adb_reconnect_endpoint", {
          ip: currentEndpoint.ip,
          port: currentEndpoint.port,
          restartAdb,
        });
        setMdnsResult({ ok: true, msg: result });
        setEndpointProbeStates((current) => ({
          ...current,
          [key]: currentKey === key ? "reachable" : "unreachable",
          [currentKey]: "reachable",
        }));
        clearPairConnectFailures();
        rememberRecentConnect(currentEndpoint.ip, currentEndpoint.port);
        await onConnected();
        await discoverMdns(true, true);
      } catch (e) {
        recordPairConnectFailure();
        setEndpointProbeStates((current) => ({ ...current, [key]: "unreachable" }));
        setMdnsResult({
          ok: false,
          msg: restartAdb ? String(e) : `${String(e)}。${t('pairConnect.tryRestartReconnect')}`,
        });
        setShowManual(true);
      } finally {
        setBusyAddress(null);
      }
    });
  };

  const handleRestartAdbAndScan = async () => {
    await runAdbOperation(async () => {
      setBusyAddress("__repair__");
      setRepairingAdb(true);
      setDiscovering(true);
      setMdnsResult(null);
      setPairRepairVisible(false);
      try {
        const restartMessage = await invoke<string>("adb_restart_server");
        const currentLocalIps = await refreshLocalIps();
        const devices = await invoke<MdnsDevice[]>("adb_mdns_discover");
        const visibleDevices = filterMdnsDevicesForLocalNetworks(devices, currentLocalIps);
        setMdnsDevices(visibleDevices);
        const reconnectEndpoints = reconnectEndpointsAfterAdbRestart(recentConnects, visibleDevices);
        const reconnectedEndpoints: RecentConnectEndpoint[] = [];
        for (const endpoint of reconnectEndpoints) {
          const key = endpointKey(endpoint);
          try {
            await invoke<string>("adb_reconnect_endpoint", {
              ip: endpoint.ip,
              port: endpoint.port,
              restartAdb: false,
            });
            setEndpointProbeStates((current) => ({ ...current, [key]: "reachable" }));
            reconnectedEndpoints.push({ ...endpoint, lastConnectedAt: Date.now() });
          } catch {
            setEndpointProbeStates((current) => ({ ...current, [key]: "unreachable" }));
          }
        }
        if (reconnectedEndpoints.length > 0) {
          const nextRecent = dedupeRecentConnects([...reconnectedEndpoints, ...recentConnects]);
          const latest = reconnectedEndpoints[0];
          setRecentConnects(nextRecent);
          setLastConnect({ ip: latest.ip, port: latest.port });
          savePairConnect({ connectIp: latest.ip, connectPort: latest.port, recentConnects: nextRecent }, nextRecent);
        }
        const message = reconnectedEndpoints.length
          ? t('pairConnect.repairReconnected', { message: restartMessage, count: reconnectedEndpoints.length })
          : visibleDevices.length
            ? t('pairConnect.repairFound', { message: restartMessage, count: visibleDevices.length })
            : t('pairConnect.repairNoDevice', { message: restartMessage });
        setMdnsResult({
          ok: true,
          msg: message,
        });
        if (visibleDevices.length === 0 && reconnectedEndpoints.length === 0) setShowManual(true);
        clearPairConnectFailures();
        await onConnected();
      } catch (e) {
        setPairRepairVisible(true);
        setMdnsResult({ ok: false, msg: String(e) });
        setShowManual(true);
      } finally {
        setRepairingAdb(false);
        setDiscovering(false);
        setBusyAddress(null);
      }
    });
  };

  const handleScan = async () => {
    await runAdbOperation(async () => {
      setBusyAddress("__scan__");
      try {
        await discoverMdns(false, true);
        await onConnected();
      } finally {
        setBusyAddress(null);
      }
    });
  };

  const handlePair = async () => {
    const ip = pairIp.trim();
    const port = pairPort.trim();
    const code = pairCode.trim();
    if (!ip || !port || !code) return;
    await runAdbOperation(async () => {
      setPairLoading(true);
      setPairResult(null);
      setPairRepairVisible(false);
      try {
        const result = await invoke<string>("adb_pair", {
          ip,
          port,
          code,
        });
        setPairResult({ ok: true, msg: result });
        clearPairConnectFailures();
        savePairConnect({ pairIp: ip, pairPort: port });
        await discoverMdns(true, true);
      } catch (e) {
        recordPairConnectFailure();
        setPairResult({ ok: false, msg: String(e) });
      } finally {
        setPairLoading(false);
      }
    });
  };

  const handleConnect = async () => {
    const ip = connectIp.trim();
    const port = connectPort.trim();
    if (!ip || !port) return;
    await runAdbOperation(async () => {
      setConnectLoading(true);
      setConnectResult(null);
      setPairRepairVisible(false);
      try {
        const result = await invoke<string>("adb_connect", {
          ip,
          port,
        });
        setConnectResult({ ok: true, msg: result });
        clearPairConnectFailures();
        rememberRecentConnect(ip, port);
        await onConnected();
      } catch (e) {
        recordPairConnectFailure();
        setConnectResult({ ok: false, msg: String(e) });
      } finally {
        setConnectLoading(false);
      }
    });
  };

  const connectedDevices = devices.filter((device) => device.state === "device");
  const connectableDevices = mdnsDevices.filter((device) => device.connectable);
  const connectedDeviceKeys = new Set(connectedDevices.flatMap(deviceConnectionKeys));
  const mdnsDeviceKeys = new Set(
    mdnsDevices.map(mdnsDeviceKey).filter((key): key is string => Boolean(key))
  );
  const connectedLanDevices = connectedDevices
    .filter(isLanConnectedDevice)
    .filter((device) => !deviceConnectionKeys(device).some((key) => mdnsDeviceKeys.has(key)));
  const connectableDeviceKeys = new Set(connectableDevices.map(mdnsDeviceKey).filter(Boolean));
  const pairingDevices = mdnsDevices.filter((device) => {
    if (device.connectable) return false;
    const key = mdnsDeviceKey(device);
    return !key || (!connectableDeviceKeys.has(key) && !connectedDeviceKeys.has(key));
  });
  const adbBusy = busyAddress !== null || pairLoading || connectLoading || discovering || repairingAdb;

  return (
    <Stack maw={980} gap="md">
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-start" gap="md" mb="md">
          <div>
            <Text fw={700}>{t('pairConnect.lanDevices')}</Text>
            <Text size="xs" c="dimmed" mt={2}>{t('pairConnect.lanDevicesDesc')}</Text>
          </div>
          <Group gap="xs">
            <Button
              variant="light"
              onClick={handleScan}
              loading={discovering}
              disabled={adbBusy}
            >
              {t('pairConnect.scan')}
            </Button>
            <Button
              onClick={handleMdnsAutoConnect}
              loading={busyAddress === "__auto__"}
              disabled={adbBusy}
            >
              {t('pairConnect.autoConnect')}
            </Button>
          </Group>
        </Group>

        <div className="space-y-3">
          {connectedLanDevices.map((device) => (
            <ConnectedAdbDeviceRow
              key={device.serial}
              device={device}
            />
          ))}

          {connectableDevices.map((device) => (
            <MdnsRow
              key={`${device.service_name}-${device.address}`}
              device={device}
              busy={busyAddress === device.address}
              disabled={adbBusy}
              connected={isMdnsDeviceConnected(device, connectedDevices)}
              onConnect={() => handleMdnsConnect(device)}
            />
          ))}

          {pairingDevices.map((device) => (
            <MdnsPairRow
              key={`${device.service_name}-${device.address}`}
              device={device}
              busy={busyAddress === device.address}
              disabled={adbBusy}
              code={pairCodes[device.address] || ""}
              onCodeChange={(code) =>
                setPairCodes((prev) => ({
                  ...prev,
                  [device.address]: normalizePairCode(code),
                }))
              }
              onCodeFocus={() => {
                pairCodeInputFocusedRef.current = true;
              }}
              onCodeBlur={() => {
                pairCodeInputFocusedRef.current = false;
              }}
              onPair={() => handleMdnsPair(device)}
            />
          ))}

          {mdnsDevices.length === 0 && connectedLanDevices.length === 0 && (
            <>
              {recentConnects.length > 0 && (
                <RecentConnectFallback
                  endpoints={recentConnects}
                  probeStates={endpointProbeStates}
                  busyAddress={busyAddress}
                  disabled={adbBusy}
                  onProbe={probeRecentEndpoint}
                  onProbeAll={probeRecentConnects}
                  onReconnect={(endpoint) => handleRecentReconnect(endpoint, false)}
                  onRestartAndReconnect={(endpoint) => handleRecentReconnect(endpoint, true)}
                  onFill={(endpoint) => fillConnectEndpoint(endpoint.ip, endpoint.port)}
                />
              )}
              <ManualConnectHint
                lastConnect={lastConnect}
                localIps={localIps}
                repairing={repairingAdb}
                onFillLastConnect={() => {
                  if (lastConnect) fillConnectEndpoint(lastConnect.ip, lastConnect.port);
                }}
                onRestartAdbAndScan={handleRestartAdbAndScan}
                onShowManual={() => setShowManual(true)}
              />
            </>
          )}
        </div>

        {mdnsResult && (
          <ResultMessage result={mdnsResult}>
            {!mdnsResult.ok && pairRepairVisible && (
              <PairRepairAction
                repairing={repairingAdb}
                onRestartAdbAndScan={handleRestartAdbAndScan}
              />
            )}
          </ResultMessage>
        )}
      </Paper>

      <Paper withBorder radius="md" p="md">
        <button
          onClick={() => setShowManual((value) => !value)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="text-base font-semibold text-gray-800">{t('pairConnect.manualInput')}</span>
          <span className="text-sm text-gray-400">{showManual ? t('pairConnect.collapse') : t('pairConnect.expand')}</span>
        </button>

        {showManual && (
          <div className="mt-4 space-y-5">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">{t('pairConnect.pairDevice')}</h4>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Field label={t('pairConnect.ipAddress')} value={pairIp} onChange={setPairIp} placeholder="192.168.1.100" />
                <Field label={t('pairConnect.port')} value={pairPort} onChange={setPairPort} placeholder="12345" />
                <Field
                  label={t('pairConnect.pairCode')}
                  value={pairCode}
                  onChange={(value) => setPairCode(normalizePairCode(value))}
                  onFocus={() => {
                    pairCodeInputFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    pairCodeInputFocusedRef.current = false;
                  }}
                  placeholder="123456"
                  maxLength={8}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </div>
              <Button
                onClick={handlePair}
                disabled={adbBusy || !pairIp.trim() || !pairPort.trim() || !pairCode.trim()}
                loading={pairLoading}
              >
                {t('pairConnect.pair')}
              </Button>
              {pairResult && (
                <ResultMessage result={pairResult}>
                  {!pairResult.ok && pairRepairVisible && (
                    <PairRepairAction
                      repairing={repairingAdb}
                      onRestartAdbAndScan={handleRestartAdbAndScan}
                    />
                  )}
                </ResultMessage>
              )}
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{t('pairConnect.connectDevice')}</h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label={t('pairConnect.ipAddress')} value={connectIp} onChange={handleConnectIpChange} placeholder={t('pairConnect.connectIpPlaceholder')} />
                <Field label={t('pairConnect.port')} value={connectPort} onChange={handleConnectPortChange} placeholder={t('pairConnect.connectPortPlaceholder')} />
              </div>
              <Button
                onClick={handleConnect}
                disabled={adbBusy || !connectIp.trim() || !connectPort.trim()}
                loading={connectLoading}
              >
                {t('pairConnect.connect')}
              </Button>
              {connectResult && (
                <ResultMessage result={connectResult}>
                  {!connectResult.ok && pairRepairVisible && (
                    <PairRepairAction
                      repairing={repairingAdb}
                      onRestartAdbAndScan={handleRestartAdbAndScan}
                    />
                  )}
                </ResultMessage>
              )}
            </div>
          </div>
        )}
      </Paper>

      <Paper withBorder radius="md" p="md" bg="blue.0">
        <h3 className="text-base font-semibold text-blue-800 mb-2">{t('pairConnect.guide')}</h3>
        <div className="text-sm text-blue-700 space-y-3">
          <div>
            <h4 className="font-medium text-blue-800 mb-1">{t('pairConnect.howToGetPairCode')}</h4>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
              <li>{t('pairConnect.guideStep1')}</li>
              <li>{t('pairConnect.guideStep2')}</li>
              <li>{t('pairConnect.guideStep3')}</li>
              <li>{t('pairConnect.guideStep4')}</li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium text-blue-800 mb-1">{t('pairConnect.howToGetConnectAddr')}</h4>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
              <li>{t('pairConnect.guideConnectStep1')}</li>
              <li>{t('pairConnect.guideConnectStep2')}</li>
              <li>{t('pairConnect.guideConnectStep3')}</li>
            </ol>
          </div>
          <p className="text-xs text-blue-500">{t('pairConnect.guideTip')}</p>
        </div>
      </Paper>
    </Stack>
  );
}

function ManualConnectHint({
  lastConnect,
  localIps,
  repairing,
  onFillLastConnect,
  onRestartAdbAndScan,
  onShowManual,
}: {
  lastConnect: { ip: string; port: string } | null;
  localIps: string[];
  repairing: boolean;
  onFillLastConnect: () => void;
  onRestartAdbAndScan: () => void;
  onShowManual: () => void;
}) {
  const { t } = useTranslation();
  const hasMultipleLocalNetworks = new Set(localIps.map(ipv4NetworkPrefix)).size > 1;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-amber-900">{t('pairConnect.noDeviceHintTitle')}</div>
          <div className="mt-1 text-xs leading-5 text-amber-800">
            {t('pairConnect.noDeviceHintDesc')}
          </div>
          {hasMultipleLocalNetworks && (
            <div className="mt-2 rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-900">
              {t('pairConnect.multiNetworkHint', { ips: localIps.join(", ") })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRestartAdbAndScan}
            disabled={repairing}
            className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {repairing ? t('pairConnect.repairingAdb') : t('pairConnect.restartAdbAndScan')}
          </button>
          {lastConnect && (
            <button
              type="button"
              onClick={onFillLastConnect}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
            >
              {t('pairConnect.fillLastConnect')} {lastConnect.ip}:{lastConnect.port}
            </button>
          )}
          <button
            type="button"
            onClick={onShowManual}
            className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-700"
          >
            {t('pairConnect.showManualConnect')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentConnectFallback({
  endpoints,
  probeStates,
  busyAddress,
  disabled,
  onProbe,
  onProbeAll,
  onReconnect,
  onRestartAndReconnect,
  onFill,
}: {
  endpoints: RecentConnectEndpoint[];
  probeStates: EndpointProbeStates;
  busyAddress: string | null;
  disabled: boolean;
  onProbe: (endpoint: RecentConnectEndpoint) => void;
  onProbeAll: () => void;
  onReconnect: (endpoint: RecentConnectEndpoint) => void;
  onRestartAndReconnect: (endpoint: RecentConnectEndpoint) => void;
  onFill: (endpoint: RecentConnectEndpoint) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <Group justify="space-between" gap="md" align="flex-start" mb="sm">
        <div>
          <div className="text-sm font-medium text-blue-950">{t('pairConnect.recentConnectionsTitle')}</div>
          <div className="mt-1 text-xs leading-5 text-blue-800">{t('pairConnect.recentConnectionsDesc')}</div>
        </div>
        <Button variant="light" size="xs" disabled={disabled} onClick={onProbeAll}>
          {t('pairConnect.probeAllRecent')}
        </Button>
      </Group>

      <div className="space-y-2">
        {endpoints.map((endpoint) => {
          const key = endpointKey(endpoint);
          const status = probeStates[key] || "idle";
          const reconnectBusy = busyAddress === `__recent__:${key}`;
          const repairBusy = busyAddress === `__recent_repair__:${key}`;
          return (
            <div key={key} className="rounded-md border border-blue-100 bg-white px-3 py-2">
              <Group justify="space-between" gap="md" align="center" wrap="wrap">
                <div style={{ minWidth: 180, flex: "1 1 240px" }}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={700} truncate>
                      {key}
                    </Text>
                    <Badge color={probeBadgeColor(status)} size="sm" variant="light">
                      {t(`pairConnect.probeStatus.${status}`)}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    {t('pairConnect.lastConnectedAt', { time: formatEndpointTime(endpoint.lastConnectedAt) })}
                  </Text>
                </div>
                <Group gap="xs" justify="flex-end" wrap="wrap" style={{ flex: "1 1 320px" }}>
                  <Button
                    size="xs"
                    variant="light"
                    loading={status === "checking"}
                    disabled={disabled}
                    onClick={() => onProbe(endpoint)}
                  >
                    {t('pairConnect.probeRecent')}
                  </Button>
                  <Button
                    size="xs"
                    loading={reconnectBusy}
                    disabled={disabled}
                    onClick={() => onReconnect(endpoint)}
                  >
                    {t('pairConnect.reconnectRecent')}
                  </Button>
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    loading={repairBusy}
                    disabled={disabled}
                    onClick={() => onRestartAndReconnect(endpoint)}
                  >
                    {t('pairConnect.restartAdbAndReconnect')}
                  </Button>
                  <Button size="xs" variant="subtle" disabled={disabled} onClick={() => onFill(endpoint)}>
                    {t('pairConnect.fill')}
                  </Button>
                </Group>
              </Group>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function probeBadgeColor(status: EndpointProbeStatus) {
  if (status === "reachable") return "green";
  if (status === "unreachable") return "red";
  if (status === "checking") return "blue";
  return "gray";
}

function ipv4NetworkPrefix(ip: string) {
  return ip.split(".").slice(0, 3).join(".");
}

function ipv4NetworkSignature(ips: string[]) {
  return Array.from(new Set(ips.map(ipv4NetworkPrefix).filter(Boolean))).sort().join("|");
}

function filterMdnsDevicesForLocalNetworks(devices: MdnsDevice[], localIps: string[]) {
  const localNetworks = new Set(localIps.map(ipv4NetworkPrefix).filter(Boolean));
  if (localNetworks.size === 0) return devices;
  return devices.filter((device) => localNetworks.has(ipv4NetworkPrefix(device.ip)));
}

function MdnsRow({
  device,
  busy,
  disabled,
  connected,
  onConnect,
}: {
  device: MdnsDevice;
  busy: boolean;
  disabled: boolean;
  connected: boolean;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="md" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {device.service_name}
            </Text>
            <Badge color="green" size="sm" variant="light">
              {t('pairConnect.connectable')}
            </Badge>
            <Badge color={connected ? "blue" : "gray"} size="sm" variant="light">
              {connected ? t('pairConnect.connected') : t('pairConnect.notConnected')}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4} truncate>
          {device.address} · {device.service_type}
          </Text>
        </div>
        <Button size="sm" loading={busy} disabled={disabled || connected} onClick={onConnect}>
          {connected ? t('pairConnect.connected') : t('pairConnect.oneClickConnect')}
        </Button>
      </Group>
    </Paper>
  );
}

function ConnectedAdbDeviceRow({ device }: { device: DeviceInfo }) {
  const { t } = useTranslation();
  const title = device.device_sn || device.model || device.serial;
  const subtitle = [device.serial, device.model && device.model !== title ? device.model : "", device.product]
    .filter(Boolean)
    .join(" · ");

  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="md" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {title}
            </Text>
            <Badge color="blue" size="sm" variant="light">
              {t('pairConnect.connected')}
            </Badge>
            <Badge color="gray" size="sm" variant="light">
              {t('pairConnect.adbConnected')}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4} truncate>
            {subtitle}
          </Text>
        </div>
      </Group>
    </Paper>
  );
}

function isMdnsDeviceConnected(device: MdnsDevice, connectedDevices: DeviceInfo[]) {
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

function isLanConnectedDevice(device: DeviceInfo) {
  return device.connection_type === "wireless" || /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(device.serial);
}

function mdnsDeviceKey(device: MdnsDevice) {
  return device.service_name.match(/^adb-([^-]+)-/)?.[1] || null;
}

function deviceConnectionKeys(device: DeviceInfo) {
  return [device.device_sn, device.serial.match(/^adb-([^-]+)-/)?.[1] || ""].filter(Boolean);
}

function MdnsPairRow({
  device,
  busy,
  disabled,
  code,
  onCodeChange,
  onCodeFocus,
  onCodeBlur,
  onPair,
}: {
  device: MdnsDevice;
  busy: boolean;
  disabled: boolean;
  code: string;
  onCodeChange: (code: string) => void;
  onCodeFocus: () => void;
  onCodeBlur: () => void;
  onPair: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="md" align="flex-end">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {device.service_name}
            </Text>
            <Badge color="yellow" size="sm" variant="light">
              {t('pairConnect.needPair')}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4} truncate>
            {device.address} · {device.service_type}
          </Text>
        </div>
        <Group gap="xs" align="flex-end">
          <TextInput
            value={code}
            onChange={(event) => onCodeChange(event.currentTarget.value)}
            onFocus={onCodeFocus}
            onBlur={onCodeBlur}
            placeholder={t('pairConnect.pairCode')}
            maxLength={8}
            inputMode="numeric"
            autoComplete="one-time-code"
            w={116}
          />
          <Button
            onClick={onPair}
            loading={busy}
            disabled={disabled || !code.trim()}
          >
            {t('pairConnect.pair')}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}

function Field({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  maxLength,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder: string;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
}) {
  return (
    <TextInput
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      autoComplete={autoComplete}
    />
  );
}

function normalizePairCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function parseConnectEndpoint(value: string) {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*:\s*(\d{1,5})$/);
  if (!match) return null;
  const [, ip, port] = match;
  const octets = ip.split(".").map(Number);
  const portNumber = Number(port);
  if (octets.some((octet) => octet < 0 || octet > 255) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  return { ip, port };
}

function normalizeRecentConnects(
  endpoints: RecentConnectEndpoint[] | undefined,
  legacyIp?: string,
  legacyPort?: string
) {
  const now = Date.now();
  const normalized = (endpoints || [])
    .map((endpoint) => ({
      ip: endpoint.ip.trim(),
      port: endpoint.port.trim(),
      lastConnectedAt: Number(endpoint.lastConnectedAt) || now,
    }))
    .filter((endpoint) => parseConnectEndpoint(endpointKey(endpoint)));

  if (legacyIp && legacyPort && parseConnectEndpoint(`${legacyIp}:${legacyPort}`)) {
    normalized.push({
      ip: legacyIp.trim(),
      port: legacyPort.trim(),
      lastConnectedAt: now,
    });
  }

  return dedupeRecentConnects(normalized);
}

function mergeRecentConnects(current: RecentConnectEndpoint[], endpoint: RecentConnectEndpoint) {
  const endpointIp = endpoint.ip.trim();
  return dedupeRecentConnects([
    endpoint,
    ...current.filter((item) => item.ip.trim() !== endpointIp || item.port.trim() === endpoint.port.trim()),
  ]);
}

function dedupeRecentConnects(endpoints: RecentConnectEndpoint[]) {
  const seen = new Set<string>();
  return endpoints
    .sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
    .filter((endpoint) => {
      const key = endpointKey(endpoint);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RECENT_CONNECT_LIMIT);
}

function recentConnectsEqual(a: RecentConnectEndpoint[], b: RecentConnectEndpoint[]) {
  if (a.length !== b.length) return false;
  return a.every((endpoint, index) => {
    const other = b[index];
    return other && endpointKey(endpoint) === endpointKey(other) && endpoint.lastConnectedAt === other.lastConnectedAt;
  });
}

function formatEndpointTime(timestamp: number) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

function PairRepairAction({
  repairing,
  onRestartAdbAndScan,
}: {
  repairing: boolean;
  onRestartAdbAndScan: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      onClick={onRestartAdbAndScan}
      loading={repairing}
      mt="sm"
      size="xs"
      color="red"
    >
      {t('pairConnect.restartAdbAndScan')}
    </Button>
  );
}

function ResultMessage({
  result,
  children,
}: {
  result: { ok: boolean; msg: string };
  children?: ReactNode;
}) {
  return (
    <ResultAlert result={result} className="mt-3">
      {children}
    </ResultAlert>
  );
}
