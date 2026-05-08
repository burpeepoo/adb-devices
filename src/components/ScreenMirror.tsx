import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  deviceSerial: string | null;
  onMirrorStateChange: (deviceSerial: string | null) => void;
}

interface MirrorState {
  running: boolean;
  device_serial: string | null;
}

export default function ScreenMirror({ deviceSerial, onMirrorStateChange }: Props) {
  const { t } = useTranslation();
  const [scrcpyAvailable, setScrcpyAvailable] = useState<boolean | null>(null);
  const [installingScrcpy, setInstallingScrcpy] = useState(false);
  const [installProgress, setInstallProgress] = useState<string[]>([]);
  const [mirroring, setMirroring] = useState(false);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [mirrorAudioEnabled, setMirrorAudioEnabled] = useState(false);
  const [navigationLoading, setNavigationLoading] = useState<"back" | "home" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

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
    if (!deviceSerial || mirrorLoading) return;
    setMirrorLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("start_screen_mirror", {
        deviceSerial,
        audioEnabled: mirrorAudioEnabled,
      });
      await syncMirrorState();
      setStatus({ ok: true, msg });
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
    if (!deviceSerial || navigationLoading) return;
    setNavigationLoading(key);
    setStatus(null);
    try {
      const msg = await invoke<string>("send_navigation_key", {
        deviceSerial,
        key,
      });
      setStatus({ ok: true, msg });
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

  const handleOpenExternalUrl = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    }
  };

  if (scrcpyAvailable === null) {
    return (
      <div className="max-w-3xl space-y-4">
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-800">{t('screenMirror.title')}</h3>
          <div className="mt-3 text-sm text-gray-500">{t('screenMirror.detectingScrcpy')}</div>
        </section>
      </div>
    );
  }

  if (!scrcpyAvailable) {
    return (
      <div className="max-w-3xl space-y-4">
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-800">{t('screenMirror.title')}</h3>
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
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">{t('screenMirror.title')}</h3>
            <p className="text-xs text-gray-400 mt-1">{t('screenMirror.openInteractive')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartMirror}
              disabled={!deviceSerial || mirroring || mirrorLoading}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleNavigationKey("back")}
                disabled={!deviceSerial || Boolean(navigationLoading)}
                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {navigationLoading === "back" ? t('screenMirror.sending') : t('screenMirror.back')}
              </button>
              <button
                type="button"
                onClick={() => handleNavigationKey("home")}
                disabled={!deviceSerial || Boolean(navigationLoading)}
                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {navigationLoading === "home" ? t('screenMirror.sending') : t('screenMirror.home')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="font-medium text-blue-800">{t('screenMirror.scrcpyRightClick')}</div>
                <div className="mt-0.5 text-blue-600">{t('screenMirror.equalsBack')}</div>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="font-medium text-blue-800">{t('screenMirror.scrcpyMiddleClick')}</div>
                <div className="mt-0.5 text-blue-600">{t('screenMirror.equalsHome')}</div>
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

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">{t('screenMirror.selectDevice')}</div>
        )}
      </section>

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
