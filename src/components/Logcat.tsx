import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogcatEntry } from "../types";
import { useTranslation } from "react-i18next";
import { Button as MantineButton, Checkbox, Menu } from "@mantine/core";
import { IconChevronDown, IconListDetails } from "@tabler/icons-react";
import SectionTitle from "./common/SectionTitle";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import type { DeviceTargetState } from "../deviceTarget.ts";
import "./Logcat.css";

interface Props {
  deviceTarget: DeviceTargetState;
}

const LEVELS = ["V", "D", "I", "W", "E", "F"] as const;
const AUTO_REFRESH_MS = 60000;
type LogcatLevel = (typeof LEVELS)[number];

export default function Logcat({ deviceTarget }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogcatEntry[]>([]);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedLevels, setSelectedLevels] = useState<LogcatLevel[]>([...LEVELS]);
  const [tagFilter, setTagFilter] = useState("");
  const [pidFilter, setPidFilter] = useState("");
  const [query, setQuery] = useState("");
  const [adbFilter, setAdbFilter] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  const refreshLogcat = async () => {
    if (loading) return;
    if (!deviceTarget.serial) {
      setStatus({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const nextEntries = await invoke<LogcatEntry[]>("adb_read_logcat", {
        deviceSerial: deviceTarget.serial,
        logcatFilter: adbFilter.trim() || null,
        lineLimit: 1000,
      });
      setEntries(nextEntries);
      setActive(true);
      setStatus({ ok: true, msg: t('logcat.refreshed', { count: nextEntries.length }) });
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      refreshLogcat();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, adbFilter, deviceTarget, loading]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const normalizedTag = tagFilter.trim().toLowerCase();
    const normalizedPid = pidFilter.trim();
    const normalizedQuery = query.trim().toLowerCase();
    const selectedLevelSet = new Set(selectedLevels);
    const allLevelsSelected = selectedLevelSet.size === LEVELS.length;

    return entries.filter((entry) => {
      if (!allLevelsSelected && !selectedLevelSet.has(entry.level as LogcatLevel)) return false;
      if (normalizedTag && !entry.tag.toLowerCase().includes(normalizedTag)) return false;
      if (normalizedPid && !entry.pid.includes(normalizedPid)) return false;
      if (!normalizedQuery) return true;

      return [entry.timestamp, entry.level, entry.pid, entry.tag, entry.message]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [entries, selectedLevels, tagFilter, pidFilter, query]);

  const toggleLevel = (nextLevel: LogcatLevel) => {
    setSelectedLevels((current) => {
      if (current.includes(nextLevel)) {
        return current.filter((item) => item !== nextLevel);
      }
      return [...current, nextLevel];
    });
  };

  const allLevelsSelected = selectedLevels.length === LEVELS.length;
  const selectedLevelSummary = allLevelsSelected
    ? t('logcat.all')
    : selectedLevels.length
      ? selectedLevels.join(", ")
      : t('logcat.none');

  const exportText = useMemo(
    () =>
      [
        deviceTarget.status === "ready" ? `Device: ${deviceTarget.label} (${deviceTarget.identity})` : "",
        deviceTarget.status === "ready" ? "" : "",
        ...visibleEntries.map((entry) =>
          [entry.timestamp, entry.pid, entry.level, entry.tag ? `${entry.tag}:` : "", entry.message]
            .filter(Boolean)
            .join(" ")
        ),
      ].filter((line, index) => line || index > 1).join("\n"),
    [deviceTarget, visibleEntries]
  );

  const handleClose = async () => {
    setActive(false);
    setStatus({ ok: true, msg: t('logcat.autoRefreshClosed') });
    await invoke("adb_stop_logcat").catch(() => {
      // Snapshot mode does not keep a process alive.
    });
  };

  const handleExport = async () => {
    if (!exportText || exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const savedPath = await invoke<string | null>("export_text_file", {
        defaultName: `logcat_${timestamp}.txt`,
        content: exportText,
      });
      if (savedPath) {
        setStatus({ ok: true, msg: t('logcat.exported', { path: savedPath }) });
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="logcat-page">
      <section className="logcat-panel">
        <div className="logcat-header">
          <SectionTitle
            icon={<IconListDetails size={17} />}
            label={t('logcat.title')}
            description={active ? t('logcat.autoRefresh') : t('logcat.clickToView')}
          />
          <div className="logcat-actions">
            <button
              onClick={refreshLogcat}
              disabled={loading || !deviceTarget.serial}
              className="logcat-action is-primary"
            >
              {loading ? t('logcat.refreshing') : active ? t('logcat.refresh') : t('logcat.viewLogcat')}
            </button>
            <button
              onClick={handleClose}
              disabled={!active}
              className="logcat-action"
            >
              {t('logcat.close')}
            </button>
            <button
              onClick={() => {
                setEntries([]);
                setStatus(null);
              }}
              disabled={entries.length === 0}
              className="logcat-action"
            >
              {t('logcat.clear')}
            </button>
            <button
              onClick={handleExport}
              disabled={!exportText || exporting}
              className="logcat-action"
            >
              {exporting ? t('logcat.exporting') : t('logcat.export')}
            </button>
          </div>
        </div>
        <DeviceTargetBanner target={deviceTarget} className="logcat-target" />

        <div className="logcat-filters">
          <div className="logcat-field">
            <span className="logcat-field__label">{t('logcat.level')}</span>
            <Menu closeOnItemClick={false} position="bottom-start" width={220} shadow="md" withinPortal>
              <Menu.Target>
                <MantineButton
                  className="logcat-level-button"
                  variant="default"
                  fullWidth
                  h={40}
                  rightSection={<IconChevronDown size={14} />}
                  styles={{
                    inner: { justifyContent: "space-between" },
                    label: { minWidth: 0 },
                  }}
                >
                  <span className="truncate">
                    {t('logcat.level')}: {selectedLevelSummary}
                  </span>
                </MantineButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t('logcat.level')}</Menu.Label>
                <div className="space-y-2 px-3 py-2">
                  <Checkbox
                    checked={allLevelsSelected}
                    indeterminate={selectedLevels.length > 0 && !allLevelsSelected}
                    label={t('logcat.allLevels')}
                    onChange={() => setSelectedLevels([...LEVELS])}
                  />
                  {LEVELS.map((item) => (
                    <Checkbox
                      key={item}
                      checked={selectedLevels.includes(item)}
                      label={item}
                      onChange={() => toggleLevel(item)}
                    />
                  ))}
                </div>
              </Menu.Dropdown>
            </Menu>
          </div>
          <label className="logcat-field">
            <span className="logcat-field__label">Tag</span>
            <input
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="ActivityTaskManager"
              className="logcat-input"
            />
          </label>
          <label className="logcat-field">
            <span className="logcat-field__label">PID</span>
            <input
              value={pidFilter}
              onChange={(event) => setPidFilter(event.target.value)}
              placeholder="1234"
              className="logcat-input"
            />
          </label>
          <label className="logcat-field">
            <span className="logcat-field__label">{t('logcat.fullSearch')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('logcat.keyword')}
              className="logcat-input"
            />
          </label>
          <label className="logcat-field">
            <span className="logcat-field__label">{t('logcat.adbFilter')}</span>
            <input
              value={adbFilter}
              onChange={(event) => setAdbFilter(event.target.value)}
              placeholder={t('logcat.adbFilterPlaceholder')}
              className="logcat-input"
            />
          </label>
        </div>

        <div
          ref={logRef}
          className="logcat-console"
        >
          {visibleEntries.length > 0 ? (
            visibleEntries.map((entry, index) => (
              <div
                key={`${index}-${entry.timestamp}-${entry.pid}-${entry.tag}`}
                className={`logcat-row ${levelRowClass(entry.level)}`}
              >
                <span className="logcat-row__time">{highlight(entry.timestamp, query)}</span>
                <span className="logcat-row__pid">{highlight(entry.pid, query)}</span>
                <span className={`logcat-row__level ${levelTextClass(entry.level)}`}>{entry.level || "-"}</span>
                <span className="logcat-row__tag">{highlight(entry.tag, query)}</span>
                <span className="logcat-row__message">
                  {highlight(entry.message, query)}
                </span>
              </div>
            ))
          ) : (
            <div className="logcat-empty">{t('logcat.noLog')}</div>
          )}
        </div>

        <div className="logcat-footer">
          <span>{t('logcat.readLatest')}</span>
          <span>
            {t('logcat.showCount', { visible: visibleEntries.length, total: entries.length })}
          </span>
        </div>

        {status && (
          <div className={`logcat-status ${status.ok ? "is-ok" : "is-error"}`}>
            {status.msg}
          </div>
        )}
      </section>
    </div>
  );
}

function levelTextClass(level: string) {
  switch (level) {
    case "V":
      return "is-verbose";
    case "D":
      return "is-debug";
    case "I":
      return "is-info";
    case "W":
      return "is-warning";
    case "E":
      return "is-error";
    case "F":
      return "is-fatal";
    default:
      return "is-verbose";
  }
}

function levelRowClass(level: string) {
  switch (level) {
    case "W":
      return "is-warning";
    case "E":
    case "F":
      return "is-error";
    default:
      return "";
  }
}

function highlight(value: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return value;

  const lowerValue = value.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const pieces: ReactNode[] = [];
  let offset = 0;

  while (offset < value.length) {
    const index = lowerValue.indexOf(lowerNeedle, offset);
    if (index === -1) {
      pieces.push(value.slice(offset));
      break;
    }
    if (index > offset) {
      pieces.push(value.slice(offset, index));
    }
    pieces.push(
      <mark key={`${index}-${needle}`} className="logcat-highlight">
        {value.slice(index, index + needle.length)}
      </mark>
    );
    offset = index + needle.length;
  }

  return pieces;
}
