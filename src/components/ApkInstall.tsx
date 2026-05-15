import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

type InstallStatus = "pending" | "installing" | "success" | "failed";

interface ApkInstallItem {
  path: string;
  pkgName: string;
  parseFailed: boolean;
  status: InstallStatus;
  message: string;
}

interface Props {
  deviceSerial: string | null;
  recentApkDir: string;
  onRecentApkDirChange: (dir: string) => void;
}

export default function ApkInstall({ deviceSerial, recentApkDir, onRecentApkDirChange }: Props) {
  const { t } = useTranslation();
  const [apkItems, setApkItems] = useState<ApkInstallItem[]>([]);
  const [force, setForce] = useState(false);
  const [pkgSearch, setPkgSearch] = useState("");
  const [installedPackages, setInstalledPackages] = useState<string[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const installingRef = useRef(false);

  const firstApk = apkItems[0] ?? null;
  const singleApk = apkItems.length === 1 ? apkItems[0] : null;
  const progressPercent = apkItems.length > 0 ? Math.round((completedCount / apkItems.length) * 100) : 0;

  const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

  const updateItem = (path: string, patch: Partial<ApkInstallItem>) => {
    setApkItems((items) => items.map((item) => (item.path === path ? { ...item, ...patch } : item)));
  };

  const loadApkPaths = useCallback(async (paths: string[]) => {
    if (installingRef.current) return;

    const apkPaths = Array.from(
      new Set(paths.filter((path) => path.toLowerCase().endsWith(".apk"))),
    );
    if (apkPaths.length === 0) {
      setResult({ ok: false, msg: t('apkInstall.dropOnlyApk') });
      return;
    }

    setResult(null);
    setCompletedCount(0);
    setCurrentIndex(null);
    const firstPath = apkPaths[0];
    const separator = firstPath.includes("\\") ? "\\" : "/";
    const parentDir = firstPath.slice(0, firstPath.lastIndexOf(separator));
    if (parentDir) {
      onRecentApkDirChange(parentDir);
    }

    const parsedItems = await Promise.all(
      apkPaths.map(async (path) => {
        try {
          const parsedPkg = await invoke<string>("parse_apk_package", {
            apkPath: path,
          });
          return {
            path,
            pkgName: parsedPkg,
            parseFailed: false,
            status: "pending" as InstallStatus,
            message: "",
          };
        } catch {
          return {
            path,
            pkgName: "",
            parseFailed: true,
            status: "pending" as InstallStatus,
            message: "",
          };
        }
      }),
    );

    setApkItems(parsedItems);
    setPkgSearch(parsedItems[0]?.pkgName ?? "");
  }, [onRecentApkDirChange, t]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          return;
        }

        if (payload.type === "drop") {
          setDragging(false);
          void loadApkPaths(payload.paths);
          return;
        }

        setDragging(false);
      })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          unlisten = unsubscribe;
        }
      })
      .catch(() => {
        // Browser-only dev sessions do not expose Tauri drag-drop events.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadApkPaths]);

  const handleSelectApk = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "APK", extensions: ["apk"] }],
      title: t('apkInstall.selectApkTitle'),
      defaultPath: recentApkDir || undefined,
    });
    if (selected) {
      const selectedPaths = Array.isArray(selected) ? selected : [selected];
      const paths = selectedPaths.filter((path): path is string => typeof path === "string");
      await loadApkPaths(paths);
    }
  };

  const handleInstall = async () => {
    if (apkItems.length === 0 || installingRef.current) return;
    if (force && apkItems.some((item) => !item.pkgName.trim())) {
      setResult({
        ok: false,
        msg: apkItems.length === 1 ? t('apkInstall.forceNeedPkg') : t('apkInstall.forceNeedPkgMultiple'),
      });
      return;
    }
    installingRef.current = true;
    setInstalling(true);
    setCompletedCount(0);
    setCurrentIndex(0);
    setResult(null);

    setApkItems((items) =>
      items.map((item) => ({
        ...item,
        status: "pending",
        message: "",
      })),
    );

    let successCount = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < apkItems.length; index += 1) {
        const item = apkItems[index];
        setCurrentIndex(index);
        updateItem(item.path, { status: "installing", message: "" });

        try {
          const msg = await invoke<string>("adb_install", {
            apkPath: item.path,
            force,
            pkgName: force ? item.pkgName.trim() : null,
            deviceSerial: deviceSerial || null,
          });
          successCount += 1;
          updateItem(item.path, { status: "success", message: msg });
        } catch (e) {
          failedCount += 1;
          updateItem(item.path, { status: "failed", message: String(e) });
        }

        setCompletedCount(index + 1);
      }

      setResult({
        ok: failedCount === 0,
        msg: t('apkInstall.installSummary', { success: successCount, failed: failedCount }),
      });
    } finally {
      setCurrentIndex(null);
      installingRef.current = false;
      setInstalling(false);
    }
  };

  const handleLoadPackages = async () => {
    setLoadingPackages(true);
    setResult(null);
    try {
      const packages = await invoke<string[]>("adb_list_packages", {
        deviceSerial: deviceSerial || null,
      });
      setInstalledPackages(packages);
      setPkgSearch(singleApk?.pkgName ?? "");
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoadingPackages(false);
    }
  };

  const filteredPackages = pkgSearch
    ? installedPackages.filter((pkg) => pkg.toLowerCase().includes(pkgSearch.toLowerCase()))
    : installedPackages;

  return (
    <div className={`min-h-full space-y-4 rounded-lg transition-colors ${dragging ? "bg-blue-50/60" : ""}`}>
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-4">{t('apkInstall.title')}</h3>

        {/* APK selection */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">{t('apkInstall.apkFiles')}</label>
          <div
            className={`rounded-lg border p-3 transition-colors ${
              dragging ? "border-blue-400 bg-blue-50" : "border-dashed border-gray-300 bg-gray-50"
            }`}
          >
            <div className="mb-2 text-sm font-medium text-gray-700">
              {dragging ? t('apkInstall.dropHere') : t('apkInstall.dropHint')}
            </div>
            <div className="flex gap-2">
              <textarea
                value={apkItems.map((item) => item.path).join("\n")}
                readOnly
                rows={Math.min(Math.max(apkItems.length, 1), 4)}
                placeholder={t('apkInstall.selectApk')}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white resize-none"
              />
              <button
                onClick={handleSelectApk}
                disabled={installing}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                {t('apkInstall.selectFiles')}
              </button>
            </div>
          </div>
          {apkItems.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {t('apkInstall.selectedCount', { count: apkItems.length })}
            </p>
          )}
        </div>

        {/* Force install option */}
        <div className="mb-4 space-y-3">
          {firstApk?.pkgName && apkItems.length === 1 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('apkInstall.parsedPkg')}</label>
              <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50 font-mono">
                {firstApk.pkgName}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">{t('apkInstall.forceInstall')}</span>
          </label>

          {force && (
            <div className="space-y-2">
              {apkItems.length === 1 && singleApk && (
                <>
                  <label className="block text-xs text-gray-500 mb-1">{t('apkInstall.pkgName')}</label>
                  <input
                    type="text"
                    value={singleApk.pkgName}
                    onChange={(e) => {
                      updateItem(singleApk.path, { pkgName: e.target.value, parseFailed: false });
                      setPkgSearch(e.target.value);
                    }}
                    placeholder="com.example.app"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                  {singleApk.parseFailed && !singleApk.pkgName.trim() && (
                    <p className="text-xs text-red-600">{t('apkInstall.parseFailed')}</p>
                  )}
                </>
              )}

              {apkItems.length === 1 && (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleLoadPackages}
                      disabled={loadingPackages}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 disabled:opacity-50"
                    >
                      {loadingPackages ? t('apkInstall.loading') : t('apkInstall.loadFromInstalled')}
                    </button>
                    {installedPackages.length > 0 && (
                      <span className="text-xs text-gray-400">{t('apkInstall.searchHint')}</span>
                    )}
                  </div>
                  {installedPackages.length > 0 && singleApk && (
                    <div className="max-h-36 overflow-auto border border-gray-200 rounded-lg bg-white">
                      {filteredPackages.slice(0, 80).map((pkg) => (
                        <button
                          key={pkg}
                          onClick={() => {
                            updateItem(singleApk.path, { pkgName: pkg, parseFailed: false });
                            setPkgSearch(pkg);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-blue-50"
                        >
                          {pkg}
                        </button>
                      ))}
                      {filteredPackages.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">{t('apkInstall.noMatch')}</div>
                      )}
                    </div>
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {apkItems.length > 1 ? t('apkInstall.forceMultiDesc') : t('apkInstall.forceInstallDesc')}
              </p>
            </div>
          )}
        </div>

        {apkItems.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-gray-200">
            <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <span>{t('apkInstall.installQueue')}</span>
              {installing && currentIndex !== null && (
                <span>
                  {t('apkInstall.installingCurrent', {
                    current: currentIndex + 1,
                    total: apkItems.length,
                  })}
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {apkItems.map((item) => (
                <div key={item.path} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-800">{fileName(item.path)}</p>
                      {!force && item.pkgName && (
                        <p className="truncate font-mono text-xs text-gray-400">{item.pkgName}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        item.status === "success"
                          ? "bg-green-50 text-green-700"
                          : item.status === "failed"
                            ? "bg-red-50 text-red-600"
                            : item.status === "installing"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {t(`apkInstall.status.${item.status}`)}
                    </span>
                  </div>
                  {force && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={item.pkgName}
                        onChange={(e) => updateItem(item.path, { pkgName: e.target.value, parseFailed: false })}
                        disabled={installing}
                        placeholder={t('apkInstall.pkgName')}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50"
                      />
                      {item.parseFailed && !item.pkgName.trim() && (
                        <p className="mt-1 text-xs text-red-600">{t('apkInstall.parseFailed')}</p>
                      )}
                    </div>
                  )}
                  {item.message && (
                    <p
                      className={`mt-1 break-words text-xs ${
                        item.status === "success" ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {item.message}
                    </p>
                  )}
                  {!force && item.parseFailed && (
                    <p className="mt-1 text-xs text-gray-400">{t('apkInstall.parseFailedNonForce')}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {installing && (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>{t('apkInstall.progress')}</span>
              <span>
                {completedCount}/{apkItems.length}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {/* Install button */}
        <button
          onClick={handleInstall}
          disabled={installing || apkItems.length === 0}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {installing ? t('apkInstall.installing') : t('apkInstall.installSelected', { count: apkItems.length })}
        </button>

        {result && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            {t('apkInstall.noDevice')}
          </div>
        )}
      </section>

      {/* Info */}
      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-1">{t('apkInstall.notes')}</h4>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>- {t('apkInstall.note1')}</li>
          <li>- {t('apkInstall.note2')}</li>
          <li>- {t('apkInstall.note3')}</li>
          <li>- {t('apkInstall.note4')}</li>
        </ul>
      </section>
    </div>
  );
}
