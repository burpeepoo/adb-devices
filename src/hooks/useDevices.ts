import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeviceHistoryItem, DeviceInfo } from "../types";
import { getStore, STORE_KEYS } from "../storage";

export function useDevices(refreshInterval = 300000) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DeviceInfo[]>("adb_devices");
      const store = await getStore();
      const history = (await store.get<DeviceHistoryItem[]>(STORE_KEYS.deviceHistory)) || [];
      const historyBySerial = new Map(history.map((device) => [device.serial, device]));

      for (const device of result) {
        if (device.state === "device") {
          historyBySerial.set(device.serial, {
            ...device,
            lastSeen: Date.now(),
          });
        }
      }

      const mergedBySerial = new Map<string, DeviceInfo>();
      for (const device of historyBySerial.values()) {
        mergedBySerial.set(device.serial, {
          serial: device.serial,
          state: "disconnected",
          model: device.model,
          product: device.product,
        });
      }
      for (const device of result) {
        mergedBySerial.set(device.serial, device);
      }

      const merged = Array.from(mergedBySerial.values()).sort((a, b) => {
        if (a.state === "device" && b.state !== "device") return -1;
        if (a.state !== "device" && b.state === "device") return 1;
        return a.serial.localeCompare(b.serial);
      });

      setDevices(merged);
      await store.set(STORE_KEYS.deviceHistory, Array.from(historyBySerial.values()));
      await store.save();

      // Auto-select first device if none selected
      if (!selectedDevice && merged.length > 0) {
        const firstOnline = result.find((d) => d.state === "device");
        if (firstOnline) setSelectedDevice(firstOnline.serial);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { devices, loading, error, selectedDevice, setSelectedDevice, refresh };
}
