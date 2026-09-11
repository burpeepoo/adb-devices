import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Select, Tabs, TextInput } from "@mantine/core";
import { IconActivityHeartbeat } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { DeviceTargetState } from "../deviceTarget.ts";
import { buildNetworkCaptureExport, type NetworkRequest } from "../networkInspector.ts";
import { useNetworkCapture } from "../hooks/useNetworkCapture.ts";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import SectionTitle from "./common/SectionTitle";
import "./NetworkInspector.css";

interface Props { deviceTarget: DeviceTargetState }

function readableBody(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function requestPath(url: string): string {
  try { const value = new URL(url); return value.pathname + value.search; } catch { return url; }
}

function requestHost(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

function HeaderList({ headers }: { headers: Array<{ name: string; value: string }> }) {
  const { t } = useTranslation();
  if (!headers.length) return <p className="network-muted">{t("network.noHeaders")}</p>;
  return <dl className="network-header-list">{headers.map((header, index) => (
    <div key={`${header.name}-${index}`}><dt>{header.name}</dt><dd>{header.value}</dd></div>
  ))}</dl>;
}

function BodyView({ body }: { body: NetworkRequest["requestBody"] }) {
  const { t } = useTranslation();
  return <>
    <p className="network-muted">{t(`network.bodyStates.${body.state}`)}{body.bytes !== null ? ` · ${body.bytes.toLocaleString()} B` : ""}</p>
    {body.text && body.state !== "withheld" && <pre className="network-body">{readableBody(body.text)}</pre>}
  </>;
}

export default function NetworkInspector({ deviceTarget }: Props) {
  const { t } = useTranslation();
  const capture = useNetworkCapture(deviceTarget.selectedSerial, deviceTarget.serial);
  const [packages, setPackages] = useState<string[]>([]);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appsError, setAppsError] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ path?: string; failed?: boolean } | null>(null);

  useEffect(() => {
    setPackages([]);
    setPackageName(null);
    setSelection(null);
    setExportResult(null);
    setAppsError(false);
  }, [deviceTarget.selectedSerial]);

  useEffect(() => {
    let current = true;
    if (!deviceTarget.serial) { setLoadingApps(false); return; }
    setLoadingApps(true);
    void invoke<string[]>("adb_list_packages", { deviceSerial: deviceTarget.serial })
      .then((items) => {
        if (!current) return;
        setPackages(items);
        setPackageName(items.includes("com.cozyla.calendar") ? "com.cozyla.calendar" : null);
      })
      .catch(() => { if (current) setAppsError(true); })
      .finally(() => { if (current) setLoadingApps(false); });
    return () => { current = false; };
  }, [deviceTarget.serial]);

  const visibleRequests = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return capture.snapshot.requests.filter((request) => !filter ||
      `${request.method} ${request.url} ${request.statusCode ?? ""} ${request.error ?? ""}`.toLowerCase().includes(filter)).slice().reverse();
  }, [capture.snapshot.requests, query]);
  const selected = visibleRequests.find((request) => request.id === selection) ?? visibleRequests[0] ?? null;
  const queryParameters = useMemo(() => {
    try { return selected ? Array.from(new URL(selected.url).searchParams, ([name, value]) => ({ name, value })) : []; }
    catch { return []; }
  }, [selected?.url]);

  const exportCapture = async () => {
    if (!capture.capture || !capture.snapshot.requests.length || exporting) return;
    setExporting(true);
    setExportResult(null);
    try {
      const content = buildNetworkCaptureExport(capture.capture, capture.snapshot, {
        droppedLines: capture.droppedLines, status: capture.status,
      });
      const path = await invoke<string | null>("export_text_file", {
        defaultName: `${capture.capture.package_name}_requests_${capture.capture.started_at_ms}.json`, content,
      });
      if (path) setExportResult({ path });
    } catch { setExportResult({ failed: true }); }
    finally { setExporting(false); }
  };

  return <section className="network-page">
    <SectionTitle icon={<IconActivityHeartbeat size={20} />} label={t("tabs.network")} />
    <DeviceTargetBanner target={deviceTarget} />
    <div className="network-panel">
      <div className="network-toolbar">
        <Select
          label={t("network.app")}
          placeholder={loadingApps ? t("network.loadingApps") : t("network.chooseApp")}
          data={packages}
          searchable nothingFoundMessage={t("network.noApp")}
          value={packageName} onChange={setPackageName}
          disabled={!deviceTarget.serial || loadingApps || capture.running || capture.busy}
          className="network-app-select"
        />
        <div className="network-actions">
          {capture.running
            ? <Button onClick={() => void capture.stop()} disabled={capture.busy}>{t("network.stop")}</Button>
            : <Button onClick={() => { setSelection(null); setExportResult(null); void capture.start(packageName ?? ""); }} disabled={!packageName || !deviceTarget.serial || capture.busy}>{capture.busy ? t("network.working") : t("network.start")}</Button>}
          <Button variant="default" onClick={() => void exportCapture()} disabled={!capture.snapshot.requests.length || exporting}>{exporting ? t("network.exporting") : t("network.export")}</Button>
        </div>
      </div>
      <p className="network-source-note">{t("network.sourceNote")}</p>
      {appsError && <p className="network-notice" role="alert">{t("network.appsError")}</p>}
      {capture.error && <p className="network-notice" role="alert">{t(`network.errors.${capture.error}`, { defaultValue: t("network.errors.CAPTURE_READ_FAILED") })}</p>}
      {exportResult && <p className="network-notice" role="status">{exportResult.failed ? t("network.exportFailed") : t("network.exported", { path: exportResult.path })}</p>}
      {capture.capture && <div className="network-capture-summary" role="status">
        <span className={`network-capture-status${capture.running ? " is-running" : ""}`}>{t(`network.captureStates.${capture.status}`, { defaultValue: capture.status })}</span>
        <span>{capture.capture.package_name}</span>
        <span>{t("network.captureDevice", { serial: capture.capture.device_serial })}</span>
        <span>{t("network.requestCount", { count: capture.snapshot.requests.length })}</span>
        <span>{t("network.maskingNote")}</span>
      </div>}
      {(capture.droppedLines > 0 || capture.snapshot.droppedRequests > 0) && <p className="network-notice" role="status">{t("network.limits", { lines: capture.droppedLines, requests: capture.snapshot.droppedRequests })}</p>}
      <div className="network-workspace">
        <div className="network-list-pane">
          <TextInput aria-label={t("network.search")} placeholder={t("network.search")} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <div className="network-request-list" aria-label={t("network.requestList")}>
            {!visibleRequests.length && <div className="network-empty"><strong>{t(capture.running ? "network.waiting" : capture.snapshot.requests.length ? "network.noMatches" : "network.empty")}</strong><p>{t(capture.running ? "network.waitingHelp" : "network.emptyHelp")}</p></div>}
            {visibleRequests.map((request) => <button
              type="button" key={request.id} className={`network-request${selected?.id === request.id ? " is-selected" : ""}`}
              onClick={() => setSelection(request.id)} aria-pressed={selected?.id === request.id}
            >
              <span className="network-request-top"><strong>{request.method}</strong><span>{request.statusCode !== null ? `HTTP ${request.statusCode}` : t(`network.requestStates.${request.state}`)}</span><span>{request.durationMs !== null ? `${request.durationMs.toLocaleString()} ms` : ""}</span></span>
              <span className="network-request-path" title={request.url}>{requestPath(request.url)}</span>
              <span className="network-request-meta"><span>{requestHost(request.url)}</span><time>{request.startedAt}</time></span>
              {(request.state === "incomplete" || request.state === "failed") && <span className="network-request-warning">{t(`network.requestStates.${request.state}`)}</span>}
            </button>)}
          </div>
        </div>
        <div className="network-detail-pane">
          {!selected ? <div className="network-empty"><strong>{t("network.selectRequest")}</strong><p>{t("network.selectRequestHelp")}</p></div> : <>
            <div className="network-detail-heading"><strong>{selected.method}</strong><span>{selected.statusCode !== null ? `HTTP ${selected.statusCode}` : t(`network.requestStates.${selected.state}`)}</span><span>{selected.durationMs !== null ? `${selected.durationMs.toLocaleString()} ms` : ""}</span></div>
            <p className="network-full-url">{selected.url}</p>
            {selected.error && <p className="network-notice">{selected.error}</p>}
            {selected.warnings.length > 0 && <p className="network-notice">{t("network.incompleteNote")}</p>}
            <Tabs defaultValue="request" key={selected.id}>
              <Tabs.List><Tabs.Tab value="request">{t("network.request")}</Tabs.Tab><Tabs.Tab value="response">{t("network.response")}</Tabs.Tab></Tabs.List>
              <Tabs.Panel value="request" pt="md">
                {queryParameters.length > 0 && <><h3>{t("network.queryParameters")}</h3><HeaderList headers={queryParameters} /></>}
                <h3>{t("network.requestHeaders")}</h3><HeaderList headers={selected.requestHeaders} />
                <h3>{t("network.requestBody")}</h3><BodyView body={selected.requestBody} />
              </Tabs.Panel>
              <Tabs.Panel value="response" pt="md">
                <h3>{t("network.responseHeaders")}</h3><HeaderList headers={selected.responseHeaders} />
                <h3>{t("network.responseBody")}</h3><BodyView body={selected.responseBody} />
              </Tabs.Panel>
            </Tabs>
          </>}
        </div>
      </div>
    </div>
  </section>;
}
