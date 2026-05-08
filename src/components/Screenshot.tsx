import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface Props {
  deviceSerial: string | null;
  saveDir: string;
  onSaveDirChange: (dir: string) => void;
}

export default function Screenshot({ deviceSerial, saveDir, onSaveDirChange }: Props) {
  const { t } = useTranslation();
  const [taking, setTaking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const handleScreenshot = useCallback(async (openPreview = false) => {
    if (!saveDir) {
      setResult({ ok: false, msg: t('screenshot.noSaveDir') });
      return;
    }
    if (taking) {
      return;
    }
    setTaking(true);
    setResult(null);
    try {
      const path = await invoke<string>("adb_screenshot", {
        saveDir,
        deviceSerial: deviceSerial || null,
      });
      setLastPath(path);
      if (openPreview) {
        try {
          await invoke("open_file", { path });
        } catch {
          // fallback: reveal in folder
        }
      }
      setResult({ ok: true, msg: t('screenshot.saved', { path }) });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setTaking(false);
    }
  }, [deviceSerial, saveDir, taking, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const isShortcut =
        event.ctrlKey &&
        event.shiftKey &&
        (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0");

      if (!isShortcut) {
        return;
      }

      event.preventDefault();
      void handleScreenshot(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleScreenshot]);

  const handleSelectSaveDir = async () => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        onSaveDirChange(dir);
        setResult({ ok: true, msg: t('screenshot.dirChanged', { dir }) });
      }
    } catch {
      setResult({ ok: false, msg: t('screenshot.changeDirFailed') });
    }
  };

  const handleOpenFolder = async () => {
    if (lastPath) {
      try {
        await invoke("reveal_path", { path: lastPath });
      } catch {
        setResult({ ok: false, msg: t('screenshot.openFolderFailed') });
      }
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-4">{t('screenshot.title')}</h3>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">{t('screenshot.saveDir')}</label>
          <div className="flex gap-2">
            <div className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-gray-50 truncate">
              {saveDir || t('screenshot.notSet')}
            </div>
            <button
              onClick={handleSelectSaveDir}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              {t('screenshot.changeDir')}
            </button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => handleScreenshot(false)}
            disabled={taking}
            className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {taking ? t('screenshot.taking') : t('screenshot.take')}
          </button>

          <button
            onClick={() => handleScreenshot(true)}
            disabled={taking}
            className="w-full py-3 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3h16.5a1.5 1.5 0 001.5-1.5V6.75a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v10.5a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V7.5z" />
            </svg>
            {taking ? t('screenshot.taking') : t('screenshot.takeAndPreview')}
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <div className="font-medium text-blue-800">{t('screenshot.shortcutTitle')}</div>
          <div className="mt-1">{t('screenshot.shortcutHint')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-md bg-white px-2 py-1 ring-1 ring-blue-100">
              {t('screenshot.shortcutMac')}
            </span>
            <span className="rounded-md bg-white px-2 py-1 ring-1 ring-blue-100">
              {t('screenshot.shortcutWindows')}
            </span>
          </div>
        </div>

        {result && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.msg}
          </div>
        )}

        {lastPath && (
          <button
            onClick={handleOpenFolder}
            className="mt-2 text-xs text-blue-500 hover:text-blue-700"
          >
            {t('screenshot.showInFolder')}
          </button>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            {t('screenshot.noDevice')}
          </div>
        )}
      </section>
    </div>
  );
}
