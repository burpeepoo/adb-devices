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
        mergedByDeviceKey.set(deviceIdentityKey(device), {
          serial: device.serial,
          device_sn: device.device_sn || "",
          state: "disconnected",
          model: device.model,
          product: device.product,
          connection_type: device.connection_type || "unknown",
        });
      }
      for (const device of result) {
        mergedByDeviceKey.set(deviceIdentityKey(device), device);
      }

      const merged = Array.from(mergedByDeviceKey.values()).sort((a, b) => {
        if (a.state === "device" && b.state !== "device") return -1;
        if (a.state !== "device" && b.state === "device") return 1;
        return deviceDisplayTitle(a).localeCompare(deviceDisplayTitle(b));
      });

      setDevices(merged);
      await store.set(STORE_KEYS.deviceHistory, Array.from(historyByDeviceKey.values()));
      await store.save();

      const firstOnline = result.find((d) => d.state === "device");
      const selectedOnline = selectedDevice
        ? result.some((d) => d.state === "device" && d.serial === selectedDevice)
        : false;

      if (!selectedDevice && firstOnline) {
        setSelectedDevice(firstOnline.serial);
      } else if (selectedDevice && !selectedOnline) {
        setSelectedDevice(firstOnline?.serial || null);
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

function deviceIdentityKey(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}

function deviceDisplayTitle(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}
