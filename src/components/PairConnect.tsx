import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import { DeviceInfo, MdnsDevice, PairConnectSettings } from "../types";

interface Props {
  devices: DeviceInfo[];
  onConnected: () => void | Promise<void>;
}

export default function PairConnect({ devices, onConnected }: Props) {
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
        setMdnsResult({ ok: true, msg: devices.length ? `发现 ${devices.length} 个局域网 ADB 服务` : "未发现局域网 ADB 服务" });
      }
    } catch (e) {
      if (!silent) {
        setMdnsResult({ ok: false, msg: String(e) });
      }
    } finally {
      discoveringRef.current = false;
      if (!silent) setDiscovering(false);
    }
  }, []);

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
        await onConnected();
      } catch (e) {
        setMdnsResult({ ok: false, msg: `${String(e)}。如果这是第一次连接这台设备，请先在 Android 无线调试里打开配对码并完成配对。` });
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
        setMdnsResult({ ok: true, msg: count ? `已自动连接 ${count} 台在线设备` : "已尝试自动连接，暂未发现在线设备" });
        await onConnected();
        await discoverMdns(true, true);
      } catch (e) {
        setMdnsResult({ ok: false, msg: String(e) });
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
        await onConnected();
      } catch (e) {
        setConnectResult({ ok: false, msg: String(e) });
      } finally {
        setConnectLoading(false);
      }
    });
  };

  const connectableDevices = mdnsDevices.filter((device) => device.connectable);
  const pairingDevices = mdnsDevices.filter((device) => !device.connectable);
  const connectedDevices = devices.filter((device) => device.state === "device");
  const adbBusy = busyAddress !== null || pairLoading || connectLoading || discovering;

  return (
    <div className="max-w-3xl space-y-5">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">局域网设备</h3>
            <p className="text-xs text-gray-400 mt-1">自动扫描 mDNS 发现的 Android 无线调试设备</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleScan}
              disabled={adbBusy}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {discovering ? "扫描中..." : "扫描"}
            </button>
            <button
              onClick={handleMdnsAutoConnect}
              disabled={adbBusy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyAddress === "__auto__" ? "连接中..." : "自动连接可信设备"}
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
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
              未发现局域网 ADB 服务
            </div>
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
          <span className="text-base font-semibold text-gray-800">手动输入</span>
          <span className="text-sm text-gray-400">{showManual ? "收起" : "展开"}</span>
        </button>

        {showManual && (
          <div className="mt-4 space-y-5">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">配对设备</h4>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Field label="IP 地址" value={pairIp} onChange={setPairIp} placeholder="192.168.1.100" />
                <Field label="端口" value={pairPort} onChange={setPairPort} placeholder="12345" />
                <Field
                  label="配对码"
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
                {pairLoading ? "配对中..." : "配对"}
              </button>
              {pairResult && (
                <ResultMessage result={pairResult} />
              )}
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h4 className="text-sm font-medium text-gray-700 mb-3">连接设备</h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="IP 地址" value={connectIp} onChange={setConnectIp} placeholder="192.168.1.100" />
                <Field label="端口" value={connectPort} onChange={setConnectPort} placeholder="无线调试页面显示的端口" />
              </div>
              <button
                onClick={handleConnect}
                disabled={adbBusy || !connectIp.trim() || !connectPort.trim()}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {connectLoading ? "连接中..." : "连接"}
              </button>
              {connectResult && (
                <ResultMessage result={connectResult} />
              )}
            </div>
          </div>
        )}
      </section>

      <section className="bg-blue-50 rounded-lg border border-blue-200 p-5">
        <h3 className="text-base font-semibold text-blue-800 mb-2">使用指引</h3>
        <div className="text-sm text-blue-700 space-y-3">
          <div>
            <h4 className="font-medium text-blue-800 mb-1">如何获取配对码</h4>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
              <li>在 Android 设备上打开 <strong>设置 → 开发者选项 → 无线调试</strong></li>
              <li>开启无线调试开关</li>
              <li>点击 <strong>使用配对码配对设备</strong></li>
              <li>屏幕会显示 6 位配对码和配对端口号，将它们填入上方配对区域</li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium text-blue-800 mb-1">如何获取连接 IP 和端口</h4>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
              <li>在 Android 设备上打开 <strong>设置 → 开发者选项 → 无线调试</strong></li>
              <li>页面中显示的 <strong>IP 地址和端口</strong> 即为连接地址（注意：此端口与配对端口不同）</li>
              <li>将 IP 和端口填入上方连接区域即可</li>
            </ol>
          </div>
          <p className="text-xs text-blue-500">提示：配对只需一次，后续连接无需重复配对。局域网扫描会自动发现设备并填入对应地址。若无法扫描到该设备，请确保 Android 设备已打开开发者选项中的「无线调试」功能，并尝试切换 Wi-Fi 后重新扫描。</p>
        </div>
      </section>
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
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 truncate">{device.service_name}</span>
          <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">可连接</span>
          <span className={`rounded px-2 py-0.5 text-xs ${connected ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
            {connected ? "已连接" : "未连接"}
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
        {connected ? "已连接" : busy ? "连接中..." : "一键连接"}
      </button>
    </div>
  );
}

function isMdnsDeviceConnected(device: MdnsDevice, connectedDevices: DeviceInfo[]) {
  return connectedDevices.some((connectedDevice) => {
    const serial = connectedDevice.serial;
    return (
      serial === device.address ||
      serial === device.service_name ||
      serial.startsWith(`${device.service_name}.`) ||
      serial.includes(device.address)
    );
  });
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
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{device.service_name}</span>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">需要配对</span>
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
            placeholder="配对码"
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
            {busy ? "配对中..." : "配对"}
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

function ResultMessage({ result }: { result: { ok: boolean; msg: string } }) {
  return (
    <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
      {result.msg}
    </div>
  );
}
