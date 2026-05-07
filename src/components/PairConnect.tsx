import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import { DeviceInfo, MdnsDevice, PairConnectSettings } from "../types";

interface Props {
  devices: DeviceInfo[];
  onConnected: () => void | Promise<void>;
}

export default function PairConnect({ devices, onConnected }: Props) {
  const { t } = useTranslation();
  const adbOperationRef = useRef(false);
  const discoveringRef = useRef(false);
  const pairCodeInputFocusedRef = useRef(false);
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

  const discoverMdns = useCallback(async (silent = false, force = false) => {
    if (!force && (discoveringRef.current || adbOperationRef.current || (silent && pairCodeInputFocusedRef.current))) {
      return;
    }
    discoveringRef.current = true;
    if (!silent) {
      setDiscovering(true);
      setMdnsResult(null);
    }
    try {
      const devices = await invoke<MdnsDevice[]>("adb_mdns_discover");
      setMdnsDevices(devices);
      if (!silent) {
        setMdnsResult({ ok: true, msg: devices.length ? t('pairConnect.discovered', { count: devices.length }) : t('pairConnect.notDiscovered') });
      }
    } catch (e) {
      if (!silent) {
        setMdnsResult({ ok: false, msg: String(e) });
      }
    } finally {
      discoveringRef.current = false;
      if (!silent) setDiscovering(false);
    }
  }, [t]);

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
      try {
        const result = await invoke<string>("adb_auto_connect", {
          address: device.address,
        });
        setMdnsResult({ ok: true, msg: result });
        savePairConnect({ connectIp: device.ip, connectPort: device.port });
        setLastConnect({ ip: device.ip, port: device.port });
        await onConnected();
      } catch (e) {
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
        await discoverMdns(true, true);
        await onConnected();
      } catch (e) {
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
      try {
        const devices = await invoke<DeviceInfo[]>("adb_mdns_auto_connect");
        const onlineDevices = devices.filter((device) => device.state === "device");
        const count = onlineDevices.length;
        setMdnsResult({ ok: true, msg: count ? t('pairConnect.autoConnected', { count }) : t('pairConnect.autoConnectNone') });
        if (count === 0) setShowManual(true);
        await onConnected();
        await discoverMdns(true, true);
      } catch (e) {
        setMdnsResult({ ok: false, msg: String(e) });
        setShowManual(true);
      } finally {
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
      try {
        const result = await invoke<string>("adb_pair", {
          ip,
          port,
          code,
        });
        setPairResult({ ok: true, msg: result });
        savePairConnect({ pairIp: ip, pairPort: port });
        await discoverMdns(true, true);
      } catch (e) {
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
      try {
        const result = await invoke<string>("adb_connect", {
          ip,
          port,
        });
        setConnectResult({ ok: true, msg: result });
        savePairConnect({ connectIp: ip, connectPort: port });
        setLastConnect({ ip, port });
        await onConnected();
      } catch (e) {
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
  const adbBusy = busyAddress !== null || pairLoading || connectLoading || discovering;

  return (
    <div className="max-w-3xl space-y-5">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">{t('pairConnect.lanDevices')}</h3>
            <p className="text-xs text-gray-400 mt-1">{t('pairConnect.lanDevicesDesc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleScan}
              disabled={adbBusy}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {discovering ? t('pairConnect.scanning') : t('pairConnect.scan')}
            </button>
            <button
              onClick={handleMdnsAutoConnect}
              disabled={adbBusy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyAddress === "__auto__" ? t('pairConnect.connecting') : t('pairConnect.autoConnect')}
            </button>
          </div>
        </div>

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
              onFillLastConnect={() => {
                if (lastConnect) fillConnectEndpoint(lastConnect.ip, lastConnect.port);
              }}
              onShowManual={() => setShowManual(true)}
            />
          )}
        </div>

        {mdnsResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${mdnsResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {mdnsResult.msg}
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5">
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
              <button
                onClick={handlePair}
                disabled={adbBusy || !pairIp.trim() || !pairPort.trim() || !pairCode.trim()}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pairLoading ? t('pairConnect.pairing') : t('pairConnect.pair')}
              </button>
              {pairResult && (
                <ResultMessage result={pairResult} />
              )}
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{t('pairConnect.connectDevice')}</h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label={t('pairConnect.ipAddress')} value={connectIp} onChange={handleConnectIpChange} placeholder={t('pairConnect.connectIpPlaceholder')} />
                <Field label={t('pairConnect.port')} value={connectPort} onChange={handleConnectPortChange} placeholder={t('pairConnect.connectPortPlaceholder')} />
              </div>
              <button
                onClick={handleConnect}
                disabled={adbBusy || !connectIp.trim() || !connectPort.trim()}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {connectLoading ? t('pairConnect.connecting') : t('pairConnect.connect')}
              </button>
              {connectResult && (
                <ResultMessage result={connectResult} />
              )}
            </div>
          </div>
        )}
      </section>

      <section className="bg-blue-50 rounded-lg border border-blue-200 p-5">
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
      </section>
    </div>
  );
}

function ManualConnectHint({
  lastConnect,
  onFillLastConnect,
  onShowManual,
}: {
  lastConnect: { ip: string; port: string } | null;
  onFillLastConnect: () => void;
  onShowManual: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-amber-900">{t('pairConnect.noDeviceHintTitle')}</div>
          <div className="mt-1 text-xs leading-5 text-amber-800">
            {t('pairConnect.noDeviceHintDesc')}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 truncate">{device.service_name}</span>
          <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">{t('pairConnect.connectable')}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${connected ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
            {connected ? t('pairConnect.connected') : t('pairConnect.notConnected')}
          </span>
        </div>
        <div className="mt-1 text-xs text-gray-400">
          {device.address} · {device.service_type}
        </div>
      </div>
      <button
        onClick={onConnect}
        disabled={disabled || connected}
        className="shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {connected ? t('pairConnect.connected') : busy ? t('pairConnect.connecting') : t('pairConnect.oneClickConnect')}
      </button>
    </div>
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
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{device.service_name}</span>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{t('pairConnect.needPair')}</span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {device.address} · {device.service_type}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            onFocus={onCodeFocus}
            onBlur={onCodeBlur}
            placeholder={t('pairConnect.pairCode')}
            maxLength={8}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <button
            onClick={onPair}
            disabled={disabled || !code.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? t('pairConnect.pairing') : t('pairConnect.pair')}
          </button>
        </div>
      </div>
    </div>
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
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
    </div>
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

function ResultMessage({ result }: { result: { ok: boolean; msg: string } }) {
  return (
    <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
      {result.msg}
    </div>
  );
}
