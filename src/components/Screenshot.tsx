import { useState } from "react";
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

  const handleScreenshot = async () => {
    if (!saveDir) {
      setResult({ ok: false, msg: t('screenshot.noSaveDir') });
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
      setResult({ ok: true, msg: t('screenshot.saved', { path }) });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setTaking(false);
    }
  };

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

        <button
          onClick={handleScreenshot}
          disabled={taking}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {taking ? t('screenshot.taking') : t('screenshot.take')}
        </button>

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
