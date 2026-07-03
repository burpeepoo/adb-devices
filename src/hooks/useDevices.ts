import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeviceHistoryItem, DeviceInfo } from "../types";
import { getStore, STORE_KEYS } from "../storage";
import { deviceIdentityKey } from "../deviceNotes";
import { preferDeviceForIdentity, resolveVisibleSelectedDevice } from "../deviceSelection";

interface RefreshOptions {
  silent?: boolean;
}

export function useDevices() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const selectedDeviceRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);

  const updateSelectedDevice = useCallback((serial: string | null) => {
    selectedDeviceRef.current = serial;
    setSelectedDevice(serial);
  }, []);

  const refresh = useCallback(async (options: RefreshOptions = {}) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const result = await invoke<DeviceInfo[]>("adb_devices");
      const store = await getStore();
      const history = (await store.get<DeviceHistoryItem[]>(STORE_KEYS.deviceHistory)) || [];
      const historyByDeviceKey = new Map(history.map((device) => [deviceIdentityKey(device), device]));

      for (const device of result) {
        if (device.state === "device") {
          historyByDeviceKey.set(deviceIdentityKey(device), {
            ...device,
            lastSeen: Date.now(),
          });
        }
      }

      const mergedByDeviceKey = new Map<string, DeviceInfo>();
      for (const device of historyByDeviceKey.values()) {
        const historyDevice = {
          serial: device.serial,
          device_sn: device.device_sn || "",
          state: "disconnected",
          model: device.model,
          product: device.product,
          connection_type: device.connection_type || "unknown",
        } satisfies DeviceInfo;
        const key = deviceIdentityKey(historyDevice);
        mergedByDeviceKey.set(key, preferDeviceForIdentity(mergedByDeviceKey.get(key), historyDevice));
      }
      for (const device of result) {
        const key = deviceIdentityKey(device);
        mergedByDeviceKey.set(key, preferDeviceForIdentity(mergedByDeviceKey.get(key), device));
      }

      const merged = Array.from(mergedByDeviceKey.values()).sort((a, b) => {
        if (a.state === "device" && b.state !== "device") return -1;
        if (a.state !== "device" && b.state === "device") return 1;
        return deviceDisplayTitle(a).localeCompare(deviceDisplayTitle(b));
      });

      setDevices(merged);
      await store.set(STORE_KEYS.deviceHistory, Array.from(historyByDeviceKey.values()));
      await store.save();

      const currentSelectedDevice = selectedDeviceRef.current;
      const nextSelectedDevice = resolveVisibleSelectedDevice(currentSelectedDevice, result, merged);
      if (nextSelectedDevice !== currentSelectedDevice) updateSelectedDevice(nextSelectedDevice);
    } catch (e) {
      setError(String(e));
    } finally {
      refreshingRef.current = false;
      if (!options.silent) setLoading(false);
    }
  }, [updateSelectedDevice]);

  useEffect(() => {
    refresh();
    const refreshWhenVisible = () => {
      if (!document.hidden) void refresh({ silent: true });
    };
    const refreshOnFocus = () => {
      void refresh({ silent: true });
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);

  return { devices, loading, error, selectedDevice, setSelectedDevice: updateSelectedDevice, refresh };
}

function deviceDisplayTitle(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}
