import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogcatEntry } from "../types";
import { useTranslation } from "react-i18next";

interface Props {
  deviceSerial: string | null;
}

const LEVELS = ["ALL", "V", "D", "I", "W", "E", "F"] as const;
const AUTO_REFRESH_MS = 60000;

export default function Logcat({ deviceSerial }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogcatEntry[]>([]);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");
  const [tagFilter, setTagFilter] = useState("");
  const [pidFilter, setPidFilter] = useState("");
  const [query, setQuery] = useState("");
  const [adbFilter, setAdbFilter] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  const refreshLogcat = async () => {
    if (loading) return;
    setLoading(true);
    setStatus(null);
    try {
      const nextEntries = await invoke<LogcatEntry[]>("adb_read_logcat", {
        deviceSerial: deviceSerial || null,
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
  }, [active, adbFilter, deviceSerial, loading]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const normalizedTag = tagFilter.trim().toLowerCase();
    const normalizedPid = pidFilter.trim();
    const normalizedQuery = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (level !== "ALL" && entry.level !== level) return false;
      if (normalizedTag && !entry.tag.toLowerCase().includes(normalizedTag)) return false;
      if (normalizedPid && !entry.pid.includes(normalizedPid)) return false;
      if (!normalizedQuery) return true;

      return [entry.timestamp, entry.level, entry.pid, entry.tag, entry.message]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [entries, level, tagFilter, pidFilter, query]);

  const exportText = useMemo(
    () =>
      visibleEntries
        .map((entry) =>
          [entry.timestamp, entry.pid, entry.level, entry.tag ? `${entry.tag}:` : "", entry.message]
            .filter(Boolean)
            .join(" ")
        )
        .join("\n"),
    [visibleEntries]
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
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">{t('logcat.title')}</h3>
            <p className="text-xs text-gray-400 mt-1">
              {active ? t('logcat.autoRefresh') : t('logcat.clickToView')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshLogcat}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? t('logcat.refreshing') : active ? t('logcat.refresh') : t('logcat.viewLogcat')}
            </button>
            <button
              onClick={handleClose}
              disabled={!active}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('logcat.close')}
            </button>
            <button
              onClick={() => {
                setEntries([]);
                setStatus(null);
              }}
              disabled={entries.length === 0}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('logcat.clear')}
            </button>
            <button
              onClick={handleExport}
              disabled={!exportText || exporting}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? t('logcat.exporting') : t('logcat.export')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-500">{t('logcat.level')}</span>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as (typeof LEVELS)[number])}
              className="w-full h-10 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none"
            >
              {LEVELS.map((item) => (
                <option key={item} value={item}>
                  {item === "ALL" ? t('logcat.all') : item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Tag</span>
            <input
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="ActivityTaskManager"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">PID</span>
            <input
              value={pidFilter}
              onChange={(event) => setPidFilter(event.target.value)}
              placeholder="1234"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">{t('logcat.fullSearch')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('logcat.keyword')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">{t('logcat.adbFilter')}</span>
            <input
              value={adbFilter}
              onChange={(event) => setAdbFilter(event.target.value)}
              placeholder={t('logcat.adbFilterPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
        </div>

        <div
          ref={logRef}
          className="h-[520px] overflow-auto rounded-lg bg-gray-950 border border-gray-800 font-mono text-xs"
        >
          {visibleEntries.length > 0 ? (
            visibleEntries.map((entry, index) => (
              <div
                key={`${index}-${entry.timestamp}-${entry.pid}-${entry.tag}`}
                className={`grid grid-cols-[118px_64px_34px_180px_minmax(360px,1fr)] gap-2 px-3 py-1 border-b border-gray-900 ${levelRowClass(entry.level)}`}
              >
                <span className="text-gray-500">{highlight(entry.timestamp, query)}</span>
                <span className="text-gray-500">{highlight(entry.pid, query)}</span>
                <span className={`font-semibold ${levelTextClass(entry.level)}`}>{entry.level || "-"}</span>
                <span className="truncate text-gray-300">{highlight(entry.tag, query)}</span>
                <span className="whitespace-pre-wrap break-words text-gray-100">
                  {highlight(entry.message, query)}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-500">{t('logcat.noLog')}</div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>{t('logcat.readLatest')}</span>
          <span>
            {t('logcat.showCount', { visible: visibleEntries.length, total: entries.length })}
          </span>
        </div>

        {status && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {status.msg}
          </div>
        )}

        {!deviceSerial && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            {t('logcat.noDevice')}
          </div>
        )}
      </section>
    </div>
  );
}

function levelTextClass(level: string) {
  switch (level) {
    case "V":
      return "text-gray-400";
    case "D":
      return "text-blue-400";
    case "I":
      return "text-green-400";
    case "W":
      return "text-yellow-300";
    case "E":
      return "text-red-400";
    case "F":
      return "text-red-300 font-bold";
    default:
      return "text-gray-400";
  }
}

function levelRowClass(level: string) {
  switch (level) {
    case "W":
      return "bg-yellow-950/20";
    case "E":
    case "F":
      return "bg-red-950/25";
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
      <mark key={`${index}-${needle}`} className="bg-yellow-300 text-gray-950 rounded px-0.5">
        {value.slice(index, index + needle.length)}
      </mark>
    );
    offset = index + needle.length;
  }

  return pieces;
}
