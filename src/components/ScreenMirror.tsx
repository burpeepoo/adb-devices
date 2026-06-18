import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IconApps, IconDevicesPc, IconPlayerPlay, IconRefresh, IconSearch } from "@tabler/icons-react";
import SectionTitle from "./common/SectionTitle";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import { groupLaunchableApps } from "../appDrawerGrouping";
import { deviceTargetResultSuffix, type DeviceTargetState } from "../deviceTarget.ts";
import type { LaunchableApp, LaunchableAppAsset } from "../types";

interface Props {
  deviceTarget: DeviceTargetState;
  onMirrorStateChange: (deviceSerial: string | null) => void;
}

interface MirrorState {
  running: boolean;
  device_serial: string | null;
}

const APP_ICON_CLASSES = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-rose-600",
  "bg-indigo-600",
  "bg-cyan-700",
  "bg-slate-700",
  "bg-teal-600",
  "bg-fuchsia-700",
];

function appIconClass(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return APP_ICON_CLASSES[hash % APP_ICON_CLASSES.length];
}

function appInitial(app: LaunchableApp) {
  const source = (app.label || app.package_name || "A").trim();
  return source.charAt(0).toUpperCase() || "A";
}

export default function ScreenMirror({ deviceTarget, onMirrorStateChange }: Props) {
  const { t } = useTranslation();
  const [scrcpyAvailable, setScrcpyAvailable] = useState<boolean | null>(null);
  const [installingScrcpy, setInstallingScrcpy] = useState(false);
  const [installProgress, setInstallProgress] = useState<string[]>([]);
  const [mirroring, setMirroring] = useState(false);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [mirrorAudioEnabled, setMirrorAudioEnabled] = useState(false);
  const [navigationLoading, setNavigationLoading] = useState<"back" | "home" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [drawerApps, setDrawerApps] = useState<LaunchableApp[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerQuery, setDrawerQuery] = useState("");
  const [drawerStatus, setDrawerStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [launchingComponent, setLaunchingComponent] = useState<string | null>(null);
  const drawerRequestRef = useRef(0);

  const applyMirrorState = useCallback(
    (state: MirrorState) => {
      setMirroring(state.running);
      onMirrorStateChange(state.running ? state.device_serial : null);
    },
    [onMirrorStateChange]
  );

  const syncMirrorState = useCallback(async () => {
    const state = await invoke<MirrorState>("get_screen_mirror_state");
    applyMirrorState(state);
    return state;
  }, [applyMirrorState]);

  const loadDrawerAppIcon = useCallback(
    async (serial: string, app: LaunchableApp, requestId: number, forceRefresh = false) => {
      if (drawerRequestRef.current !== requestId) return;
      try {
        const asset = await invoke<LaunchableAppAsset>("adb_load_launchable_app_icon", {
          deviceSerial: serial,
          packageName: app.package_name,
          activityName: app.activity_name,
          forceRefresh,
        });
        if (drawerRequestRef.current !== requestId) return;
        setDrawerApps((current) =>
          current.map((item) => {
            if (item.component_name !== app.component_name) return item;
            return {
              ...item,
              label: asset.label?.trim() || item.label,
              icon_data_url: asset.icon_data_url || item.icon_data_url,
            };
          })
        );
        if (asset.cache_stale && !forceRefresh) {
          void loadDrawerAppIcon(serial, app, requestId, true);
        }
      } catch {
        // Keep the fallback icon when an APK cannot be pulled or parsed.
      }
    },
    []
  );

  const loadDrawerAppIcons = useCallback(async (serial: string, apps: LaunchableApp[], requestId: number, forceRefresh = false) => {
    for (const app of apps) {
      if (drawerRequestRef.current !== requestId) return;
      await loadDrawerAppIcon(serial, app, requestId, forceRefresh);
    }
  }, [loadDrawerAppIcon]);

  const loadDrawerApps = useCallback(async (forceIconRefresh = false) => {
    const serial = deviceTarget.serial?.trim();
    const requestId = drawerRequestRef.current + 1;
    drawerRequestRef.current = requestId;
    setDrawerStatus(null);

    if (!serial) {
      setDrawerApps([]);
      setDrawerError(null);
      setDrawerLoading(false);
      return;
    }

    setDrawerLoading(true);
    setDrawerError(null);
    setDrawerApps([]);
    try {
      const apps = await invoke<LaunchableApp[]>("adb_list_launchable_apps", {
        deviceSerial: serial,
      });
      if (drawerRequestRef.current === requestId) {
        setDrawerApps(apps);
        void loadDrawerAppIcons(serial, apps, requestId, forceIconRefresh);
      }
    } catch (e) {
      if (drawerRequestRef.current === requestId) {
        setDrawerError(String(e));
      }
    } finally {
      if (drawerRequestRef.current === requestId) {
        setDrawerLoading(false);
      }
    }
  }, [deviceTarget.serial, loadDrawerAppIcons]);

  useEffect(() => {
    invoke<boolean>("check_scrcpy_available")
      .then(setScrcpyAvailable)
      .catch(() => setScrcpyAvailable(false));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("scrcpy-install-progress", (event) => {
      setInstallProgress((current) => [...current.slice(-9), event.payload]);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    syncMirrorState().catch(() => {
      applyMirrorState({ running: false, device_serial: null });
    });
    const timer = setInterval(() => {
      syncMirrorState().catch(() => {
        applyMirrorState({ running: false, device_serial: null });
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [applyMirrorState, syncMirrorState]);

  useEffect(() => {
    setDrawerQuery("");
    void loadDrawerApps(false);
  }, [loadDrawerApps]);

  const filteredDrawerGroups = useMemo(() => {
    const query = drawerQuery.trim().toLowerCase();
    const filteredApps = drawerApps.filter((app) => {
      if (!query) return true;
      return [app.label, app.package_name, app.activity_name, app.component_name]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    return groupLaunchableApps(filteredApps);
  }, [drawerApps, drawerQuery]);

  const filteredDrawerAppCount = filteredDrawerGroups.reduce(
    (count, group) => count + group.apps.length,
    0
  );

  const handleInstallScrcpy = async () => {
    if (installingScrcpy) return;
    setInstallingScrcpy(true);
    setStatus(null);
    setInstallProgress([t('screenMirror.startInstallScrcpy')]);
    try {
      const msg = await invoke<string>("install_scrcpy");
      setScrcpyAvailable(true);
      setStatus({ ok: true, msg });
    } catch (e) {
      setScrcpyAvailable(false);
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setInstallingScrcpy(false);
    }
  };

  const handleStartMirror = async () => {
    if (!deviceTarget.serial || mirrorLoading) return;
    setMirrorLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("start_screen_mirror", {
        deviceSerial: deviceTarget.serial,
        audioEnabled: mirrorAudioEnabled,
      });
      await syncMirrorState();
      setStatus({ ok: true, msg: `${msg} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}` });
    } catch (e) {
      syncMirrorState().catch(() => {
        applyMirrorState({ running: false, device_serial: null });
      });
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setMirrorLoading(false);
    }
  };

  const handleNavigationKey = async (key: "back" | "home") => {
    if (!deviceTarget.serial || navigationLoading) return;
    setNavigationLoading(key);
    setStatus(null);
    try {
      const msg = await invoke<string>("send_navigation_key", {
        deviceSerial: deviceTarget.serial,
        key,
      });
      setStatus({ ok: true, msg: `${msg} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}` });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setNavigationLoading(null);
    }
  };

  const handleStopMirror = async () => {
    if (mirrorLoading) return;
    setMirrorLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("stop_screen_mirror");
      await syncMirrorState();
      setStatus({ ok: true, msg });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setMirrorLoading(false);
    }
  };

  const handleLaunchApp = async (app: LaunchableApp) => {
    if (!deviceTarget.serial || launchingComponent) return;
    setLaunchingComponent(app.component_name);
    setDrawerStatus(null);
    try {
      const msg = await invoke<string>("adb_launch_app", {
        deviceSerial: deviceTarget.serial,
        componentName: app.component_name,
      });
      setDrawerStatus({ ok: true, msg: `${msg} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}` });
    } catch (e) {
      setDrawerStatus({ ok: false, msg: String(e) });
    } finally {
      setLaunchingComponent(null);
    }
  };

  const handleOpenExternalUrl = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    }
  };

  const renderScrcpyPanel = () => {
    if (scrcpyAvailable === null) {
      return (
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <SectionTitle icon={<IconDevicesPc size={17} />} label={t('screenMirror.title')} />
          <div className="mt-3 text-sm text-gray-500">{t('screenMirror.detectingScrcpy')}</div>
        </section>
      );
    }

    if (!scrcpyAvailable) {
      return (
        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <SectionTitle icon={<IconDevicesPc size={17} />} label={t('screenMirror.title')} />
          <p className="text-sm text-gray-500 mt-2">
            {t('screenMirror.scrcpyRequired')}
          </p>

          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="font-medium text-amber-800">{t('screenMirror.warmTip')}</div>
            <p>
              {t('screenMirror.warmTipDesc')}
            </p>
            <div className="space-y-1">
              <div>
                <span>{t('screenMirror.homebrewOfficial')}: </span>
                <button
                  type="button"
                  onClick={() => handleOpenExternalUrl("https://brew.sh/")}
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  https://brew.sh/
                </button>
              </div>
              <div>
                <span>{t('screenMirror.scrcpyOfficial')}: </span>
                <button
                  type="button"
                  onClick={() => handleOpenExternalUrl("https://github.com/Genymobile/scrcpy")}
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  https://github.com/Genymobile/scrcpy
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleInstallScrcpy}
            disabled={installingScrcpy}
            className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {installingScrcpy ? t('screenMirror.installing') : t('screenMirror.installScrcpy')}
          </button>

          {(installingScrcpy || installProgress.length > 0) && (
            <div className="mt-3 text-left text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
              {installProgress.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          )}

          {status && (
            <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {status.msg}
            </div>
          )}
        </section>
      );
    }

    return (
      <section className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <SectionTitle
            icon={<IconDevicesPc size={17} />}
            label={t('screenMirror.title')}
            description={t('screenMirror.openInteractive')}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartMirror}
              disabled={!deviceTarget.serial || mirroring || mirrorLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mirrorLoading && !mirroring ? t('screenMirror.starting') : t('screenMirror.startMirror')}
            </button>
            <button
              onClick={handleStopMirror}
              disabled={!mirroring || mirrorLoading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:bg-red-200 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
            >
              {mirrorLoading && mirroring ? t('screenMirror.stopping') : t('screenMirror.stopMirror')}
            </button>
          </div>
        </div>
        <DeviceTargetBanner target={deviceTarget} className="mb-4" />

        <label className={`mb-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 ${mirroring || mirrorLoading ? "opacity-60" : ""}`}>
          <input
            type="checkbox"
            checked={mirrorAudioEnabled}
            onChange={(event) => setMirrorAudioEnabled(event.target.checked)}
            disabled={mirroring || mirrorLoading}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-700">{t('screenMirror.audioCapture')}</span>
            <span className="mt-0.5 block text-xs leading-5 text-gray-500">{t('screenMirror.audioCaptureDesc')}</span>
          </span>
        </label>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">{t('screenMirror.navControl')}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleNavigationKey("back")}
              disabled={!deviceTarget.serial || Boolean(navigationLoading)}
              className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {navigationLoading === "back" ? t('screenMirror.sending') : t('screenMirror.back')}
            </button>
            <button
              type="button"
              onClick={() => handleNavigationKey("home")}
              disabled={!deviceTarget.serial || Boolean(navigationLoading)}
              className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {navigationLoading === "home" ? t('screenMirror.sending') : t('screenMirror.home')}
            </button>
          </div>
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs">
            <div className="font-medium text-blue-800">{t('screenMirror.mouseShortcutTitle')}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-white px-3 py-2">
                <span className="font-medium text-blue-800">{t('screenMirror.scrcpyRightClick')}</span>
                <span className="mx-1 text-blue-400">=</span>
                <span className="text-blue-700">{t('screenMirror.back')}</span>
              </div>
              <div className="rounded-md bg-white px-3 py-2">
                <span className="font-medium text-blue-800">{t('screenMirror.scrcpyMiddleClick')}</span>
                <span className="mx-1 text-blue-400">=</span>
                <span className="text-blue-700">{t('screenMirror.home')}</span>
              </div>
            </div>
          </div>
        </div>

        {installProgress.length > 0 && (
          <div className="mt-3 text-left text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            {installProgress.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        )}

        {status && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {status.msg}
          </div>
        )}
      </section>
    );
  };

  const renderAppDrawer = () => (
    <section className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          icon={<IconApps size={17} />}
          label={t('screenMirror.appDrawer')}
          description={t('screenMirror.appDrawerDesc')}
          color="teal"
        />
        <button
          type="button"
          onClick={() => loadDrawerApps(true)}
          disabled={!deviceTarget.serial || drawerLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconRefresh size={15} className={drawerLoading ? "animate-spin" : ""} />
          {t('screenMirror.refreshApps')}
        </button>
      </div>

      {deviceTarget.serial && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block min-w-0 flex-1">
            <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={drawerQuery}
              onChange={(event) => setDrawerQuery(event.target.value)}
              placeholder={t('screenMirror.searchApps')}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <div className="text-xs font-medium text-gray-500">
            {t('screenMirror.appsCount', { count: drawerApps.length })}
          </div>
        </div>
      )}

      {!deviceTarget.serial && <DeviceTargetBanner target={deviceTarget} className="mt-4" />}

      {drawerError && (
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
          <div>{drawerError}</div>
          <button
            type="button"
            onClick={() => loadDrawerApps(true)}
            className="mt-2 text-xs font-medium text-red-700 underline"
          >
            {t('screenMirror.retry')}
          </button>
        </div>
      )}

      {drawerLoading && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="min-h-[112px] animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mx-auto h-12 w-12 rounded-lg bg-gray-200" />
              <div className="mx-auto mt-3 h-3 w-16 rounded bg-gray-200" />
              <div className="mx-auto mt-2 h-2 w-20 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {!drawerLoading && !drawerError && deviceTarget.serial && filteredDrawerAppCount === 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-8 text-center text-sm text-gray-500">
          {t('screenMirror.noApps')}
        </div>
      )}

      {!drawerLoading && !drawerError && filteredDrawerAppCount > 0 && (
        <div className="mt-4 space-y-5">
          {filteredDrawerGroups.map((group) => (
            <div key={group.key}>
              <div className="mb-2 flex items-center gap-2 border-b border-gray-100 pb-2">
                <h4 className="text-sm font-semibold text-gray-700">{group.title}</h4>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {group.apps.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {group.apps.map((app) => {
                  const launching = launchingComponent === app.component_name;
                  return (
                    <button
                      key={app.component_name}
                      type="button"
                      title={app.component_name}
                      onClick={() => handleLaunchApp(app)}
                      disabled={!deviceTarget.serial || Boolean(launchingComponent)}
                      className="group flex min-h-[112px] flex-col items-center rounded-lg border border-gray-200 bg-white p-3 text-center shadow-sm transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-70"
                    >
                      {app.icon_data_url ? (
                        <img
                          src={app.icon_data_url}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <span className={`flex h-12 w-12 items-center justify-center rounded-lg text-base font-semibold text-white shadow-sm ${appIconClass(app.package_name)}`}>
                          {appInitial(app)}
                        </span>
                      )}
                      <span className="mt-2 w-full truncate text-sm font-medium text-gray-800">
                        {app.label}
                      </span>
                      <span className="mt-1 w-full truncate text-[11px] text-gray-500">
                        {app.package_name}
                      </span>
                      {launching && (
                        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                          <IconPlayerPlay size={12} />
                          {t('screenMirror.launchingApp')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerStatus && (
        <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${drawerStatus.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {drawerStatus.msg}
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-5xl space-y-4">
      {renderScrcpyPanel()}
      {renderAppDrawer()}

      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-1">{t('screenMirror.notes')}</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- {t('screenMirror.note1')}</li>
          <li>- {t('screenMirror.note2')}</li>
          <li>- {t('screenMirror.note3')}</li>
        </ul>
      </section>
    </div>
  );
}
