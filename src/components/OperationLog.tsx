import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Group, Text, TextInput } from "@mantine/core";
import { IconClipboardList, IconDownload, IconRefresh, IconTrash } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { OperationLogEntry, OperationLogSnapshot } from "../types";
import SectionTitle from "./common/SectionTitle";
import "./OperationLog.css";

const LOG_LIMIT = 2000;

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

function statusClass(status: string): string {
  if (status === "success") return "is-success";
  if (status === "started" || status === "info") return "is-info";
  if (status === "timeout" || status === "cancelled") return "is-warning";
  return "is-error";
}

function mergeEntries(...batches: OperationLogEntry[][]): OperationLogEntry[] {
  const byId = new Map<number, OperationLogEntry>();
  batches.flat().forEach((entry) => byId.set(entry.id, entry));
  return [...byId.values()].sort((left, right) => left.id - right.id).slice(-LOG_LIMIT);
}

export default function OperationLog() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<OperationLogSnapshot>({
    entries: [],
    path: null,
    persistence_error: null,
    oldest_id: null,
    latest_id: null,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  // Once an event has supplied persistence state, it is newer than any
  // in-flight snapshot request. Keep it authoritative until another event
  // updates it, so a late snapshot cannot hide a current disk error.
  const persistenceErrorRef = useRef<string | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const generation = generationRef.current;
    try {
      const next = await invoke<OperationLogSnapshot>("get_operation_logs", { limit: LOG_LIMIT });
      if (generation !== generationRef.current) return;
      const observedPersistenceError = persistenceErrorRef.current;
      setSnapshot((current) => {
        const newerEvents = next.latest_id === null
          ? current.entries
          : current.entries.filter((entry) => entry.id > next.latest_id!);
        return {
          ...next,
          persistence_error: observedPersistenceError === undefined
            ? next.persistence_error
            : observedPersistenceError,
          entries: mergeEntries(next.entries, newerEvents),
        };
      });
      const effectivePersistenceError = observedPersistenceError === undefined
        ? next.persistence_error
        : observedPersistenceError;
      setNotice(effectivePersistenceError ? { tone: "error", message: effectivePersistenceError } : null);
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const registrations = [listen<OperationLogEntry>("operation-log-updated", (event) => {
      if (cancelled) return;
      setSnapshot((current) => {
        const entries = mergeEntries(current.entries, [event.payload]);
        return {
          ...current,
          entries,
          oldest_id: entries[0]?.id ?? null,
          latest_id: entries[entries.length - 1]?.id ?? null,
        };
      });
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    }), listen("operation-log-cleared", () => {
      if (cancelled) return;
      generationRef.current += 1;
      persistenceErrorRef.current = null;
      selectedIdRef.current = null;
      setSnapshot((current) => ({ ...current, entries: [], oldest_id: null, latest_id: null }));
      setSelectedId(null);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    }), listen<string | null>("operation-log-persistence-error", (event) => {
      if (cancelled) return;
      persistenceErrorRef.current = event.payload;
      setSnapshot((current) => ({ ...current, persistence_error: event.payload }));
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    })];
    void Promise.allSettled(registrations).then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [refresh]);

  useEffect(() => {
    const current = selectedIdRef.current;
    if (current !== null && snapshot.entries.some((entry) => entry.id === current)) return;
    const next = snapshot.entries[snapshot.entries.length - 1]?.id ?? null;
    selectedIdRef.current = next;
    setSelectedId(next);
  }, [snapshot.entries]);

  const visibleEntries = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return snapshot.entries
      .filter((entry) => !filter || [entry.action, entry.command, entry.device_serial, entry.status, entry.stdout, entry.stderr, entry.error]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(filter))
      .slice()
      .reverse();
  }, [query, snapshot.entries]);

  const selected = visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0] ?? null;

  const exportLogs = async () => {
    if (!snapshot.entries.length || exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      const content = JSON.stringify({
        exported_at: new Date().toISOString(),
        log_path: snapshot.path,
        entries: snapshot.entries,
      }, null, 2);
      const path = await invoke<string | null>("export_text_file", {
        defaultName: `adb_manager_operation_log_${Date.now()}.json`,
        content,
      });
      if (path) setNotice({ tone: "info", message: t("operationLog.exported", { path }) });
    } catch (error) {
      setNotice({ tone: "error", message: `${t("operationLog.exportFailed")}: ${String(error)}` });
    } finally {
      setExporting(false);
    }
  };

  const clearLogs = async () => {
    if (!snapshot.entries.length || !window.confirm(t("operationLog.clearConfirm"))) return;
    try {
      await invoke("clear_operation_logs");
      setNotice({ tone: "info", message: t("operationLog.cleared") });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    }
  };

  const statusLabel = (status: string) => t(`operationLog.status.${status}`, { defaultValue: status });

  return (
    <section className="operation-log-page">
      <SectionTitle
        icon={<IconClipboardList size={20} />}
        label={t("tabs.operationLog")}
        description={t("operationLog.description")}
      />
      <div className="operation-log-panel">
        <div className="operation-log-toolbar">
          <TextInput
            aria-label={t("operationLog.search")}
            placeholder={t("operationLog.search")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="operation-log-search"
          />
          <Group gap="sm" className="operation-log-actions">
            <Button leftSection={<IconRefresh size={16} />} variant="default" onClick={() => void refresh()} disabled={loading}>
              {loading ? t("operationLog.refreshing") : t("operationLog.refresh")}
            </Button>
            <Button leftSection={<IconDownload size={16} />} variant="default" onClick={() => void exportLogs()} disabled={!snapshot.entries.length || exporting}>
              {exporting ? t("operationLog.exporting") : t("operationLog.export")}
            </Button>
            <Button leftSection={<IconTrash size={16} />} variant="default" onClick={() => void clearLogs()} disabled={!snapshot.entries.length}>
              {t("operationLog.clear")}
            </Button>
          </Group>
        </div>
        <div className="operation-log-meta" role="status">
          <span>{t("operationLog.count", { count: snapshot.entries.length })}</span>
          <span title={snapshot.path || undefined}>{snapshot.path ? t("operationLog.path", { path: snapshot.path }) : t("operationLog.pathUnavailable")}</span>
          <span>{t("operationLog.masking")}</span>
        </div>
        {snapshot.persistence_error && (
          <p className="operation-log-notice is-error" role="alert">
            {t("operationLog.persistenceError", { error: snapshot.persistence_error })}
          </p>
        )}
        {notice && <p className={`operation-log-notice is-${notice.tone}`} role="status">{notice.message}</p>}
        <div className="operation-log-workspace">
          <div className="operation-log-list-pane" aria-label={t("operationLog.list")}>
            {!visibleEntries.length && (
              <div className="operation-log-empty">
                <strong>{query ? t("operationLog.noMatches") : t("operationLog.empty")}</strong>
                <p>{query ? t("operationLog.noMatchesHelp") : t("operationLog.emptyHelp")}</p>
              </div>
            )}
            {visibleEntries.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={`operation-log-entry${selected?.id === entry.id ? " is-selected" : ""}`}
                onClick={() => {
                  selectedIdRef.current = entry.id;
                  setSelectedId(entry.id);
                }}
                aria-pressed={selected?.id === entry.id}
              >
                <span className="operation-log-entry-top">
                  <strong>{entry.action}</strong>
                  <Badge className={`operation-log-status ${statusClass(entry.status)}`} variant="light">{statusLabel(entry.status)}</Badge>
                  <span>{entry.duration_ms.toLocaleString()} ms</span>
                </span>
                <span className="operation-log-command" title={entry.command}>{entry.command}</span>
                <span className="operation-log-entry-meta">
                  <span>{entry.device_serial || t("operationLog.local")}</span>
                  <time dateTime={new Date(entry.timestamp_ms).toISOString()}>{formatTimestamp(entry.timestamp_ms)}</time>
                </span>
              </button>
            ))}
          </div>
          <div className="operation-log-detail-pane">
            {!selected ? (
              <div className="operation-log-empty"><strong>{t("operationLog.selectEntry")}</strong><p>{t("operationLog.selectEntryHelp")}</p></div>
            ) : (
              <>
                <div className="operation-log-detail-heading">
                  <strong>{selected.action}</strong>
                  <Badge className={`operation-log-status ${statusClass(selected.status)}`} variant="light">{statusLabel(selected.status)}</Badge>
                  <span>{formatTimestamp(selected.timestamp_ms)}</span>
                </div>
                <p className="operation-log-full-command">{selected.command}</p>
                {selected.error && <p className="operation-log-error" role="alert">{selected.error}</p>}
                <OutputBlock label={t("operationLog.stdout")} value={selected.stdout} emptyLabel={t("operationLog.noOutput")} />
                <OutputBlock label={t("operationLog.stderr")} value={selected.stderr} emptyLabel={t("operationLog.noOutput")} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function OutputBlock({ label, value, emptyLabel }: { label: string; value: string; emptyLabel: string }) {
  return (
    <section className="operation-log-output">
      <Text fw={600} size="sm">{label}</Text>
      {value ? <pre>{value}</pre> : <p className="operation-log-no-output">{emptyLabel}</p>}
    </section>
  );
}
