import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabKey, AppSettings } from "./types";
import { applyLanguagePreference } from "./i18n";
import { useDevices } from "./hooks/useDevices";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { isAutoUpdateCheckEnabled } from "./updaterPolicy";
import { markTabVisited, TAB_KEYS } from "./tabState";
import { getStore, saveStoreValue, STORE_KEYS } from "./storage";
import AppShellLayout from "./components/layout/AppShellLayout";
import DevicePanel from "./components/layout/DevicePanel";
import PageHeader from "./components/layout/PageHeader";
import StatusBar from "./components/layout/StatusBar";
import ToolRail, { toolIcons } from "./components/layout/ToolRail";
import AdbSetup from "./components/AdbSetup";
import DeviceConsole from "./components/DeviceConsole";
import AdbWorkbench from "./components/AdbWorkbench";
import ApkInstall from "./components/ApkInstall";
import Screenshot from "./components/Screenshot";
import ScreenRecord from "./components/ScreenRecord";
import ScreenMirror from "./components/ScreenMirror";
import ImageCast from "./components/ImageCast";
import Clipboard from "./components/Clipboard";
import Logcat from "./components/Logcat";
import PackageList from "./components/PackageList";
import Settings from "./components/Settings";
import AppUpdatePrompt from "./components/AppUpdatePrompt";

const GITHUB_REPOSITORY_URL = "https://github.com/burpeepoo/adb-devices";

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
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const updater = useAppUpdater({
    autoCheckEnabled: settingsLoaded && isAutoUpdateCheckEnabled(settings.autoCheckUpdates),
  });

  const TAB_LABELS: Record<TabKey, string> = {
    pair: t('tabs.pairConnect'),
    workbench: t('tabs.workbench'),
    install: t('tabs.apkInstall'),
    screenshot: t('tabs.screenshot'),
    record: t('tabs.screenRecord'),
    mirror: t('tabs.screenMirror'),
    imageCast: t('tabs.imageCast'),
    clipboard: t('tabs.clipboard'),
    logcat: t('tabs.logcat'),
    packages: t('tabs.packageList'),
  };
  const tools = TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    icon: toolIcons[key],
  }));
  const [activeTab, setActiveTab] = useState<TabKey>("pair");
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set(["pair"]));
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mirroringDeviceSerial, setMirroringDeviceSerial] = useState<string | null>(null);
  const [screenshotShortcutResult, setScreenshotShortcutResult] = useState<ScreenshotShortcutResult | null>(null);
  const [recordShortcutResult, setRecordShortcutResult] = useState<RecordShortcutResult | null>(null);
  const selectedDeviceRef = useRef<string | null>(selectedDevice);
  const settingsRef = useRef<AppSettings>(settings);
  const screenshotShortcutRunningRef = useRef(false);
  const recordShortcutRunningRef = useRef(false);
  const recordingActiveRef = useRef(false);

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

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
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen("global-screenshot-shortcut", async () => {
      if (screenshotShortcutRunningRef.current) {
        return;
      }

      const saveDir = settingsRef.current.screenshotDir;
      if (!saveDir) {
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: false,
          msg: t('screenshot.noSaveDir'),
        });
        return;
      }

      screenshotShortcutRunningRef.current = true;
      try {
        const path = await invoke<string>("adb_screenshot", {
          saveDir,
          deviceSerial: selectedDeviceRef.current || null,
        });
        setScreenshotShortcutResult({
          id: Date.now(),
          ok: true,
          msg: t('screenshot.saved', { path }),
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
      const deviceSerial = selectedDeviceRef.current;

      if (!deviceSerial) {
        setRecordShortcutResult({
          id: Date.now(),
          ok: false,
          msg: t('screenRecord.selectDevice'),
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
            msg: t('screenRecord.saved', { path }),
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
  }, []);

  const selectedDeviceLabel = selectedDevice || t("layout.defaultDevice");

  const renderTabContent = (tab: TabKey) => {
    if (tab === "pair") {
      return (
        <DeviceConsole
          devices={devices}
          selectedDeviceSerial={selectedDevice}
          onConnected={refresh}
          onSelectTool={handleSelectTab}
        />
      );
    }
    if (tab === "workbench") return <AdbWorkbench deviceSerial={selectedDevice} />;
    if (tab === "install") {
      return (
        <ApkInstall
          deviceSerial={selectedDevice}
          recentApkDir={settings.recentApkDir}
          onRecentApkDirChange={(dir) => handleSaveDirChange("recentApkDir", dir)}
          active={activeTab === "install"}
        />
      );
    }
    if (tab === "screenshot") {
      return (
        <Screenshot
          deviceSerial={selectedDevice}
          saveDir={settings.screenshotDir}
          shortcutResult={screenshotShortcutResult}
          onSaveDirChange={(dir) => handleSaveDirChange("screenshotDir", dir)}
        />
      );
    }
    if (tab === "record") {
      return (
        <ScreenRecord
          deviceSerial={selectedDevice}
          saveDir={settings.recordingDir}
          shortcutResult={recordShortcutResult}
          onSaveDirChange={(dir) => handleSaveDirChange("recordingDir", dir)}
          onRecordingStateChange={handleRecordingStateChange}
        />
      );
    }
    if (tab === "mirror") {
      return <ScreenMirror deviceSerial={selectedDevice} onMirrorStateChange={setMirroringDeviceSerial} />;
    }
    if (tab === "imageCast") return <ImageCast deviceSerial={selectedDevice} active={activeTab === "imageCast"} />;
    if (tab === "clipboard") return <Clipboard deviceSerial={selectedDevice} />;
    if (tab === "logcat") return <Logcat deviceSerial={selectedDevice} />;
    if (tab === "packages") return <PackageList deviceSerial={selectedDevice} />;
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">{t('app.detectingAdb')}</div>
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
            tools={tools}
            activeTool={activeTab}
            settingsLabel={t("layout.openSettings")}
            githubLabel={t("layout.openGithub")}
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
            onSelectDevice={setSelectedDevice}
            onRefresh={refresh}
          />
        }
        header={
          <PageHeader
            title={TAB_LABELS[activeTab]}
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
