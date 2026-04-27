import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onConnected: () => void;
}

export default function PairConnect({ onConnected }: Props) {
  // Pair state
  const [pairIp, setPairIp] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairResult, setPairResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Connect state
  const [connectIp, setConnectIp] = useState("");
  const [connectPort, setConnectPort] = useState("5555");
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectResult, setConnectResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handlePair = async () => {
    if (!pairIp || !pairPort || !pairCode) return;
    setPairLoading(true);
    setPairResult(null);
    try {
      const result = await invoke<string>("adb_pair", {
        ip: pairIp,
        port: pairPort,
        code: pairCode,
      });
      setPairResult({ ok: true, msg: result });
    } catch (e) {
      setPairResult({ ok: false, msg: String(e) });
    } finally {
      setPairLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!connectIp || !connectPort) return;
    setConnectLoading(true);
    setConnectResult(null);
    try {
      const result = await invoke<string>("adb_connect", {
        ip: connectIp,
        port: connectPort,
      });
      setConnectResult({ ok: true, msg: result });
      onConnected();
    } catch (e) {
      setConnectResult({ ok: false, msg: String(e) });
    } finally {
      setConnectLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* Pair section */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-3">配对设备</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">IP 地址</label>
            <input
              type="text"
              value={pairIp}
              onChange={(e) => setPairIp(e.target.value)}
              placeholder="192.168.1.100"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">端口</label>
            <input
              type="text"
              value={pairPort}
              onChange={(e) => setPairPort(e.target.value)}
              placeholder="12345"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">配对码</label>
            <input
              type="text"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="123456"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        <button
          onClick={handlePair}
          disabled={pairLoading || !pairIp || !pairPort || !pairCode}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pairLoading ? "配对中..." : "配对"}
        </button>
        {pairResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${pairResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {pairResult.msg}
          </div>
        )}
      </section>

      {/* Connect section */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-3">连接设备</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">IP 地址</label>
            <input
              type="text"
              value={connectIp}
              onChange={(e) => setConnectIp(e.target.value)}
              placeholder="192.168.1.100"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">端口</label>
            <input
              type="text"
              value={connectPort}
              onChange={(e) => setConnectPort(e.target.value)}
              placeholder="5555"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleConnect}
          disabled={connectLoading || !connectIp || !connectPort}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {connectLoading ? "连接中..." : "连接"}
        </button>
        {connectResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${connectResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {connectResult.msg}
          </div>
        )}
      </section>

      {/* Guide */}
      <section className="bg-blue-50 rounded-lg border border-blue-200 p-5">
        <h3 className="text-base font-semibold text-blue-800 mb-2">使用指引</h3>
        <ul className="text-sm text-blue-700 space-y-1.5">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">1.</span>
            <span>在 Android 设备上打开: <strong>设置 → 开发者选项 → 无线调试</strong></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">2.</span>
            <span>点击 <strong>"配对设备"</strong>，查看配对 IP 地址、端口和配对码</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">3.</span>
            <span>在上方"配对设备"区域输入配对 IP、端口和配对码，点击配对</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">4.</span>
            <span>配对成功后，在"连接设备"区域输入 <strong>WiFi IP 地址</strong>（设置 → 网络 → WiFi）和端口（默认 <strong>5555</strong>），点击连接</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">5.</span>
            <span>注意: <strong>配对端口</strong>和<strong>连接端口</strong>通常不同！配对端口在配对对话框中显示，连接端口在无线调试页面显示</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
