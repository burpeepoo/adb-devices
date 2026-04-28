import { DeviceInfo } from "../types";

interface Props {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  selectedDevice: string | null;
  onSelectDevice: (serial: string) => void;
  onRefresh: () => void;
}

export default function DeviceList({
  devices,
  loading,
  error,
  selectedDevice,
  onSelectDevice,
  onRefresh,
}: Props) {
  const onlineDevices = devices.filter((d) => d.state === "device");
  const offlineDevices = devices.filter((d) => d.state !== "device");
  const connectionLabel = (type: DeviceInfo["connection_type"]) =>
    type === "wireless" ? "无线" : "有线";
  const connectionClass = (type: DeviceInfo["connection_type"]) =>
    type === "wireless" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600";

  return (
    <aside className="w-72 border-r border-gray-200 bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">设备列表</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-50"
          title="刷新"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-600 bg-red-50">{error}</div>
      )}

      {/* Online devices */}
      {onlineDevices.length > 0 && (
        <div className="px-3 pt-2 pb-1">
          <span className="text-xs text-gray-400 font-medium">在线 ({onlineDevices.length})</span>
        </div>
      )}
      {onlineDevices.map((device) => (
        <button
          key={device.serial}
          onClick={() => onSelectDevice(device.serial)}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-100 transition-colors ${
            selectedDevice === device.serial ? "bg-blue-50 border-l-2 border-blue-500" : "border-l-2 border-transparent"
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm text-gray-800 truncate">{device.model || device.serial}</div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${connectionClass(device.connection_type)}`}>
                {connectionLabel(device.connection_type)}
              </span>
            </div>
            <div className="text-xs text-gray-400 truncate">{device.serial}</div>
          </div>
        </button>
      ))}

      {/* Offline devices */}
      {offlineDevices.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <span className="text-xs text-gray-400 font-medium">离线 ({offlineDevices.length})</span>
          </div>
          {offlineDevices.map((device) => (
            <button
              key={device.serial}
              onClick={() => onSelectDevice(device.serial)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-100 transition-colors opacity-60 ${
                selectedDevice === device.serial ? "bg-blue-50 border-l-2 border-blue-500" : "border-l-2 border-transparent"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-gray-800 truncate">{device.model || device.serial}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${connectionClass(device.connection_type)}`}>
                    {connectionLabel(device.connection_type)}
                  </span>
                </div>
                <div className="text-xs text-gray-400 truncate">{device.serial}</div>
              </div>
            </button>
          ))}
        </>
      )}

      {devices.length === 0 && !loading && (
        <div className="px-3 py-4 text-center text-sm text-gray-400">
          暂无设备<br />请先配对连接
        </div>
      )}
    </aside>
  );
}
