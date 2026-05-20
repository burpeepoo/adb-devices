import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabKey, AppSettings } from "./types";
import { applyLanguagePreference } from "./i18n";
import { useDevices } from "./hooks/useDevices";
import { getStore, saveStoreValue, STORE_KEYS } from "./storage";
import AppShellLayout from "./components/layout/AppShellLayout";
import DevicePanel from "./components/layout/DevicePanel";
import PageHeader from "./components/layout/PageHeader";
import StatusBar from "./components/layout/StatusBar";
import ToolRail, { toolIcons } from "./components/layout/ToolRail";
import AdbSetup from "./components/AdbSetup";
import PairConnect from "./components/PairConnect";
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

export default function App() {
  const { t } = useTranslation();
  const { devices, loading, error, selectedDevice, setSelectedDevice, refresh } = useDevices();

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
  const tools = (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
    key,
    label: TAB_LABELS[key],
    icon: toolIcons[key],
  }));
  const [activeTab, setActiveTab] = useState<TabKey>("pair");
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mirroringDeviceSerial, setMirroringDeviceSerial] = useState<string | null>(null);
  const [screenshotShortcutResult, setScreenshotShortcutResult] = useState<ScreenshotShortcutResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    screenshotDir: "",
    recordingDir: "",
    recentApkDir: "",
    languagePreference: "system",
  });
  const selectedDeviceRef = useRef<string | null>(selectedDevice);
  const settingsRef = useRef<AppSettings>(settings);
  const screenshotShortcutRunningRef = useRef(false);

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
      };
      setSettings(nextSettings);
      await applyLanguagePreference(nextSettings.languagePreference);
    } catch {
      // ignore
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

  const selectedDeviceLabel = selectedDevice || t("layout.defaultDevice");

  const renderActiveContent = () => {
    if (activeTab === "pair") return <PairConnect devices={devices} onConnected={refresh} />;
    if (activeTab === "workbench") return <AdbWorkbench deviceSerial={selectedDevice} />;
    if (activeTab === "install") {
      return (
        <ApkInstall
          deviceSerial={selectedDevice}
          recentApkDir={settings.recentApkDir}
          onRecentApkDirChange={(dir) => handleSaveDirChange("recentApkDir", dir)}
        />
      );
    }
    if (activeTab === "screenshot") {
      return (
        <Screenshot
          deviceSerial={selectedDevice}
          saveDir={settings.screenshotDir}
          shortcutResult={screenshotShortcutResult}
          onSaveDirChange={(dir) => handleSaveDirChange("screenshotDir", dir)}
        />
      );
    }
    if (activeTab === "record") {
      return (
        <ScreenRecord
          deviceSerial={selectedDevice}
          saveDir={settings.recordingDir}
          onSaveDirChange={(dir) => handleSaveDirChange("recordingDir", dir)}
        />
      );
    }
    if (activeTab === "mirror") {
      return <ScreenMirror deviceSerial={selectedDevice} onMirrorStateChange={setMirroringDeviceSerial} />;
    }
    if (activeTab === "imageCast") return <ImageCast deviceSerial={selectedDevice} />;
    if (activeTab === "clipboard") return <Clipboard deviceSerial={selectedDevice} />;
    if (activeTab === "logcat") return <Logcat deviceSerial={selectedDevice} />;
    if (activeTab === "packages") return <PackageList deviceSerial={selectedDevice} />;
    return null;
  };

  if (adbAvailable === null) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">{t('app.detectingAdb')}</div>
      </div>
    );
  }

  if (!adbAvailable) {
    return <AdbSetup onInstalled={handleAdbInstalled} />;
  }

  return (
    <>
      <AppShellLayout
        rail={
          <ToolRail
            tools={tools}
            activeTool={activeTab}
            settingsLabel={t("layout.openSettings")}
            onSelectTool={setActiveTab}
            onOpenSettings={() => setShowSettings(true)}
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
        content={renderActiveContent()}
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
          onSettingsChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
