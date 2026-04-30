import { useEffect, useState } from "react";
import { DeviceInfo } from "../types";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";

interface Props {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  selectedDevice: string | null;
  mirroringDeviceSerial: string | null;
  onSelectDevice: (serial: string) => void;
  onRefresh: () => void;
}

type DeviceNotes = Record<string, string>;

export default function DeviceList({
  devices,
  loading,
  error,
  selectedDevice,
  mirroringDeviceSerial,
  onSelectDevice,
  onRefresh,
}: Props) {
  const [deviceNotes, setDeviceNotes] = useState<DeviceNotes>({});
  const onlineDevices = devices.filter((d) => d.state === "device");
  const offlineDevices = devices.filter((d) => d.state !== "device");

  useEffect(() => {
    getStore()
      .then((store) => store.get<DeviceNotes>(STORE_KEYS.deviceNotes))
      .then((saved) => {
        setDeviceNotes(saved || {});
      })
      .catch(() => {
        // Device notes are optional metadata.
      });
  }, []);

  const handleNoteChange = (device: DeviceInfo, note: string) => {
    const key = deviceIdentityKey(device);
    setDeviceNotes((prev) => {
      const next = { ...prev, [key]: note };
      saveStoreValue(STORE_KEYS.deviceNotes, next).catch(() => {
        // Notes are local-only convenience data; keep the UI responsive if saving fails.
      });
      return next;
    });
  };

  return (
    <aside className="w-72 border-r border-gray-200 bg-gray-50 flex flex-col">
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

      <div className="flex-1 overflow-y-auto min-h-0">
        {onlineDevices.length > 0 && (
          <div className="px-3 pt-2 pb-1 sticky top-0 bg-gray-50 z-10">
            <span className="text-xs text-gray-400 font-medium">在线 ({onlineDevices.length})</span>
          </div>
        )}
        {onlineDevices.map((device) => (
          <DeviceRow
            key={device.serial}
            device={device}
            note={deviceNotes[deviceIdentityKey(device)] || ""}
            selected={selectedDevice === device.serial}
            mirroring={mirroringDeviceSerial === device.serial}
            online
            onSelect={() => onSelectDevice(device.serial)}
            onNoteChange={(note) => handleNoteChange(device, note)}
          />
        ))}

        {offlineDevices.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <span className="text-xs text-gray-400 font-medium">离线 ({offlineDevices.length})</span>
            </div>
            {offlineDevices.map((device) => (
              <DeviceRow
                key={device.serial}
                device={device}
                note={deviceNotes[deviceIdentityKey(device)] || ""}
                selected={false}
                mirroring={false}
                online={false}
                onSelect={undefined}
                onNoteChange={(note) => handleNoteChange(device, note)}
              />
            ))}
          </>
        )}
      </div>

      {devices.length === 0 && !loading && (
        <div className="px-3 py-4 text-center text-sm text-gray-400">
          暂无设备<br />请先配对连接
        </div>
      )}
    </aside>
  );
}

function DeviceRow({
  device,
  note,
  selected,
  mirroring,
  online,
  onSelect,
  onNoteChange,
}: {
  device: DeviceInfo;
  note: string;
  selected: boolean;
  mirroring: boolean;
  online: boolean;
  onSelect?: () => void;
  onNoteChange: (note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const title = device.device_sn || device.serial;
  const connectionLabel = (type: DeviceInfo["connection_type"]) =>
    type === "wireless" ? "无线" : type === "usb" ? "有线" : "未知";
  const connectionClass = (type: DeviceInfo["connection_type"]) =>
    type === "wireless"
      ? "bg-blue-50 text-blue-600"
      : type === "usb"
        ? "bg-gray-100 text-gray-600"
        : "bg-amber-50 text-amber-600";

  const startEdit = () => {
    setDraft(note);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft !== note) onNoteChange(draft);
  };

  return (
    <div
      className={`mx-2 my-1 flex w-[calc(100%-1rem)] items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
        selected
          ? "border-blue-400 bg-blue-100 shadow-sm ring-1 ring-blue-200"
          : "border-transparent hover:border-gray-200 hover:bg-gray-100"
      } ${online ? "" : "opacity-60"}`}
    >
      <span
        className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          online ? "bg-green-500" : "bg-red-400"
        } ${selected ? "ring-2 ring-white" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onSelect}
          disabled={!online}
          className={`w-full text-left ${online ? "" : "cursor-default"}`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`truncate text-sm ${selected ? "font-semibold text-blue-950" : "text-gray-800"}`}
              title={title}
            >
              {title}
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${connectionClass(device.connection_type)}`}>
              {connectionLabel(device.connection_type)}
            </span>
            {mirroring && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                投屏中
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 truncate" title={device.serial}>
            ADB: {device.serial}
          </div>
          {device.model && (
            <div className="text-xs text-gray-400 truncate" title={device.model}>
              Model: {device.model}
            </div>
          )}
        </button>
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            placeholder="例如：客厅样机"
            autoFocus
            className="mt-2 w-full rounded border border-blue-400 bg-white px-2 py-1.5 text-xs text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <div
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
            className={`mt-2 min-h-[26px] w-full cursor-text rounded border border-transparent px-2 py-1.5 text-xs transition-colors hover:border-gray-200 hover:bg-gray-50 ${
              note ? "text-gray-700" : selected ? "text-blue-400" : "text-gray-300"
            }`}
          >
            {note || "点击添加备注"}
          </div>
        )}
      </div>
    </div>
  );
}

function deviceIdentityKey(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}
