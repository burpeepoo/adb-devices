import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  onInstalled: () => void;
}

export default function AdbSetup({ onInstalled }: Props) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("adb-install-progress", (event) => {
      setProgress((current) => [...current.slice(-7), event.payload]);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setProgress([t('adbSetup.startInstall')]);
    try {
      await invoke<string>("install_adb");
      setSuccess(true);
      setTimeout(onInstalled, 1000);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-gray-800 mb-2">{t('adbSetup.notInstalled')}</h2>
        <p className="text-gray-500 mb-6">
          {t('adbSetup.desc1')}
          <br />{t('adbSetup.desc2')}
        </p>

        {success ? (
          <div className="text-green-600 font-medium py-3">
            {t('adbSetup.installSuccess')}
          </div>
        ) : (
          <>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {installing ? t('adbSetup.installing') : t('adbSetup.install')}
            </button>

            {installing && (
              <div className="mt-3 text-left text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
                {progress.map((line, index) => (
                  <div key={`${line}-${index}`}>{line}</div>
                ))}
              </div>
            )}

            {error && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                {error}
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-gray-400 text-left">
          <p className="font-medium mb-1">{t('adbSetup.manualInstall')}</p>
          <p>macOS: <code className="bg-gray-100 px-1 rounded">brew install --cask android-platform-tools</code></p>
          <p className="mt-1">{t('adbSetup.windows')}</p>
        </div>
      </div>
    </div>
  );
}
