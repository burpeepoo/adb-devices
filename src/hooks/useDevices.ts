import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeviceInfo } from "../types";

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
      setDevices(result);
      // Auto-select first device if none selected
      if (!selectedDevice && result.length > 0) {
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
