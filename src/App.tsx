import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ActionIcon, Drawer, Indicator, Tooltip } from "@mantine/core";
import { IconRobot } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TabKey, AppSettings, DeviceInfo } from "./types";
import { applyLanguagePreference } from "./i18n";
import { useDevices } from "./hooks/useDevices";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { isAutoUpdateCheckEnabled } from "./updaterPolicy";
import { markTabVisited, TAB_KEYS } from "./tabState";
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
import ToolRail, { toolIcons } from "./components/layout/ToolRail";
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
import AgentCopilot from "./components/AgentCopilot";
import PerformancePanel from "./components/PerformancePanel";
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
    agentCli: normalizeAgentCliSettings(undefined),
    agentProviders: normalizeAgentProviderSettings(undefined),
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [deviceNotes, setDeviceNotes] = useState<DeviceNotes>({});
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
    remote: t('tabs.remoteControl'),
    imageCast: t('tabs.imageCast'),
    clipboard: t('tabs.clipboard'),
    logcat: t('tabs.logcat'),
    agent: t('tabs.agent'),
    performance: t('tabs.performance'),
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
  const [copilotDrawerOpen, setCopilotDrawerOpen] = useState(false);
  const [mirroringDeviceSerial, setMirroringDeviceSerial] = useState<string | null>(null);
  const [screenshotShortcutResult, setScreenshotShortcutResult] = useState<ScreenshotShortcutResult | null>(null);
  const [recordShortcutResult, setRecordShortcutResult] = useState<RecordShortcutResult | null>(null);
  const deviceTargetRef = useRef<DeviceTargetState | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
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
          onConnected={refresh}
          onSelectTool={handleSelectTab}
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
    if (tab === "agent") {
      return (
        <AgentCopilot
          deviceTarget={deviceTarget}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          contextLabel={TAB_LABELS[activeTab]}
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
            tools={tools}
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
            onSelectDevice={setSelectedDevice}
            onDeviceNoteChange={handleDeviceNoteChange}
            onRefresh={refresh}
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

      <Tooltip label={t("agent.openCopilot")} position="left">
        <Indicator
          color="green"
          size={10}
          offset={8}
          disabled={!copilotDrawerOpen}
          processing={copilotDrawerOpen}
        >
          <ActionIcon
            size={54}
            radius="xl"
            variant="filled"
            color="ink"
            aria-label={t("agent.openCopilot")}
            onClick={() => setCopilotDrawerOpen(true)}
            style={{
              position: "fixed",
              right: 24,
              bottom: 40,
              zIndex: 220,
              boxShadow: "var(--shadow-tier-2)",
            }}
          >
            <IconRobot size={26} />
          </ActionIcon>
        </Indicator>
      </Tooltip>

      <Drawer
        opened={copilotDrawerOpen}
        onClose={() => setCopilotDrawerOpen(false)}
        position="right"
        size={520}
        title={t("agent.drawerTitle")}
        zIndex={300}
        keepMounted
        styles={{
          content: { display: "flex", flexDirection: "column" },
          body: { flex: 1, minHeight: 0, padding: 16 },
        }}
      >
        <AgentCopilot
          surface="drawer"
          drawerOpen={copilotDrawerOpen}
          contextLabel={TAB_LABELS[activeTab]}
          deviceTarget={deviceTarget}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />
      </Drawer>

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
