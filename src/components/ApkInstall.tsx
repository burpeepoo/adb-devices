import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import PackageNameInput from "./PackageNameInput";
import { packageMatchScore } from "../utils/packageSearch";

type InstallStatus = "pending" | "installing" | "success" | "failed";

interface ApkInstallItem {
  path: string;
  pkgName: string;
  pkgEdited: boolean;
  parseFailed: boolean;
  status: InstallStatus;
  message: string;
}

interface Props {
  deviceSerial: string | null;
  recentApkDir: string;
  onRecentApkDirChange: (dir: string) => void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) return !target.readOnly;
  return false;
};

const splitClipboardPaths = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .map((line) => {
      if (!line.startsWith("file://")) return line;
      try {
        return decodeURIComponent(new URL(line).pathname);
      } catch {
        return line;
      }
    });

const pastedFilePaths = (event: ClipboardEvent<HTMLDivElement>) =>
  Array.from(event.clipboardData.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));

const bestPackageMatch = (item: ApkInstallItem, packages: string[]) => {
  const queries = [item.pkgName, fileName(item.path)].filter(Boolean);
  let best: { pkg: string; score: number } | null = null;

  for (const query of queries) {
    for (const pkg of packages) {
      const score = packageMatchScore(query, pkg);
      if (!best || score > best.score || (score === best.score && pkg.length < best.pkg.length)) {
        best = { pkg, score };
      }
    }
  }

  return best && best.score >= 240 ? best.pkg : null;
};

export default function ApkInstall({ deviceSerial, recentApkDir, onRecentApkDirChange }: Props) {
  const { t } = useTranslation();
  const [apkItems, setApkItems] = useState<ApkInstallItem[]>([]);
  const [force, setForce] = useState(false);
  const [installedPackages, setInstalledPackages] = useState<string[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const installingRef = useRef(false);
  const autoPackageLoadAttemptedRef = useRef(false);

  const progressPercent = apkItems.length > 0 ? Math.round((completedCount / apkItems.length) * 100) : 0;
  const apkPathKey = apkItems.map((item) => item.path).join("\n");

  const updateItem = (path: string, patch: Partial<ApkInstallItem>) => {
    setApkItems((items) => items.map((item) => (item.path === path ? { ...item, ...patch } : item)));
  };

  const removeItem = (path: string) => {
    if (installingRef.current) return;

    setApkItems((items) => items.filter((item) => item.path !== path));
    setCompletedCount(0);
    setCurrentIndex(null);
    setResult(null);
  };

  const loadApkPaths = useCallback(async (paths: string[]) => {
    if (installingRef.current) return;

    const apkPaths = await invoke<string[]>("resolve_apk_paths", { paths })
      .catch(() => paths.filter((path) => path.toLowerCase().endsWith(".apk")));
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

    const uniqueApkPaths = Array.from(new Set(apkPaths));
    const parsedItems = await Promise.all(
      uniqueApkPaths.map(async (path) => {
        try {
          const parsedPkg = await invoke<string>("parse_apk_package", {
            apkPath: path,
          });
          return {
            path,
            pkgName: parsedPkg,
            pkgEdited: false,
            parseFailed: false,
            status: "pending" as InstallStatus,
            message: "",
          };
        } catch {
          return {
            path,
            pkgName: "",
            pkgEdited: false,
            parseFailed: true,
            status: "pending" as InstallStatus,
            message: "",
          };
        }
      }),
    );

    setApkItems(parsedItems);
  }, [onRecentApkDirChange, t]);

  const handlePasteApks = useCallback(async () => {
    if (installingRef.current) return;

    try {
      const paths = await invoke<string[]>("read_clipboard_apk_paths");
      await loadApkPaths(paths);
      return;
    } catch {
      // Browser-only dev sessions do not expose the Tauri clipboard helper.
    }

    try {
      const text = await navigator.clipboard?.readText();
      await loadApkPaths(text ? text.split(/\r?\n/) : []);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  }, [loadApkPaths]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (installingRef.current || isEditableTarget(event.target)) return;

    event.preventDefault();
    const filePaths = pastedFilePaths(event);
    if (filePaths.length > 0) {
      void loadApkPaths(filePaths);
      return;
    }

    const text =
      event.clipboardData.getData("text/uri-list") ||
      event.clipboardData.getData("text/plain") ||
      event.clipboardData.getData("text");

    if (text.trim()) {
      void loadApkPaths(splitClipboardPaths(text));
      return;
    }

    void handlePasteApks();
  }, [handlePasteApks, loadApkPaths]);

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

  const handleLoadPackages = useCallback(async (options?: { showErrors?: boolean }) => {
    if (loadingPackages) return;
    const showErrors = options?.showErrors ?? true;
    setLoadingPackages(true);
    if (showErrors) {
      setResult(null);
    }
    try {
      const packages = await invoke<string[]>("adb_list_packages", {
        deviceSerial: deviceSerial || null,
      });
      setInstalledPackages(packages);
    } catch (e) {
      if (showErrors) {
        setResult({ ok: false, msg: String(e) });
      }
    } finally {
      setLoadingPackages(false);
    }
  }, [deviceSerial, loadingPackages]);

  useEffect(() => {
    autoPackageLoadAttemptedRef.current = false;
  }, [apkPathKey, deviceSerial]);

  useEffect(() => {
    if (!force || apkItems.length === 0 || installedPackages.length > 0 || loadingPackages || installing) return;
    if (autoPackageLoadAttemptedRef.current) return;

    autoPackageLoadAttemptedRef.current = true;
    const timer = window.setTimeout(() => {
      void handleLoadPackages({ showErrors: false });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [apkItems.length, force, handleLoadPackages, installedPackages.length, installing, loadingPackages]);

  useEffect(() => {
    if (!force || installedPackages.length === 0 || apkItems.length === 0) return;

    let changed = false;
    const suggestedItems = apkItems.map((item) => {
      if (item.pkgEdited) return item;

      const suggestedPkg = bestPackageMatch(item, installedPackages);
      if (!suggestedPkg || suggestedPkg === item.pkgName) return item;

      changed = true;
      return { ...item, pkgName: suggestedPkg };
    });

    if (changed) {
      setApkItems(suggestedItems);
    }
  }, [apkItems, force, installedPackages]);

  return (
    <div
      onPasteCapture={handlePaste}
      className={`flex h-full min-h-0 w-full min-w-0 max-w-full flex-col gap-4 overflow-hidden rounded-lg transition-colors ${dragging ? "bg-blue-50/60" : ""}`}
    >
      <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="mb-4 shrink-0 text-base font-semibold text-gray-800">{t('apkInstall.title')}</h3>

        {/* APK selection */}
        <div className="mb-4 shrink-0">
          <label className="block text-xs text-gray-500 mb-1">{t('apkInstall.apkFiles')}</label>
          <div
            tabIndex={0}
            className={`h-40 min-w-0 overflow-auto rounded-lg border p-3 transition-colors ${
              dragging ? "border-blue-400 bg-blue-50" : "border-dashed border-gray-300 bg-gray-50"
            }`}
          >
            <div className="mb-2 text-sm font-medium text-gray-700">
              {dragging ? t('apkInstall.dropHere') : t('apkInstall.dropHint')}
            </div>
            <div className="mb-2 text-xs text-gray-400">{t('apkInstall.pasteHint')}</div>
            <div className="flex min-w-0 gap-2">
              <textarea
                value={apkItems.map((item) => item.path).join("\n")}
                readOnly
                rows={3}
                placeholder={t('apkInstall.selectApk')}
                className="h-20 min-h-20 min-w-0 flex-1 resize-none overflow-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              <button
                onClick={handleSelectApk}
                disabled={installing}
                className="w-28 shrink-0 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('apkInstall.selectFiles')}
              </button>
              <button
                onClick={handlePasteApks}
                disabled={installing}
                className="w-24 shrink-0 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('apkInstall.pastePaths')}
              </button>
            </div>
          </div>
          <p className="mt-1 h-4 text-xs text-gray-400">
            {apkItems.length > 0 ? t('apkInstall.selectedCount', { count: apkItems.length }) : ""}
          </p>
        </div>

        {/* Force install option */}
        <div className="mb-4 shrink-0 space-y-3">
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
            <div className="space-y-1">
              <p className="mt-1 text-xs text-gray-400">
                {apkItems.length > 1 ? t('apkInstall.forceMultiDesc') : t('apkInstall.forceInstallDesc')}
              </p>
              <p className="text-xs text-gray-400">
                {loadingPackages ? t('apkInstall.loading') : t('apkInstall.searchHint')}
              </p>
            </div>
          )}
        </div>

        <div className="mb-4 min-h-0 flex-1">
          <div
            className={`flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 ${
              apkItems.length > 0 ? "" : "border-dashed bg-gray-50"
            }`}
          >
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
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden divide-y divide-gray-100">
              {apkItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">{t('apkInstall.selectApk')}</div>
              ) : (
                apkItems.map((item) => (
                  <div key={item.path} className="px-3 py-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_104px] items-start gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-gray-800">{fileName(item.path)}</p>
                        {!force && item.pkgName && (
                          <p className="truncate font-mono text-xs text-gray-400">{item.pkgName}</p>
                        )}
                      </div>
                      <div className="flex w-[104px] shrink-0 items-center justify-end gap-2">
                        <span
                          className={`w-16 rounded-full px-2 py-0.5 text-center text-xs ${
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
                        <button
                          type="button"
                          onClick={() => removeItem(item.path)}
                          disabled={installing}
                          title={t('apkInstall.removeFile')}
                          className="grid h-6 w-6 place-items-center rounded-full text-sm leading-none text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {force && (
                      <div className="mt-2">
                        <PackageNameInput
                          value={item.pkgName}
                          onChange={(pkgName) => updateItem(item.path, { pkgName, pkgEdited: true, parseFailed: false })}
                          onSelectPackage={(pkgName) => updateItem(item.path, { pkgName, pkgEdited: true, parseFailed: false })}
                          deviceSerial={deviceSerial}
                          disabled={installing}
                          placeholder={t('apkInstall.pkgName')}
                          packages={installedPackages}
                          loadingPackages={loadingPackages}
                          onLoadPackages={() => handleLoadPackages({ showErrors: true })}
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
                ))
              )}
            </div>
          </div>
        </div>

        {installing && (
          <div className="mb-4 shrink-0">
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
          className="w-full shrink-0 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
      <section className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-4">
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
