import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabKey, AppSettings } from "./types";
import { useDevices } from "./hooks/useDevices";
import { getStore, saveStoreValue, STORE_KEYS } from "./storage";
import DeviceList from "./components/DeviceList";
import AdbSetup from "./components/AdbSetup";
import PairConnect from "./components/PairConnect";
import ApkInstall from "./components/ApkInstall";
import Screenshot from "./components/Screenshot";
import ScreenRecord from "./components/ScreenRecord";
import ScreenMirror from "./components/ScreenMirror";
import Clipboard from "./components/Clipboard";
import Logcat from "./components/Logcat";
import PackageList from "./components/PackageList";
import Settings from "./components/Settings";

const TAB_LABELS: Record<TabKey, string> = {
  pair: "配对连接",
  install: "安装应用",
  screenshot: "截图",
  record: "录屏",
  mirror: "投屏控制",
  clipboard: "剪贴板",
  logcat: "Logcat",
  packages: "包管理",
};

interface ScreenMirrorState {
  running: boolean;
  device_serial: string | null;
}

export default function App() {
  const { devices, loading, error, selectedDevice, setSelectedDevice, refresh } = useDevices();
  const [activeTab, setActiveTab] = useState<TabKey>("pair");
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mirroringDeviceSerial, setMirroringDeviceSerial] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    screenshotDir: "",
    recordingDir: "",
    recentApkDir: "",
  });

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
      setSettings((prev) => ({
        screenshotDir: saved?.screenshotDir || prev.screenshotDir || dir,
        recordingDir: saved?.recordingDir || prev.recordingDir || dir,
        recentApkDir: saved?.recentApkDir || prev.recentApkDir || "",
      }));
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

  const handleAdbInstalled = useCallback(() => {
    setAdbAvailable(true);
    refresh();
  }, [refresh]);

  const handleSettingsChange = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
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

  if (adbAvailable === null) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">正在检测 ADB...</div>
      </div>
    );
  }

  if (!adbAvailable) {
    return <AdbSetup onInstalled={handleAdbInstalled} />;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-800">ADB Manager</h1>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
          title="设置"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <DeviceList
          devices={devices}
          loading={loading}
          error={error}
          selectedDevice={selectedDevice}
          mirroringDeviceSerial={mirroringDeviceSerial}
          onSelectDevice={setSelectedDevice}
          onRefresh={refresh}
        />

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <nav className="flex border-b border-gray-200 bg-white px-2">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === "pair" && <PairConnect devices={devices} onConnected={refresh} />}
            {activeTab === "install" && (
              <ApkInstall
                deviceSerial={selectedDevice}
                recentApkDir={settings.recentApkDir}
                onRecentApkDirChange={(dir) => handleSaveDirChange("recentApkDir", dir)}
              />
            )}
            {activeTab === "screenshot" && (
              <Screenshot
                deviceSerial={selectedDevice}
                saveDir={settings.screenshotDir}
                onSaveDirChange={(dir) => handleSaveDirChange("screenshotDir", dir)}
              />
            )}
            {activeTab === "record" && (
              <ScreenRecord
                deviceSerial={selectedDevice}
                saveDir={settings.recordingDir}
                onSaveDirChange={(dir) => handleSaveDirChange("recordingDir", dir)}
              />
            )}
            {activeTab === "mirror" && (
              <ScreenMirror
                deviceSerial={selectedDevice}
                onMirrorStateChange={setMirroringDeviceSerial}
              />
            )}
            {activeTab === "clipboard" && <Clipboard deviceSerial={selectedDevice} />}
            {activeTab === "logcat" && <Logcat deviceSerial={selectedDevice} />}
            {activeTab === "packages" && <PackageList deviceSerial={selectedDevice} />}
          </div>
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        <span>
          {devices.length > 0
            ? `${devices.filter((d) => d.state === "device").length} 台设备在线`
            : "无设备连接"}
        </span>
        <span>每5分钟自动刷新</span>
      </footer>

      {/* Settings modal */}
      {showSettings && (
        <Settings
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
