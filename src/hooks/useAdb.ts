import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useAdb<T = string>(command: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  const execute = useCallback(
    async (args: Record<string, unknown> = {}) => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<T>(command, args);
        setData(result);
        return result;
      } catch (e) {
        const msg = String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [command]
  );

  const clearError = useCallback(() => setError(null), []);

  return { loading, error, data, execute, clearError };
}
