import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExportedApk, ExportedPackageLogs, LogPathCandidate, PackageInfo } from "../types";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FocusTrap } from "@mantine/core";
import SectionTitle from "./common/SectionTitle";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import { deviceTargetResultSuffix, type DeviceTargetState } from "../deviceTarget.ts";
import { toolIcons, toolLabelKeys } from "../toolMetadata";
import {
  LOGCAT_CUSTOM_RANGE,
  LOGCAT_RANGE_VALUES,
  MAX_LOGCAT_LOOKBACK_MINUTES,
  logcatRangeAmount,
  resolveLogcatLookbackSeconds,
} from "../logcatTimeRange";
import "./PackageList.css";

interface Props {
  deviceTarget: DeviceTargetState;
}

type SortKey = "name" | "version_name" | "version_code" | "device_serial" | "build_number";
type SortDirection = "asc" | "desc";

export default function PackageList({ deviceTarget }: Props) {
  const { t } = useTranslation();
  const PackageIcon = toolIcons.packages;
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [exportingPackage, setExportingPackage] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportedApk | null>(null);
  const [logDialogPackage, setLogDialogPackage] = useState<string | null>(null);
  const [detectedLogPaths, setDetectedLogPaths] = useState<LogPathCandidate[]>([]);
  const [selectedLogPath, setSelectedLogPath] = useState("");
  const [detectingLogs, setDetectingLogs] = useState(false);
  const [pullingLogsPackage, setPullingLogsPackage] = useState<string | null>(null);
  const [logDialogError, setLogDialogError] = useState<string | null>(null);
  const [logsResult, setLogsResult] = useState<ExportedPackageLogs | null>(null);
  const [selectedLogcatRange, setSelectedLogcatRange] = useState(String(6 * 60 * 60));
  const [customLogcatMinutes, setCustomLogcatMinutes] = useState("60");
  const logDetectionRequest = useRef(0);
  const logDialogTrigger = useRef<HTMLButtonElement | null>(null);
  const logcatLookbackSeconds = resolveLogcatLookbackSeconds(
    selectedLogcatRange,
    customLogcatMinutes,
  );

  const deviceError = () =>
    t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`);
  const restoreLogDialogFocus = () => {
    window.setTimeout(() => logDialogTrigger.current?.focus(), 0);
  };

  const handleList = useCallback(async () => {
    if (!deviceTarget.serial) {
      setError(deviceError());
      return;
    }
    setLoading(true);
    setError(null);
    setExportResult(null);
    setLogsResult(null);
    try {
      const result = await invoke<PackageInfo[]>("adb_list_package_details", {
        deviceSerial: deviceTarget.serial,
      });
      setPackages(result);
    } catch (e) {
      setPackages([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceTarget, t]);

  const filtered = search
    ? packages.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : packages;
  const sorted = [...filtered].sort((a, b) => {
    const aValue = a[sortKey] || "";
    const bValue = b[sortKey] || "";
    const result = aValue.localeCompare(bValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return sortDirection === "asc" ? result : -result;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  const handleCopyPackageName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setError(null);
    } catch {
      setError(t('packageList.copyFailed'));
    }
  };

  const handleExportApk = async (name: string) => {
    if (!deviceTarget.serial) {
      setError(deviceError());
      return;
    }
    setExportingPackage(name);
    setError(null);
    setExportResult(null);
    try {
      const result = await invoke<ExportedApk>("adb_export_package_apk", {
        packageName: name,
        deviceSerial: deviceTarget.serial,
      });
      setExportResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportingPackage(null);
    }
  };

  const detectLogPaths = async (name: string): Promise<LogPathCandidate[] | null> => {
    if (!deviceTarget.serial) {
      setLogDialogError(deviceError());
      return null;
    }
    const requestId = ++logDetectionRequest.current;
    setDetectingLogs(true);
    setLogDialogError(null);
    try {
      const result = await invoke<LogPathCandidate[]>("adb_detect_package_log_paths", {
        packageName: name,
        deviceSerial: deviceTarget.serial,
      });
      if (requestId !== logDetectionRequest.current) return null;
      setDetectedLogPaths(result);
      const automaticPath = result.find((candidate) =>
        ["cozyla-package", "app-external", "app-media"].includes(candidate.source),
      );
      setSelectedLogPath(automaticPath?.path || "");
      return result;
    } catch (e) {
      if (requestId !== logDetectionRequest.current) return null;
      setDetectedLogPaths([]);
      setLogDialogError(String(e));
      return null;
    } finally {
      if (requestId === logDetectionRequest.current) setDetectingLogs(false);
    }
  };

  const pullLogs = async (name: string, path: string) => {
    if (!deviceTarget.serial) {
      setLogDialogError(deviceError());
      return;
    }
    if (logcatLookbackSeconds === null) {
      setLogDialogError(t("packageList.logcatRangeInvalid"));
      return;
    }
    setPullingLogsPackage(name);
    setLogDialogError(null);
    setError(null);
    try {
      const result = await invoke<ExportedPackageLogs>("adb_pull_package_logs", {
        packageName: name,
        remotePath: path.trim() || null,
        includeLogcat: true,
        logcatLookbackSeconds: logcatLookbackSeconds,
        deviceSerial: deviceTarget.serial,
      });
      setLogsResult(result);
      logDetectionRequest.current += 1;
      setLogDialogPackage(null);
      setDetectedLogPaths([]);
      setSelectedLogPath("");
      restoreLogDialogFocus();
    } catch (e) {
      setLogDialogError(String(e));
    } finally {
      setPullingLogsPackage(null);
    }
  };

  const openLogDialog = async (name: string, trigger: HTMLButtonElement) => {
    if (!deviceTarget.serial) {
      setError(deviceError());
      return;
    }
    logDialogTrigger.current = trigger;
    setError(null);
    setLogDialogPackage(name);
    setDetectedLogPaths([]);
    setSelectedLogPath("");
    setLogDialogError(null);
    const result = await detectLogPaths(name);
    if (!result) return;
  };

  const closeLogDialog = () => {
    if (pullingLogsPackage) return;
    logDetectionRequest.current += 1;
    setLogDialogPackage(null);
    setDetectingLogs(false);
    setDetectedLogPaths([]);
    setSelectedLogPath("");
    setLogDialogError(null);
    restoreLogDialogFocus();
  };

  const handlePullLogs = async () => {
    if (!logDialogPackage || !deviceTarget.serial) {
      setLogDialogError(deviceError());
      return;
    }
    await pullLogs(logDialogPackage, selectedLogPath);
  };

  const logPathSourceLabel = (source: string) => {
    const key = `packageList.logPathSources.${source}`;
    const translated = t(key);
    return translated === key ? source : translated;
  };

  const handleRevealExport = async (path: string) => {
    try {
      await invoke("reveal_path", { path });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="card card-flush h-full flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <SectionTitle icon={<PackageIcon size={17} />} label={t(toolLabelKeys.packages)} mb="sm" />
        <DeviceTargetBanner target={deviceTarget} className="mb-3" />
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleList}
            disabled={loading || !deviceTarget.serial}
            className="btn btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('packageList.loading') : t('packageList.loadPkgInfo')}
          </button>
          {packages.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('packageList.searchPkg')}
              className="input flex-1"
            />
          )}
        </div>
        {error && (
          <div className="text-sm px-4 py-3 rounded-lg bg-red-50 text-red-600">
            {error}
          </div>
        )}
        {exportResult && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm px-4 py-3 rounded-lg bg-green-50 text-green-700">
            <span>
              {t('packageList.exportedApk', {
                package: exportResult.package_name,
                count: exportResult.files.length,
                path: exportResult.output_dir,
              })}
              {" · "}
              {deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}
            </span>
            <button
              type="button"
              onClick={() => handleRevealExport(exportResult.output_dir)}
              className="text-green-800 hover:text-green-900"
            >
              {t('packageList.revealExport')}
            </button>
          </div>
        )}
        {logsResult && (
          <div className="package-list-result mt-2 text-sm">
            <div>
              {t("packageList.logsCollected", {
                package: logsResult.package_name,
                path: logsResult.output_dir,
              })}
              {" · "}
              {deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}
            </div>
            <button
              type="button"
              onClick={() => handleRevealExport(logsResult.output_dir)}
              className="package-list-result-link"
            >
              {t("packageList.revealLogs")}
            </button>
            {logsResult.warnings.length > 0 && (
              <div className="package-list-result-warning">
                {logsResult.warnings.join(" ")}
              </div>
            )}
            <div className="package-list-result-hint">
              {logsResult.logcat_file
                ? t("packageList.logcatAttached", {
                    lines: logsResult.logcat_line_count,
                    scope: logsResult.logcat_scope || t("packageList.logcatScopeUnknown"),
                    range: formatPackageLogcatRange(logsResult, t),
                    coverage: formatPackageLogcatCoverage(logsResult, t),
                  })
                : t("packageList.logcatNotAttached")}
            </div>
            <div className="package-list-result-hint">{t("packageList.logcatScopeHint")}</div>
          </div>
        )}
      </div>

      <div className="package-list-table-wrap flex-1 overflow-auto">
        {sorted.length > 0 ? (
          <table className="package-list-table">
            <colgroup>
              <col className="package-list-col-name" />
              <col className="package-list-col-version" />
              <col className="package-list-col-code" />
              <col className="package-list-col-serial" />
              <col className="package-list-col-build" />
              <col className="package-list-col-actions" />
            </colgroup>
            <thead className="sticky top-0 bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("name")} className="hover:text-gray-800">
                    {t('packageList.pkgName')}{sortIndicator("name")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("version_name")} className="hover:text-gray-800">
                    {t('packageList.versionName')}{sortIndicator("version_name")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("version_code")} className="hover:text-gray-800">
                    {t('packageList.versionCode')}{sortIndicator("version_code")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("device_serial")} className="hover:text-gray-800">
                    {t('packageList.serialNumber')}{sortIndicator("device_serial")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">
                  <button onClick={() => handleSort("build_number")} className="hover:text-gray-800">
                    {t('packageList.buildNumber')}{sortIndicator("build_number")}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">{t('packageList.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pkg) => (
                <tr key={`${pkg.device_serial}:${pkg.name}`} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="package-list-cell package-list-name" title={pkg.name}>{pkg.name}</td>
                  <td className="package-list-cell package-list-value">{pkg.version_name || "-"}</td>
                  <td className="package-list-cell package-list-value">{pkg.version_code || "-"}</td>
                  <td className="package-list-cell package-list-value" title={pkg.device_serial}>{pkg.device_serial || "-"}</td>
                  <td className="package-list-cell package-list-build" title={pkg.build_number}>{pkg.build_number || "-"}</td>
                  <td className="package-list-cell package-list-actions-cell">
                    <div className="package-list-actions">
                      <button
                        onClick={() => handleCopyPackageName(pkg.name)}
                        className="chip package-list-action"
                      >
                        {t('packageList.copyPkgName')}
                      </button>
                      <button
                        onClick={() => handleExportApk(pkg.name)}
                        disabled={exportingPackage !== null || !deviceTarget.serial}
                        className="chip package-list-action disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {exportingPackage === pkg.name ? t('packageList.exportingApk') : t('packageList.exportApk')}
                      </button>
                      <button
                        onClick={(event) => openLogDialog(pkg.name, event.currentTarget)}
                        disabled={pullingLogsPackage !== null || !deviceTarget.serial}
                        className="chip package-list-action package-list-action-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {pullingLogsPackage === pkg.name ? t('packageList.pullingLogs') : t('packageList.pullLogs')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          loading ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {t('packageList.readingPkg')}
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-gray-400">
              {deviceTarget.serial ? t('packageList.clickToLoad') : t('packageList.selectDevice')}
            </div>
          )
        )}
      </div>

      {packages.length > 0 && (
        <div className="p-2 border-t border-gray-200 text-xs text-gray-400 text-center">
          {t('packageList.totalPackages', { sorted: sorted.length, total: packages.length })}
        </div>
      )}

      {logDialogPackage && (
        <div
          className="package-log-dialog-backdrop"
          role="presentation"
          onMouseDown={closeLogDialog}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeLogDialog();
            }
          }}
        >
          <FocusTrap active>
            <section
              className="package-log-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="package-log-dialog-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
            <div className="package-log-dialog-header">
              <div>
                <h2 id="package-log-dialog-title">{t("packageList.logDialogTitle")}</h2>
                <p>{logDialogPackage}</p>
              </div>
              <button type="button" className="package-log-dialog-close" onClick={closeLogDialog} aria-label={t("packageList.cancel")} data-autofocus>
                ×
              </button>
            </div>

            <p className="package-log-dialog-hint">{t("packageList.logDialogHint")}</p>

            <div className="package-log-detection-row">
              <span>{t("packageList.detectedPaths")}</span>
              <button type="button" className="chip package-list-action" onClick={() => void detectLogPaths(logDialogPackage)} disabled={detectingLogs || Boolean(pullingLogsPackage)}>
                {detectingLogs ? t("packageList.detectingLogs") : t("packageList.redetectLogs")}
              </button>
            </div>

            {detectedLogPaths.length > 0 ? (
              <div className="package-log-path-options">
                {detectedLogPaths.map((candidate) => (
                  <button
                    type="button"
                    key={candidate.path}
                    className={`package-log-path-option${selectedLogPath === candidate.path ? " is-selected" : ""}`}
                    onClick={() => setSelectedLogPath(candidate.path)}
                  >
                    <span className="package-log-path-option-path">{candidate.path}</span>
                    <span className="package-log-path-option-source">{logPathSourceLabel(candidate.source)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="package-log-empty">{detectingLogs ? t("packageList.detectingLogs") : t("packageList.noDetectedPaths")}</p>
            )}

            <label className="package-log-path-field">
              <span>{t("packageList.logPathLabel")}</span>
              <input
                value={selectedLogPath}
                onChange={(event) => setSelectedLogPath(event.target.value)}
                placeholder={t("packageList.logPathPlaceholder")}
                spellCheck={false}
                autoComplete="off"
              />
              <small>{t("packageList.logPathManualHint")}</small>
            </label>

            <label className="package-log-range-field">
              <span>{t("packageList.logcatTimeRange")}</span>
              <div className="package-log-range-control">
                <select
                  value={selectedLogcatRange}
                  onChange={(event) => setSelectedLogcatRange(event.target.value)}
                  disabled={Boolean(pullingLogsPackage)}
                >
                  {LOGCAT_RANGE_VALUES.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {formatPackageRangeOption(seconds, t)}
                    </option>
                  ))}
                  <option value={LOGCAT_CUSTOM_RANGE}>{t("packageList.logcatCustomRange")}</option>
                </select>
                {selectedLogcatRange === LOGCAT_CUSTOM_RANGE && (
                  <input
                    type="number"
                    min={1}
                    max={MAX_LOGCAT_LOOKBACK_MINUTES}
                    step={1}
                    value={customLogcatMinutes}
                    onChange={(event) => setCustomLogcatMinutes(event.target.value)}
                    aria-label={t("packageList.logcatCustomMinutes")}
                    disabled={Boolean(pullingLogsPackage)}
                  />
                )}
              </div>
              <small>{t("packageList.logcatTimeRangeHint")}</small>
            </label>

            {logDialogError && <div className="package-log-dialog-error">{logDialogError}</div>}

            <div className="package-log-dialog-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeLogDialog} disabled={Boolean(pullingLogsPackage)}>
                {t("packageList.cancel")}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handlePullLogs()} disabled={Boolean(pullingLogsPackage) || !selectedLogPath.trim()}>
                {pullingLogsPackage ? t("packageList.pullingLogs") : t("packageList.collectLogs")}
              </button>
            </div>
            </section>
          </FocusTrap>
        </div>
      )}
    </div>
  );
}

function formatPackageRangeOption(seconds: number, t: TFunction) {
  if (seconds === 0) return t("packageList.logcatAllAvailable");
  const amount = logcatRangeAmount(seconds);
  return t(
    amount.unit === "hours"
      ? "packageList.logcatRangeHours"
      : "packageList.logcatRangeMinutes",
    { count: amount.count },
  );
}

function formatPackageLogcatRange(
  result: ExportedPackageLogs,
  t: TFunction,
) {
  if (result.logcat_all_available || result.logcat_lookback_seconds === null) {
    return t("packageList.logcatAllAvailable");
  }
  return formatPackageRangeOption(result.logcat_lookback_seconds, t);
}

function formatPackageLogcatCoverage(
  result: ExportedPackageLogs,
  t: TFunction,
) {
  if (!result.logcat_source_start || !result.logcat_source_end) {
    return t("packageList.logcatNoCoverage");
  }
  return `${result.logcat_source_start} – ${result.logcat_source_end}`;
}
