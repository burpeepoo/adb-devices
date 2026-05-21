import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  UPDATE_AUTO_CHECK_DELAY_MS,
  UPDATE_AUTO_CHECK_INTERVAL_MS,
  canRunAutomaticUpdateCheck,
} from "../updaterPolicy";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total?: number;
}

export interface CheckUpdateOptions {
  silent?: boolean;
}

export interface AppUpdaterOptions {
  autoCheckEnabled?: boolean;
}

export interface AppUpdaterControls {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress;
  error: string | null;
  promptOpen: boolean;
  checkForUpdate: (options?: CheckUpdateOptions) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissPrompt: () => void;
  openPrompt: () => void;
}

const UPDATE_REQUEST_TIMEOUT_MS = 30000;

function toUpdateInfo(update: Update): UpdateInfo {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useAppUpdater(options: AppUpdaterOptions = {}): AppUpdaterControls {
  const autoCheckEnabled = options.autoCheckEnabled ?? true;
  const updateRef = useRef<Update | null>(null);
  const statusRef = useRef<UpdateStatus>("idle");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0 });
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const clearPendingUpdate = useCallback(async () => {
    const previous = updateRef.current;
    updateRef.current = null;
    if (previous) {
      try {
        await previous.close();
      } catch {
        // A stale update resource can be safely ignored.
      }
    }
  }, []);

  const checkForUpdate = useCallback(
    async (options: CheckUpdateOptions = {}) => {
      const silent = options.silent ?? false;

      if (!isTauri()) {
        if (!silent) {
          setStatus("error");
          setError("Updater is only available in the desktop app.");
        }
        return;
      }

      setStatus("checking");
      setError(null);
      setProgress({ downloaded: 0 });

      try {
        await clearPendingUpdate();
        const nextUpdate = await check({ timeout: UPDATE_REQUEST_TIMEOUT_MS });

        if (!nextUpdate) {
          setUpdateInfo(null);
          setStatus(silent ? "idle" : "not-available");
          return;
        }

        updateRef.current = nextUpdate;
        setUpdateInfo(toUpdateInfo(nextUpdate));
        setStatus("available");
        if (!silent) {
          setPromptOpen(true);
        }
      } catch (e) {
        setUpdateInfo(null);
        setStatus(silent ? "idle" : "error");
        if (!silent) {
          setError(toErrorMessage(e));
        }
      }
    },
    [clearPendingUpdate]
  );

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    let downloaded = 0;
    let total: number | undefined;

    setStatus("downloading");
    setError(null);
    setProgress({ downloaded: 0 });

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0;
          total = event.data.contentLength;
          setProgress({ downloaded, total });
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress({ downloaded, total });
          return;
        }

        if (event.event === "Finished") {
          setProgress({ downloaded: total ?? downloaded, total });
        }
      });

      setStatus("ready");
      await relaunch();
    } catch (e) {
      setStatus("error");
      setError(toErrorMessage(e));
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    if (status !== "downloading") {
      setPromptOpen(false);
    }
  }, [status]);

  const openPrompt = useCallback(() => {
    if (updateRef.current) {
      setPromptOpen(true);
    }
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!autoCheckEnabled) return;

    const checkSilently = () => {
      if (canRunAutomaticUpdateCheck(statusRef.current)) {
        void checkForUpdate({ silent: true });
      }
    };

    const startupTimer = window.setTimeout(checkSilently, UPDATE_AUTO_CHECK_DELAY_MS);
    const intervalTimer = window.setInterval(checkSilently, UPDATE_AUTO_CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalTimer);
    };
  }, [autoCheckEnabled, checkForUpdate]);

  useEffect(() => {
    return () => {
      const update = updateRef.current;
      if (update) {
        void update.close();
      }
    };
  }, []);

  return {
    status,
    updateInfo,
    progress,
    error,
    promptOpen,
    checkForUpdate,
    downloadAndInstall,
    dismissPrompt,
    openPrompt,
  };
}
