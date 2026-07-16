import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabKey, AppSettings, DeviceInfo, type AdbAuthorizationTimeoutPrefs } from "./types";
import { applyLanguagePreference } from "./i18n";
import { useDevices } from "./hooks/useDevices";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { isAutoUpdateCheckEnabled } from "./updaterPolicy";
import { hashForTab, initialTabKeyFrom, markTabVisited, tabKeyFromValue, TAB_KEYS } from "./tabState";
import { toolIcons, toolLabelKeys } from "./toolMetadata";
import { toolNavigationLabelKeys } from "./toolNavigationLabels";
import { getStore, saveStoreValue, STORE_KEYS } from "./storage";
import { deviceIdentityKey, setDeviceNote, type DeviceNotes } from "./deviceNotes";
import { normalizeAgentCliSettings } from "./agentCliSettings";
import { normalizeAgentProviderSettings } from "./agentProviderSettings";
import {
  buildDeviceTargetState,
  deviceTargetResultSuffix,
  type DeviceTargetState,
} from "./deviceTarget.ts";
import AppShellLayout from "./components/layout/AppShellLayout";
import DevicePanel from "./components/layout/DevicePanel";
import PageHeader from "./components/layout/PageHeader";
import StatusBar from "./components/layout/StatusBar";
import ToolRail from "./components/layout/ToolRail";
import AdbSetup from "./components/AdbSetup";
import DeviceConsole from "./components/DeviceConsole";
import AdbWorkbench from "./components/AdbWorkbench";
import ApkInstall from "./components/ApkInstall";
import Screenshot from "./components/Screenshot";
import ScreenRecord from "./components/ScreenRecord";
import ScreenMirror from "./components/ScreenMirror";
import RemoteControl from "./components/RemoteControl";
import ImageCast from "./components/ImageCast";
import Clipboard from "./components/Clipboard";
import Logcat from "./components/Logcat";
import DisplayCalibrationLab from "./components/DisplayCalibrationLab";
import AgentCopilot from "./components/AgentCopilot";
import PerformancePanel from "./components/PerformancePanel";
import PackageList from "./components/PackageList";
import Settings from "./components/Settings";
import AppUpdatePrompt from "./components/AppUpdatePrompt";

const GITHUB_REPOSITORY_URL = "https://github.com/burpeepoo/adb-devices";

function resolveInitialAppTab(): TabKey {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  return initialTabKeyFrom(hash, import.meta.env.VITE_ADB_MANAGER_INITIAL_TAB);
}

interface ScreenMirrorState {
  running: boolean;
  device_serial: string | null;
}

interface ScreenshotShortcutResult {
  id: number;
  ok: boolean;
  msg: string;
  path?: string | null;
}

interface RecordShortcutResult {
  id: number;
  ok: boolean;
  msg: string;
  recording: boolean;
  path?: string | null;
}

export default function App() {
  const { t } = useTranslation();
  const { devices, loading, error, selectedDevice, setSelectedDevice, refresh } = useDevices();
  const [settings, setSettings] = useState<AppSettings>({
    screenshotDir: "",
    recordingDir: "",
    recentApkDir: "",
    languagePreference: "system",
    autoCheckUpdates: true,
    agentCli: normalizeAgentCliSettings(undefined),
    agentProviders: normalizeAgentProviderSettings(undefined),
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [deviceNotes, setDeviceNotes] = useState<DeviceNotes>({});
  const [adbAuthorizationTimeoutPrefs, setAdbAuthorizationTimeoutPrefs] = useState<AdbAuthorizationTimeoutPrefs>({});
  const [adbAuthorizationTimeoutDeviceStates, setAdbAuthorizationTimeoutDeviceStates] = useState<Record<string, boolean>>({});
  const [adbAuthorizationTimeoutPending, setAdbAuthorizationTimeoutPending] = useState<Record<string, boolean>>({});
  const updater = useAppUpdater({
    autoCheckEnabled: settingsLoaded && isAutoUpdateCheckEnabled(settings.autoCheckUpdates),
  });

  const railTools = [
    { key: "pair" as const, groupLabel: t("layout.navPrimary"), emphasis: "primary" as const },
    { key: "agent" as const, groupLabel: t("layout.navPrimary"), emphasis: "primary" as const },
    { key: "screenshot" as const, groupLabel: t("layout.navCapture"), emphasis: "tool" as const },
    { key: "record" as const, groupLabel: t("layout.navCapture"), emphasis: "tool" as const },
    { key: "mirror" as const, groupLabel: t("layout.navCapture"), emphasis: "tool" as const },
    { key: "remote" as const, groupLabel: t("layout.navCapture"), emphasis: "tool" as const },
    { key: "imageCast" as const, groupLabel: t("layout.navCapture"), emphasis: "tool" as const },
    { key: "workbench" as const, groupLabel: t("layout.navDiagnostics"), emphasis: "tool" as const },
    { key: "logcat" as const, groupLabel: t("layout.navDiagnostics"), emphasis: "tool" as const },
    { key: "displayCalibration" as const, groupLabel: t("layout.navDiagnostics"), emphasis: "tool" as const },
    { key: "performance" as const, groupLabel: t("layout.navDiagnostics"), emphasis: "tool" as const },
    { key: "install" as const, groupLabel: t("layout.navApps"), emphasis: "tool" as const },
    { key: "packages" as const, groupLabel: t("layout.navApps"), emphasis: "tool" as const },
    { key: "clipboard" as const, groupLabel: t("layout.navUtilities"), emphasis: "tool" as const },
  ].map((item) => ({
    ...item,
    label: t(toolNavigationLabelKeys[item.key] ?? toolLabelKeys[item.key]),
    icon: toolIcons[item.key],
  }));
  const [activeTab, setActiveTab] = useState<TabKey>(() => resolveInitialAppTab());
  const [agentRequestedMode, setAgentRequestedMode] = useState<"chat" | "walkthrough" | "bug_repro">("walkthrough");
  const [agentModeRequestId, setAgentModeRequestId] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set([resolveInitialAppTab()]));
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mirroringDeviceSerial, setMirroringDeviceSerial] = useState<string | null>(null);
  const [screenshotShortcutResult, setScreenshotShortcutResult] = useState<ScreenshotShortcutResult | null>(null);
  const [recordShortcutResult, setRecordShortcutResult] = useState<RecordShortcutResult | null>(null);
  const deviceTargetRef = useRef<DeviceTargetState | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
  const appliedAdbAuthorizationTimeoutRef = useRef<Set<string>>(new Set());
  const readingAdbAuthorizationTimeoutRef = useRef<Set<string>>(new Set());
  const screenshotShortcutRunningRef = useRef(false);
  const recordShortcutRunningRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const deviceTarget = useMemo(
    () => buildDeviceTargetState(devices, selectedDevice, deviceNotes),
    [devices, deviceNotes, selectedDevice],
  );

  useEffect(() => {
    deviceTargetRef.current = deviceTarget;
  }, [deviceTarget]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const checkAdb = useCallback(async () => {
    try {
      const available = await invoke<boolean>("check_adb_available");
      setAdbAvailable(available);
    } catch {
      setAdbAvailable(false);
    }
  }, []);

  const syncMirrorState = useCallback(async () => {
    try {
      const state = await invoke<ScreenMirrorState>("get_screen_mirror_state");
      setMirroringDeviceSerial(state.running ? state.device_serial : null);
    } catch {
      setMirroringDeviceSerial(null);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const dir = await invoke<string>("get_default_save_dir");
      const store = await getStore();
      const saved = await store.get<AppSettings>(STORE_KEYS.settings);
      const nextSettings = {
        screenshotDir: saved?.screenshotDir || dir,
        recordingDir: saved?.recordingDir || dir,
        recentApkDir: saved?.recentApkDir || "",
        languagePreference: saved?.languagePreference || "system",
        autoCheckUpdates: saved?.autoCheckUpdates ?? true,
        agentCli: normalizeAgentCliSettings(saved?.agentCli),
        agentProviders: normalizeAgentProviderSettings(saved?.agentProviders),
      };
      setSettings(nextSettings);
      await applyLanguagePreference(nextSettings.languagePreference);
    } catch {
      // ignore
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    checkAdb();
    loadSettings();
    syncMirrorState();
    const mirrorStateTimer = setInterval(syncMirrorState, 2500);
    return () => clearInterval(mirrorStateTimer);
  }, [checkAdb, loadSettings, syncMirrorState]);

  useEffect(() => {
    getStore()
      .then((store) => store.get<DeviceNotes>(STORE_KEYS.deviceNotes))
      .then((saved) => setDeviceNotes(saved || {}))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getStore()
      .then((store) => store.get<AdbAuthorizationTimeoutPrefs>(STORE_KEYS.adbAuthorizationTimeoutPrefs))
      .then((saved) => setAdbAuthorizationTimeoutPrefs(saved || {}))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen("global-screenshot-shortcut", async () => {
      if (screenshotShortcutRunningRef.current) {
        return;
      }

      const saveDir = settingsRef.current.screenshotDir;
      const target = deviceTargetRef.current;
      if (!saveDir) {
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: false,
          msg: t('screenshot.noSaveDir'),
        });
        return;
      }
      if (!target?.serial) {
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: false,
          msg: target ? deviceTargetBlockMessage(t, target) : t("deviceTarget.selectOnlineDevice"),
        });
        return;
      }

      screenshotShortcutRunningRef.current = true;
      try {
        const path = await invoke<string>("adb_screenshot", {
          saveDir,
          deviceSerial: target.serial,
        });
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: true,
          msg: appendTargetSuffix(t('screenshot.saved', { path }), target, t),
          path,
        });
      } catch (e) {
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: false,
          msg: String(e),
        });
      } finally {
        screenshotShortcutRunningRef.current = false;
      }
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((e) => {
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: false,
          msg: String(e),
        });
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen("global-record-shortcut", async () => {
      if (recordShortcutRunningRef.current) {
        return;
      }

      const saveDir = settingsRef.current.recordingDir;
      const target = deviceTargetRef.current;
      const deviceSerial = target?.serial || null;

      if (!deviceSerial) {
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: target ? deviceTargetBlockMessage(t, target) : t("deviceTarget.selectOnlineDevice"),
          recording: recordingActiveRef.current,
        });
        return;
      }

      if (recordingActiveRef.current && !saveDir) {
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: t('screenRecord.noSaveDir'),
          recording: true,
        });
        return;
      }

      if (!recordingActiveRef.current && !saveDir) {
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: t('screenRecord.noSaveDir'),
          recording: false,
        });
        return;
      }

      recordShortcutRunningRef.current = true;
      try {
        if (recordingActiveRef.current) {
          const path = await invoke<string>("adb_stop_recording", {
            saveDir,
            deviceSerial,
          });
          recordingActiveRef.current = false;
          setRecordShortcutResult({
            id: Date.now(),
            ok: true,
            msg: target ? appendTargetSuffix(t('screenRecord.saved', { path }), target, t) : t('screenRecord.saved', { path }),
            recording: false,
            path,
          });
        } else {
          const msg = await invoke<string>("adb_start_recording", {
            deviceSerial,
          });
          recordingActiveRef.current = true;
          setRecordShortcutResult({
            id: Date.now(),
            ok: true,
            msg,
            recording: true,
          });
        }
      } catch (e) {
        if (recordingActiveRef.current) {
          recordingActiveRef.current = false;
        }
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: String(e),
          recording: recordingActiveRef.current,
        });
      } finally {
        recordShortcutRunningRef.current = false;
      }
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((e) => {
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: String(e),
          recording: recordingActiveRef.current,
        });
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  const handleAdbInstalled = useCallback(() => {
    setAdbAvailable(true);
    refresh();
  }, [refresh]);

  const handleSettingsChange = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
    applyLanguagePreference(nextSettings.languagePreference).catch(() => {
      // Frontend language changes are best-effort; persisted settings still save below.
    });
    saveStoreValue(STORE_KEYS.settings, nextSettings).catch(() => {
      // Non-critical; the current session can still use the selected paths.
    });
  }, []);

  const handleDeviceNoteChange = useCallback((device: DeviceInfo, note: string) => {
    setDeviceNotes((current) => {
      const next = setDeviceNote(current, device, note);
      saveStoreValue(STORE_KEYS.deviceNotes, next).catch(() => undefined);
      return next;
    });
  }, []);

  const refreshDevices = useCallback(() => refresh(), [refresh]);
  const refreshDevicesWithMdns = useCallback(() => refresh({ autoConnectMdns: true }), [refresh]);

  const readAdbAuthorizationTimeoutState = useCallback(async (device: DeviceInfo) => {
    const identity = deviceIdentityKey(device);
    const readKey = `${identity}:${device.serial}`;
    if (readingAdbAuthorizationTimeoutRef.current.has(readKey)) return;

    readingAdbAuthorizationTimeoutRef.current.add(readKey);
    setAdbAuthorizationTimeoutPending((current) => ({ ...current, [identity]: true }));
    try {
      const disabled = await invoke<boolean>("adb_get_authorization_timeout_disabled", {
        deviceSerial: device.serial,
      });
      setAdbAuthorizationTimeoutDeviceStates((current) => ({ ...current, [identity]: disabled }));
    } catch {
      // The local preference remains available as a fallback when the device cannot be queried.
    } finally {
      readingAdbAuthorizationTimeoutRef.current.delete(readKey);
      setAdbAuthorizationTimeoutPending((current) => {
        const next = { ...current };
        delete next[identity];
        return next;
      });
    }
  }, []);

  const applyAdbAuthorizationTimeoutPreference = useCallback(async (device: DeviceInfo, disabled: boolean) => {
    const identity = deviceIdentityKey(device);
    setAdbAuthorizationTimeoutPending((current) => ({ ...current, [identity]: true }));
    try {
      await invoke<string>("adb_set_authorization_timeout_disabled", {
        deviceSerial: device.serial,
        disabled,
      });
      setAdbAuthorizationTimeoutDeviceStates((current) => ({ ...current, [identity]: disabled }));
    } finally {
      setAdbAuthorizationTimeoutPending((current) => {
        const next = { ...current };
        delete next[identity];
        return next;
      });
    }
  }, []);

  const handleAdbAuthorizationTimeoutChange = useCallback((device: DeviceInfo, disabled: boolean) => {
    const identity = deviceIdentityKey(device);
    setAdbAuthorizationTimeoutPrefs((current) => {
      const next = { ...current, [identity]: disabled };
      if (!disabled) delete next[identity];
      saveStoreValue(STORE_KEYS.adbAuthorizationTimeoutPrefs, next).catch(() => undefined);
      return next;
    });

    if (!disabled) {
      for (const key of Array.from(appliedAdbAuthorizationTimeoutRef.current)) {
        if (key.startsWith(`${identity}:`)) {
          appliedAdbAuthorizationTimeoutRef.current.delete(key);
        }
      }
    }

    if (device.state === "device" && device.connection_type === "wireless") {
      void applyAdbAuthorizationTimeoutPreference(device, disabled).catch(() => undefined);
    }
  }, [applyAdbAuthorizationTimeoutPreference]);

  useEffect(() => {
    for (const device of devices) {
      if (device.state === "device" && device.connection_type === "wireless") {
        void readAdbAuthorizationTimeoutState(device);
      }

      const identity = deviceIdentityKey(device);
      if (!adbAuthorizationTimeoutPrefs[identity]) continue;
      if (device.state !== "device" || device.connection_type !== "wireless") continue;

      const applyKey = `${identity}:${device.serial}`;
      if (appliedAdbAuthorizationTimeoutRef.current.has(applyKey)) continue;
      appliedAdbAuthorizationTimeoutRef.current.add(applyKey);

      void applyAdbAuthorizationTimeoutPreference(device, true).catch(() => {
        appliedAdbAuthorizationTimeoutRef.current.delete(applyKey);
      });
    }
  }, [adbAuthorizationTimeoutPrefs, applyAdbAuthorizationTimeoutPreference, devices, readAdbAuthorizationTimeoutState]);

  const handleOpenGithub = useCallback(async () => {
    try {
      await invoke("open_external_url", { url: GITHUB_REPOSITORY_URL });
    } catch {
      // Keep navigation non-blocking; the command enforces the URL allowlist.
    }
  }, []);

  const handleSaveDirChange = useCallback(
    (type: keyof AppSettings, dir: string) => {
      const nextSettings = {
        ...settings,
        [type]: dir,
      };
      handleSettingsChange(nextSettings);
    },
    [handleSettingsChange, settings]
  );

  const handleRecordingStateChange = useCallback((recording: boolean) => {
    recordingActiveRef.current = recording;
  }, []);

  const handleSelectTab = useCallback((tab: TabKey) => {
    setVisitedTabs((current) => markTabVisited(current, tab));
    setActiveTab(tab);
    if (typeof window !== "undefined" && window.location.hash !== hashForTab(tab)) {
      window.history.replaceState(null, "", hashForTab(tab));
    }
  }, []);

  const handleOpenScoutTask = useCallback(
    (mode: "chat" | "walkthrough" | "bug_repro") => {
      setAgentRequestedMode(mode);
      setAgentModeRequestId((current) => current + 1);
      handleSelectTab("agent");
    },
    [handleSelectTab],
  );

  useEffect(() => {
    const handleHashChange = () => {
      const tab = tabKeyFromValue(window.location.hash);
      if (!tab) return;
      setVisitedTabs((current) => markTabVisited(current, tab));
      setActiveTab(tab);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const selectedDeviceInfo = devices.find((device) => device.serial === selectedDevice) || null;
  const selectedDeviceLabel = selectedDeviceInfo
    ? deviceNotes[deviceIdentityKey(selectedDeviceInfo)] || deviceIdentityKey(selectedDeviceInfo)
    : selectedDevice || t("layout.defaultDevice");

  const renderTabContent = (tab: TabKey) => {
    if (tab === "pair") {
      return (
        <DeviceConsole
          devices={devices}
          selectedDeviceSerial={selectedDevice}
          deviceNotes={deviceNotes}
          onConnected={refreshDevices}
          onSelectTool={handleSelectTab}
          onOpenScout={handleOpenScoutTask}
          onDeviceNoteChange={handleDeviceNoteChange}
        />
      );
    }
    if (tab === "workbench") return <AdbWorkbench deviceTarget={deviceTarget} />;
    if (tab === "install") {
      return (
        <ApkInstall
          deviceTarget={deviceTarget}
          recentApkDir={settings.recentApkDir}
          onRecentApkDirChange={(dir) => handleSaveDirChange("recentApkDir", dir)}
          active={activeTab === "install"}
        />
      );
    }
    if (tab === "screenshot") {
      return (
        <Screenshot
          deviceTarget={deviceTarget}
          saveDir={settings.screenshotDir}
          shortcutResult={screenshotShortcutResult}
          onSaveDirChange={(dir) => handleSaveDirChange("screenshotDir", dir)}
        />
      );
    }
    if (tab === "record") {
      return (
        <ScreenRecord
          deviceTarget={deviceTarget}
          saveDir={settings.recordingDir}
          shortcutResult={recordShortcutResult}
          onSaveDirChange={(dir) => handleSaveDirChange("recordingDir", dir)}
          onRecordingStateChange={handleRecordingStateChange}
        />
      );
    }
    if (tab === "mirror") {
      return <ScreenMirror deviceTarget={deviceTarget} onMirrorStateChange={setMirroringDeviceSerial} />;
    }
    if (tab === "remote") return <RemoteControl />;
    if (tab === "imageCast") return <ImageCast deviceTarget={deviceTarget} active={activeTab === "imageCast"} />;
    if (tab === "clipboard") return <Clipboard deviceTarget={deviceTarget} />;
    if (tab === "logcat") return <Logcat deviceTarget={deviceTarget} />;
    if (tab === "displayCalibration") return <DisplayCalibrationLab deviceTarget={deviceTarget} />;
    if (tab === "agent") {
      return (
        <AgentCopilot
          deviceTarget={deviceTarget}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          requestedMode={agentRequestedMode}
          modeRequestId={agentModeRequestId}
        />
      );
    }
    if (tab === "performance") return <PerformancePanel deviceTarget={deviceTarget} active={activeTab === "performance"} />;
    if (tab === "packages") return <PackageList deviceTarget={deviceTarget} />;
    return null;
  };

  const renderWorkspaceContent = () => (
    <>
      {TAB_KEYS.map((tab) =>
        visitedTabs.has(tab) ? (
          <div
            key={tab}
            aria-hidden={activeTab !== tab}
            style={{ display: activeTab === tab ? "contents" : "none" }}
          >
            {renderTabContent(tab)}
          </div>
        ) : null,
      )}
    </>
  );

  if (adbAvailable === null) {
    return (
      <div className="sky flex h-screen items-center justify-center">
        <div className="card card-compact text-muted">{t('app.detectingAdb')}</div>
      </div>
    );
  }

  if (!adbAvailable) {
    return (
      <>
        <AdbSetup onInstalled={handleAdbInstalled} />
        <AppUpdatePrompt updater={updater} />
      </>
    );
  }

  return (
    <>
      <AppShellLayout
        rail={
          <ToolRail
            tools={railTools}
            activeTool={activeTab}
            settingsLabel={t("layout.settings")}
            githubLabel={t("layout.github")}
            hasUpdate={updater.status === "available"}
            onSelectTool={handleSelectTab}
            onOpenSettings={() => setShowSettings(true)}
            onOpenGithub={handleOpenGithub}
          />
        }
        devices={
          <DevicePanel
            devices={devices}
            loading={loading}
            error={error}
            selectedDevice={selectedDevice}
            mirroringDeviceSerial={mirroringDeviceSerial}
            deviceNotes={deviceNotes}
            adbAuthorizationTimeoutPrefs={adbAuthorizationTimeoutPrefs}
            adbAuthorizationTimeoutDeviceStates={adbAuthorizationTimeoutDeviceStates}
            adbAuthorizationTimeoutPending={adbAuthorizationTimeoutPending}
            onSelectDevice={setSelectedDevice}
            onDeviceNoteChange={handleDeviceNoteChange}
            onAdbAuthorizationTimeoutChange={handleAdbAuthorizationTimeoutChange}
            onRefresh={refreshDevicesWithMdns}
          />
        }
        header={
          <PageHeader
            selectedDeviceLabel={selectedDevice ? t("layout.selectedDevice") : t("layout.noSelectedDevice")}
            selectedDeviceValue={selectedDeviceLabel}
          />
        }
        content={renderWorkspaceContent()}
        status={
          <StatusBar
            devices={devices}
            adbReadyLabel={t("layout.adbReady")}
            countLabel={t("layout.deviceCount", {
              online: devices.filter((device) => device.state === "device").length,
              total: devices.length,
            })}
            autoRefreshLabel={t("app.autoRefresh")}
          />
        }
      />

      {showSettings && (
        <Settings
          settings={settings}
          updater={updater}
          onSettingsChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
      <AppUpdatePrompt updater={updater} />
    </>
  );
}

function deviceTargetBlockMessage(t: TFunction, target: DeviceTargetState) {
  return target.blockReason === "selected-device-not-online"
    ? t("deviceTarget.selectedUnavailable", { count: target.onlineDeviceCount })
    : t("deviceTarget.selectOnlineDevice", { count: target.onlineDeviceCount });
}

function appendTargetSuffix(message: string, target: DeviceTargetState, t: TFunction) {
  const suffix = deviceTargetResultSuffix(target, t("deviceTarget.resultLabel"));
  return suffix ? `${message} · ${suffix}` : message;
}
