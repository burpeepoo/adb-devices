import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Badge, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import { DeviceInfo, MdnsDevice, PairConnectSettings } from "../types";
import ResultAlert from "./common/ResultAlert";

const REPAIR_ACTION_FAILURE_THRESHOLD = 2;

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
        if (saved.connectIp && saved.connectPort) {
          setLastConnect({ ip: saved.connectIp, port: saved.connectPort });
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

  const savePairConnect = (next: Partial<PairConnectSettings>) => {
    const value: PairConnectSettings = {
      pairIp,
      pairPort,
      connectIp,
      connectPort,
      ...next,
    };
    saveStoreValue(STORE_KEYS.pairConnect, value).catch(() => {
      // Cache failure should not block ADB actions.
    });
  };

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
    } catch (e) {
      if (!silent) {
        setMdnsResult({ ok: false, msg: String(e) });
      }
    } finally {
      discoveringRef.current = false;
      if (!silent) setDiscovering(false);
    }
  }, [refreshLocalIps, t]);

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
        savePairConnect({ connectIp: device.ip, connectPort: device.port });
        setLastConnect({ ip: device.ip, port: device.port });
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
        setMdnsResult({
          ok: true,
          msg: visibleDevices.length
            ? t('pairConnect.repairFound', { message: restartMessage, count: visibleDevices.length })
            : t('pairConnect.repairNoDevice', { message: restartMessage }),
        });
        if (visibleDevices.length === 0) setShowManual(true);
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
        savePairConnect({ connectIp: ip, connectPort: port });
        setLastConnect({ ip, port });
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

          {mdnsDevices.length === 0 && (
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
