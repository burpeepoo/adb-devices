import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { IconApps } from "@tabler/icons-react";
import PackageNameInput from "./PackageNameInput";
import SectionTitle from "./common/SectionTitle";
import { deviceTargetResultSuffix, type DeviceTargetState } from "../deviceTarget.ts";

type InstallStatus = "pending" | "installing" | "success" | "failed";

interface ApkInstallItem {
  path: string;
  pkgName: string;
  parseFailed: boolean;
  status: InstallStatus;
  message: string;
}

interface Props {
  deviceTarget: DeviceTargetState;
  recentApkDir: string;
  onRecentApkDirChange: (dir: string) => void;
  active: boolean;
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

export default function ApkInstall({ deviceTarget, recentApkDir, onRecentApkDirChange, active }: Props) {
  const { t } = useTranslation();
  const [apkItems, setApkItems] = useState<ApkInstallItem[]>([]);
  const [force, setForce] = useState(false);
  const [packageLookup, setPackageLookup] = useState<{ serial: string; packages: string[] | null } | null>(null);
  const [packageRetry, setPackageRetry] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const installingRef = useRef(false);

  const progressPercent = apkItems.length > 0 ? Math.round((completedCount / apkItems.length) * 100) : 0;
  const queuePanelSizeClass = force ? "min-h-[180px]" : "min-h-[140px]";
  const packageSerial = active && force && apkItems.length > 0 && !installing ? deviceTarget.serial : null;
  const currentLookup = packageLookup?.serial === packageSerial ? packageLookup : null;
  const loadingPackages = Boolean(packageSerial && !currentLookup);
  const packageLoadFailed = currentLookup?.packages === null;
  const packageSearchHint = deviceTarget.serial
    ? t('apkInstall.searchHint')
    : t(deviceTarget.blockReason === "selected-device-not-online" ? "deviceTarget.selectedUnavailable" : "deviceTarget.selectOnlineDevice");

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
    if (!active) {
      setDragging(false);
      return;
    }

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
  }, [active, loadApkPaths]);

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
    if (!deviceTarget.serial) {
      setResult({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }
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
            deviceSerial: deviceTarget.serial,
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
        msg: `${t('apkInstall.installSummary', { success: successCount, failed: failedCount })} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}`,
      });
    } finally {
      setCurrentIndex(null);
      installingRef.current = false;
      setInstalling(false);
    }
  };

  useEffect(() => {
    setPackageLookup(null);
    if (!packageSerial) return;

    let current = true;
    const timer = window.setTimeout(() => {
      void invoke<string[]>("adb_list_packages", { deviceSerial: packageSerial })
        .then((packages) => {
          if (current) setPackageLookup({ serial: packageSerial, packages });
        })
        .catch(() => {
          if (current) setPackageLookup({ serial: packageSerial, packages: null });
        });
    }, 350);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [packageSerial, packageRetry]);

  return (
    <div
      onPasteCapture={handlePaste}
      className={`apk-install-page flex h-full min-h-0 w-full min-w-0 max-w-full flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-lg pb-3 transition-colors ${dragging ? "bg-blue-50/60" : ""}`}
    >
      <section className="apk-install-card flex min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white p-4">
        <div className="shrink-0">
          <SectionTitle icon={<IconApps size={17} />} label={t('apkInstall.title')} mb="md" />
        </div>

        {/* APK selection */}
        <div className="mb-4 shrink-0">
          <label className="block text-xs text-gray-500 mb-1">{t('apkInstall.apkFiles')}</label>
          <div
            tabIndex={0}
            className={`h-44 min-w-0 overflow-auto rounded-lg border p-3 transition-colors ${
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
                className="h-24 min-h-24 min-w-0 flex-1 resize-none overflow-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
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
                {loadingPackages ? t('apkInstall.loading') : packageLoadFailed ? t('apkInstall.packageLoadFailed') : packageSearchHint}
              </p>
            </div>
          )}
        </div>

        <div className={`apk-install-queue-panel mb-4 flex min-w-0 min-h-0 flex-none flex-col ${queuePanelSizeClass}`}>
          <div
            className={`flex h-full w-full min-w-0 flex-col ${queuePanelSizeClass} overflow-hidden rounded-lg border border-gray-200 ${
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
            <div className="apk-install-queue-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden divide-y divide-gray-100">
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
                          onChange={(pkgName) => updateItem(item.path, { pkgName, parseFailed: false })}
                          deviceSerial={deviceTarget.serial}
                          disabled={installing}
                          placeholder={t('apkInstall.pkgName')}
                          packages={currentLookup?.packages ?? null}
                          loadingPackages={loadingPackages}
                          onLoadPackages={packageLoadFailed ? () => setPackageRetry((attempt) => attempt + 1) : undefined}
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

        <div className="apk-install-action-bar shrink-0 border-t border-gray-100 bg-white pt-3 pb-3">
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

          <button
            onClick={handleInstall}
            disabled={installing || apkItems.length === 0 || !deviceTarget.serial}
            className="w-full shrink-0 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {installing ? t('apkInstall.installing') : t('apkInstall.installSelected', { count: apkItems.length })}
          </button>

          {result && (
            <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {result.msg}
            </div>
          )}
        </div>
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
