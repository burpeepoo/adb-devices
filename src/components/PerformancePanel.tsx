import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge, Button, Group, Paper, Select, Stack, Table, Text } from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconPinned,
  IconPinnedOff,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import ResultAlert from "./common/ResultAlert";
import SectionTitle from "./common/SectionTitle";
import type { DeviceTargetState } from "../deviceTarget.ts";
import type { PerformanceSample, PerformanceStreamSnapshot } from "../types";
import type { PerformanceGpuDiagnostic, PerformanceTrendPoint } from "../performanceSampling.ts";
import {
  buildPerformanceCsvExport,
  buildPerformanceDisplaySnapshot,
  buildPerformanceGpuDiagnostic,
  buildPerformanceJsonExport,
  buildPerformanceTrendPoints,
  calculatePerformanceMetrics,
  PERFORMANCE_DEFAULT_FAST_INTERVAL_MS,
  PERFORMANCE_FAST_INTERVAL_OPTIONS_MS,
  initialPerformanceCadenceMarks,
  isPerformanceSampleTimeout,
  nextPerformancePollDueMs,
  nextPerformanceStreamPollIntervalMs,
  normalizePerformanceFastIntervalMs,
  prunePerformanceSamples,
  shouldIncludeFrameSample,
  shouldIncludeSlowSample,
  withPerformanceSampleTimeout,
} from "../performanceSampling.ts";

interface Props {
  deviceTarget: DeviceTargetState;
  active: boolean;
}

interface AlertItem {
  key: string;
  message: string;
}

export default function PerformancePanel({ deviceTarget, active }: Props) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<PerformanceSample[]>([]);
  const [lockedPackage, setLockedPackage] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastSampleCompletedAtMs, setLastSampleCompletedAtMs] = useState<number | null>(null);
  const [sampleIntervalMs, setSampleIntervalMs] = useState(PERFORMANCE_DEFAULT_FAST_INTERVAL_MS);
  const inFlightRef = useRef(false);
  const queuedManualSampleRef = useRef(false);
  const streamKeyRef = useRef<string | null>(null);
  const streamSerialRef = useRef<string | null>(null);
  const streamFallbackRef = useRef(false);
  const lastStreamSampleTimestampRef = useRef<number | null>(null);
  const samplesRef = useRef<PerformanceSample[]>([]);
  const lastSlowSampleMsRef = useRef<number | null>(null);
  const lastFrameSampleMsRef = useRef<number | null>(null);
  const deviceSerial = deviceTarget.serial;

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const previous = samples.length >= 2 ? samples[samples.length - 2] : null;
  const metrics = useMemo(() => calculatePerformanceMetrics(previous, latest), [latest, previous]);
  const displaySnapshot = useMemo(() => buildPerformanceDisplaySnapshot(samples), [samples]);
  const displaySample = displaySnapshot?.sample ?? null;
  const displayMetrics = displaySnapshot?.metrics ?? metrics;
  const trendPoints = useMemo(() => buildPerformanceTrendPoints(samples), [samples]);
  const gpuDiagnostic = useMemo(
    () => buildPerformanceGpuDiagnostic(displaySample, displayMetrics.gpuUsagePercent),
    [displayMetrics.gpuUsagePercent, displaySample],
  );
  const alerts = useMemo(() => buildAlerts(samples, latest, t), [latest, samples, t]);
  const currentPackage = lockedPackage || displaySample?.target_package || displaySample?.foreground_package || null;
  const waitingForFirstSample = running && samples.length === 0;
  const emptyValue = waitingForFirstSample ? t("performance.collectingValue") : "-";
  const intervalOptions = useMemo(
    () =>
      PERFORMANCE_FAST_INTERVAL_OPTIONS_MS.map((value) => ({
        value: String(value),
        label: intervalLabel(value, t),
      })),
    [t],
  );

  const seedCadence = useCallback((now = Date.now()) => {
    const marks = initialPerformanceCadenceMarks(now);
    lastSlowSampleMsRef.current = marks.lastSlowSampleMs;
    lastFrameSampleMsRef.current = marks.lastFrameSampleMs;
  }, []);

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  const stopPerformanceStream = useCallback(async () => {
    const serial = streamSerialRef.current;
    streamKeyRef.current = null;
    streamSerialRef.current = null;
    lastStreamSampleTimestampRef.current = null;
    if (!serial) return;
    try {
      await invoke("adb_performance_stream_stop", { deviceSerial: serial });
    } catch {
      // The stream may already have exited; the next start will replace it.
    }
  }, []);

  const ensurePerformanceStream = useCallback(async () => {
    if (!deviceSerial || streamFallbackRef.current) return null;
    const followForeground = !lockedPackage;
    const streamKey = `${deviceSerial}|${lockedPackage || ""}|${followForeground ? "follow" : "locked"}|${sampleIntervalMs}`;
    if (streamKeyRef.current === streamKey) {
      return invoke<PerformanceStreamSnapshot>("adb_performance_stream_snapshot", { deviceSerial });
    }
    if (streamSerialRef.current && streamSerialRef.current !== deviceSerial) {
      await stopPerformanceStream();
    }
    const snapshot = await invoke<PerformanceStreamSnapshot>("adb_performance_stream_start", {
      deviceSerial,
      targetPackage: lockedPackage,
      followForeground,
      intervalMs: sampleIntervalMs,
    });
    streamKeyRef.current = streamKey;
    streamSerialRef.current = deviceSerial;
    lastStreamSampleTimestampRef.current = null;
    return snapshot;
  }, [deviceSerial, lockedPackage, sampleIntervalMs, stopPerformanceStream]);

  const collectStreamSample = useCallback(async () => {
    const snapshot = await ensurePerformanceStream();
    if (snapshot && !snapshot.active) {
      throw new Error(snapshot.last_error || "performance stream exited");
    }
    const sample = snapshot?.last_sample;
    if (!sample) return true;
    const timestamp = Number(sample.timestamp_ms);
    if (lastStreamSampleTimestampRef.current === timestamp) {
      return true;
    }
    lastStreamSampleTimestampRef.current = timestamp;
    setSamples((current) => prunePerformanceSamples([...current, sample], timestamp || Date.now()));
    setLastSampleCompletedAtMs(timestamp || Date.now());
    setStatus(snapshot.last_error ? { ok: false, msg: snapshot.last_error } : null);
    return true;
  }, [ensurePerformanceStream]);

  const collectOneShotSample = useCallback(async () => {
    const now = Date.now();
    const includeSlow = shouldIncludeSlowSample(now, lastSlowSampleMsRef.current);
    const includeFrameStats = shouldIncludeFrameSample(now, lastFrameSampleMsRef.current);
    const sample = await withPerformanceSampleTimeout(
      invoke<PerformanceSample>("adb_performance_sample", {
        deviceSerial,
        targetPackage: lockedPackage,
        followForeground: !lockedPackage,
        includeSlow,
        includeFrameStats,
      }),
    );
    if (includeSlow) lastSlowSampleMsRef.current = now;
    if (includeFrameStats) lastFrameSampleMsRef.current = now;
    setSamples((current) => prunePerformanceSamples([...current, sample], Number(sample.timestamp_ms)));
    setLastSampleCompletedAtMs(Number(sample.timestamp_ms) || Date.now());
    setStatus(null);
    return true;
  }, [deviceSerial, lockedPackage]);

  const collectSample = useCallback(async ({ queueIfBusy = false } = {}) => {
    if (!deviceSerial) return false;
    if (inFlightRef.current) {
      if (queueIfBusy) {
        queuedManualSampleRef.current = true;
      }
      return true;
    }
    inFlightRef.current = true;

    try {
      if (!streamFallbackRef.current) {
        try {
          return await collectStreamSample();
        } catch (error) {
          streamFallbackRef.current = true;
          setStatus({ ok: false, msg: t("performance.streamFallback", { reason: String(error) }) });
          await stopPerformanceStream();
        }
      }
      await collectOneShotSample();
      return true;
    } catch (error) {
      setStatus({ ok: false, msg: isPerformanceSampleTimeout(error) ? t("performance.sampleTimeout") : String(error) });
      return false;
    } finally {
      inFlightRef.current = false;
      if (queuedManualSampleRef.current && deviceSerial) {
        queuedManualSampleRef.current = false;
        window.setTimeout(() => {
          void collectSample();
        }, 0);
      }
    }
  }, [collectOneShotSample, collectStreamSample, deviceSerial, stopPerformanceStream, t]);

  const start = useCallback(() => {
    if (!deviceSerial) {
      setStatus({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }
    setStatus(null);
    streamFallbackRef.current = false;
    seedCadence();
    setRunning(true);
    setStartedAtMs((current) => current ?? Date.now());
  }, [deviceSerial, deviceTarget.blockReason, seedCadence, t]);

  const pause = useCallback(() => {
    setRunning(false);
    void stopPerformanceStream();
    setStatus({ ok: true, msg: t("performance.paused") });
  }, [stopPerformanceStream, t]);

  const clear = useCallback(() => {
    const now = Date.now();
    setSamples([]);
    setStatus(null);
    setLastSampleCompletedAtMs(null);
    lastStreamSampleTimestampRef.current = null;
    setStartedAtMs(running ? now : null);
    if (running) {
      seedCadence(now);
    } else {
      lastSlowSampleMsRef.current = null;
      lastFrameSampleMsRef.current = null;
    }
  }, [running, seedCadence]);

  useEffect(() => {
    const now = Date.now();
    void stopPerformanceStream();
    streamFallbackRef.current = false;
    setSamples([]);
    setLockedPackage(null);
    setStartedAtMs(null);
    setStatus(null);
    setLastSampleCompletedAtMs(null);
    if (deviceSerial) {
      seedCadence(now);
      setRunning(true);
      setStartedAtMs(now);
    } else {
      lastSlowSampleMsRef.current = null;
      lastFrameSampleMsRef.current = null;
      setRunning(false);
    }
  }, [deviceSerial, seedCadence, stopPerformanceStream]);

  useEffect(() => () => {
    void stopPerformanceStream();
  }, [stopPerformanceStream]);

  useEffect(() => {
    if (active && deviceSerial && !running && samples.length === 0) {
      start();
    }
  }, [active, deviceSerial, running, samples.length, start]);

  useEffect(() => {
    if (!running || !deviceSerial) return;
    let cancelled = false;
    let timer: number | null = null;

    const runLoop = async () => {
      const ok = await collectSample();
      if (cancelled) return;
      if (!ok) {
        setRunning(false);
        return;
      }
      const pollIntervalMs = nextPerformanceStreamPollIntervalMs(
        sampleIntervalMs,
        streamFallbackRef.current,
      );
      const dueAt = nextPerformancePollDueMs(Date.now(), pollIntervalMs);
      timer = window.setTimeout(runLoop, Math.max(0, dueAt - Date.now()));
    };

    void runLoop();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [collectSample, deviceSerial, running, sampleIntervalMs]);

  const updateSampleInterval = (value: string | null) => {
    const next = normalizePerformanceFastIntervalMs(Number(value));
    setSampleIntervalMs(next);
  };

  const pinCurrentPackage = () => {
    const packageName = latest?.foreground_package || latest?.target_package || null;
    if (!packageName) {
      setStatus({ ok: false, msg: t("performance.noPackageToPin") });
      return;
    }
    setLockedPackage(packageName);
    setStatus({ ok: true, msg: t("performance.pinned", { packageName }) });
  };

  const unlockPackage = () => {
    setLockedPackage(null);
    setStatus({ ok: true, msg: t("performance.unpinned") });
  };

  const exportData = async (format: "json" | "csv") => {
    if (!samples.length || exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const content =
        format === "json"
          ? buildPerformanceJsonExport(
              {
                deviceLabel: deviceTarget.label,
                deviceSerial,
                lockedPackage,
                startedAtMs,
                exportedAtMs: Date.now(),
                sampleIntervalMs,
              },
              samples,
            )
          : buildPerformanceCsvExport(samples);
      const savedPath = await invoke<string | null>("export_text_file", {
        defaultName: `performance_${timestamp}.${format}`,
        content,
      });
      if (savedPath) {
        setStatus({ ok: true, msg: t("performance.exported", { path: savedPath }) });
      }
    } catch (error) {
      setStatus({ ok: false, msg: String(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="md">
            <SectionTitle
              icon={<IconActivityHeartbeat size={17} />}
              label={t("performance.title")}
              description={running ? t("performance.running") : t("performance.stopped")}
            />
            <Group gap="xs">
              {!running ? (
                <Button size="sm" leftSection={<IconPlayerPlay size={16} />} disabled={!deviceSerial} onClick={start}>
                  {t("performance.start")}
                </Button>
              ) : (
                <Button size="sm" variant="default" leftSection={<IconPlayerPause size={16} />} onClick={pause}>
                  {t("performance.pause")}
                </Button>
              )}
              <Select
                size="sm"
                w={168}
                aria-label={t("performance.sampleInterval")}
                data={intervalOptions}
                value={String(sampleIntervalMs)}
                allowDeselect={false}
                onChange={updateSampleInterval}
              />
              <Button size="sm" variant="default" leftSection={<IconRefresh size={16} />} disabled={!deviceSerial} onClick={() => collectSample({ queueIfBusy: true })}>
                {t("performance.sampleNow")}
              </Button>
              <Button size="sm" variant="default" leftSection={<IconTrash size={16} />} disabled={!samples.length} onClick={clear}>
                {t("performance.clear")}
              </Button>
            </Group>
          </Group>

          <DeviceTargetBanner target={deviceTarget} />

          <Group justify="space-between" gap="md">
            <Stack gap={3}>
              <Text size="xs" c="dimmed">
                {t("performance.targetPackage")}
              </Text>
              <Group gap="xs">
                <Text fw={700}>{currentPackage || t("performance.noPackage")}</Text>
                {lockedPackage ? (
                  <Badge color="blue" variant="light">
                    {t("performance.pinnedBadge")}
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light">
                    {t("performance.followingBadge")}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {displaySample?.foreground_activity || displaySample?.foreground_package || t("performance.noForeground")}
              </Text>
              <Text size="xs" c="dimmed">
                {lockedPackage ? t("performance.pinHelpPinned") : t("performance.pinHelpFollowing")}
              </Text>
              <Text size="xs" c="dimmed">
                {lastSampleCompletedAtMs
                  ? t("performance.lastSampleAt", { time: formatTime(lastSampleCompletedAtMs) })
                  : t("performance.noSamples")}
              </Text>
            </Stack>
            <Group gap="xs">
              {lockedPackage ? (
                <Button size="xs" variant="light" leftSection={<IconPinnedOff size={14} />} onClick={unlockPackage}>
                  {t("performance.unpin")}
                </Button>
              ) : (
                <Button size="xs" variant="light" leftSection={<IconPinned size={14} />} disabled={!latest?.foreground_package} onClick={pinCurrentPackage}>
                  {t("performance.pinCurrent")}
                </Button>
              )}
              <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} disabled={!samples.length || exporting} onClick={() => exportData("json")}>
                JSON
              </Button>
              <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} disabled={!samples.length || exporting} onClick={() => exportData("csv")}>
                CSV
              </Button>
            </Group>
          </Group>

          <ResultAlert result={status} />

          {alerts.length > 0 && (
            <Stack gap={6}>
              {alerts.map((alert) => (
                <Paper key={alert.key} withBorder radius="md" p="xs" bg="yellow.0">
                  <Text size="sm" c="yellow.9">
                    {alert.message}
                  </Text>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <MetricSection title={t("performance.app")}>
          <MetricTile label="PID" value={displaySample?.pid ?? emptyValue} />
          <MetricTile label="CPU" value={displaySample ? formatPercent(displayMetrics.processCpuPercent) : emptyValue} />
          <MetricTile label="RSS" value={displaySample ? formatKb(displaySample.process.rss_kb) : emptyValue} />
          <MetricTile label="PSS" value={displaySample ? formatKb(displaySample.process.pss_kb) : emptyValue} />
          <MetricTile label={t("performance.threads")} value={displaySample?.process.thread_count ?? emptyValue} />
          <MetricTile label={t("performance.state")} value={displaySample?.process.state || (displaySample?.target_package ? t("performance.notRunning") : emptyValue)} />
        </MetricSection>

        <MetricSection title={t("performance.rendering")}>
          <MetricTile label="FPS" value={displaySample ? formatNumber(displaySample.frame_stats?.fps, 1) : emptyValue} />
          <MetricTile label="P95" value={displaySample ? formatMs(displaySample.frame_stats?.p95_frame_ms) : emptyValue} />
          <MetricTile label="P50" value={displaySample ? formatMs(displaySample.frame_stats?.p50_frame_ms) : emptyValue} />
          <MetricTile label={t("performance.jank")} value={displaySample ? formatPercent(displaySample.frame_stats?.jank_rate) : emptyValue} />
          <MetricTile label={t("performance.frames")} value={displaySample?.frame_stats?.supported ? displaySample.frame_stats.frame_count : emptyValue} />
          <MetricTile label={t("performance.source")} value={displaySample ? (displaySample.frame_stats?.supported ? t("performance.available") : t("performance.unavailable")) : emptyValue} />
        </MetricSection>

        <MetricSection title={t("performance.deviceLive")}>
          <MetricTile label="CPU" value={displaySample ? formatPercent(displayMetrics.systemCpuPercent) : emptyValue} />
          <MetricTile label={t("performance.gpuUsage")} value={displaySample ? formatGpuUsage(displayMetrics.gpuUsagePercent, displaySample, t) : emptyValue} />
          <MetricTile label={t("performance.gpuFrequency")} value={displaySample ? formatFrequency(displaySample.gpu?.current_frequency_hz) : emptyValue} />
          <MetricTile label={t("performance.memory")} value={displaySample ? formatMemoryPair(displaySample) : emptyValue} />
          <MetricTile label={t("performance.network")} value={displaySample ? formatNetwork(displayMetrics) : emptyValue} />
        </MetricSection>

        <MetricSection title={t("performance.deviceDetails")}>
          <MetricTile label={t("performance.battery")} value={displaySample ? formatBattery(displaySample) : emptyValue} />
          <MetricTile label={t("performance.thermal")} value={displaySample?.thermal.status_label || emptyValue} />
          <MetricTile label={t("performance.storage")} value={displaySample ? formatKb(displaySample.storage.data_available_kb) : emptyValue} />
          <MetricTile label={t("performance.gpuMemory")} value={displaySample ? formatGpuMemory(displaySample) : emptyValue} />
          <MetricTile label={t("performance.gpuSource")} value={displaySample ? formatGpuSource(displaySample, t) : emptyValue} />
        </MetricSection>
      </div>

      <GpuDiagnostics diagnostic={gpuDiagnostic} frameSupported={displaySample?.frame_stats?.supported ?? false} sample={displaySample} t={t} />

      <TrendSection gpuReason={displaySample?.gpu?.reason ?? null} points={trendPoints} t={t} />

      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700}>{t("performance.timeline")}</Text>
            <Text size="xs" c="dimmed">
              {t("performance.sampleCount", { count: samples.length })}
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("performance.time")}</Table.Th>
                  <Table.Th>{t("performance.package")}</Table.Th>
                  <Table.Th>CPU</Table.Th>
                  <Table.Th>RSS</Table.Th>
                  <Table.Th>GPU</Table.Th>
                  <Table.Th>P95</Table.Th>
                  <Table.Th>{t("performance.jank")}</Table.Th>
                  <Table.Th>{t("performance.temp")}</Table.Th>
                  <Table.Th>{t("performance.thermal")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {samples.slice(-12).reverse().map((sample, index) => {
                  const previousSample = samples[samples.indexOf(sample) - 1] || null;
                  const rowMetrics = calculatePerformanceMetrics(previousSample, sample);
                  return (
                    <Table.Tr key={`${sample.timestamp_ms}-${index}`}>
                      <Table.Td>{formatTime(sample.timestamp_ms)}</Table.Td>
                      <Table.Td>{sample.target_package || sample.foreground_package || "-"}</Table.Td>
                      <Table.Td>{formatPercent(rowMetrics.processCpuPercent)}</Table.Td>
                      <Table.Td>{formatKb(sample.process.rss_kb)}</Table.Td>
                      <Table.Td>{formatPercent(rowMetrics.gpuUsagePercent)}</Table.Td>
                      <Table.Td>{formatMs(sample.frame_stats?.p95_frame_ms)}</Table.Td>
                      <Table.Td>{formatPercent(sample.frame_stats?.jank_rate)}</Table.Td>
                      <Table.Td>{formatTemperature(sample.battery.temperature_c)}</Table.Td>
                      <Table.Td>{sample.thermal.status_label || "-"}</Table.Td>
                    </Table.Tr>
                  );
                })}
                {samples.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={9}>
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        {t("performance.noSamples")}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>
    </Stack>
  );
}

function MetricSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700}>{title}</Text>
        <div className="grid grid-cols-2 gap-2">{children}</div>
      </Stack>
    </Paper>
  );
}

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 min-h-[64px]">
      <Text size="xs" c="dimmed" truncate>
        {label}
      </Text>
      <Text fw={800} size="sm" mt={4} truncate>
        {value}
      </Text>
    </div>
  );
}

function GpuDiagnostics({
  diagnostic,
  frameSupported,
  sample,
  t,
}: {
  diagnostic: PerformanceGpuDiagnostic;
  frameSupported: boolean;
  sample: PerformanceSample | null;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [expanded, setExpanded] = useState(false);
  const usageValue = diagnostic.hasUsageCounters
    ? t("performance.available")
    : diagnostic.permissionLimited
      ? t("performance.gpuDiagnosticLimited")
      : t("performance.gpuDiagnosticMissing");
  const frequencyValue = diagnostic.hasFrequency
    ? formatGpuFrequencyPair(sample)
    : diagnostic.permissionLimited
      ? t("performance.gpuDiagnosticLimited")
      : t("performance.gpuDiagnosticMissing");
  const memoryValue = diagnostic.hasMemory ? formatGpuMemory(sample) : t("performance.gpuDiagnosticMissing");

  return (
    <Paper withBorder radius="md" p={expanded ? "md" : "sm"}>
      <Stack gap="sm">
        <Group justify="space-between" gap="sm">
          <Group gap="xs">
            <Text fw={700}>{t("performance.gpuDiagnostics")}</Text>
            <Badge color={gpuDiagnosticStatusColor(diagnostic.status)} variant="light">
              {gpuDiagnosticStatusLabel(diagnostic.status, t)}
            </Badge>
          </Group>
          <Button
            size="xs"
            variant="subtle"
            leftSection={expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("common.collapse") : t("common.expand")}
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          {gpuDiagnosticSummary(diagnostic.status, t)}
        </Text>
        {expanded && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <GpuDiagnosticField label={t("performance.gpuDiagnosticUsageCounters")} value={usageValue} />
              <GpuDiagnosticField label={t("performance.gpuDiagnosticFrequencyCounters")} value={frequencyValue} />
              <GpuDiagnosticField label={t("performance.gpuDiagnosticMemoryData")} value={memoryValue} />
              <GpuDiagnosticField
                label={t("performance.gpuDiagnosticFrameData")}
                value={frameSupported ? t("performance.available") : t("performance.unavailable")}
              />
            </div>
            {(diagnostic.source || diagnostic.reason) && (
              <Text size="xs" c="dimmed" className="break-words">
                {diagnostic.source ? `${t("performance.gpuSource")}: ${diagnostic.source}` : ""}
                {diagnostic.source && diagnostic.reason ? " · " : ""}
                {diagnostic.reason ? `${t("performance.gpuDiagnosticReason")}: ${diagnostic.reason}` : ""}
              </Text>
            )}
            {diagnostic.rawLines.length > 0 && (
              <details className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <summary className="cursor-pointer text-xs text-gray-500">{t("performance.gpuDiagnosticRaw")}</summary>
                <Text component="pre" size="xs" className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono">
                  {diagnostic.rawLines.join("\n")}
                </Text>
              </details>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}

function GpuDiagnosticField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 min-h-[64px]">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="sm" mt={4} className="break-words whitespace-normal">
        {value}
      </Text>
    </div>
  );
}

interface TrendConfig {
  key: string;
  title: string;
  color: string;
  emptyLabel?: string;
  zeroBase?: boolean;
  referenceValue?: number;
  valueOf: (point: PerformanceTrendPoint) => number | null;
  formatValue: (value: number | null | undefined) => string;
}

interface ChartValue {
  timestampMs: number;
  value: number;
}

function TrendSection({
  gpuReason,
  points,
  t,
}: {
  gpuReason: string | null;
  points: PerformanceTrendPoint[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const gpuEmptyLabel = gpuReason?.toLowerCase().includes("permission denied")
    ? t("performance.gpuCountersPermissionLimited")
    : t("performance.noTrendData");
  const configs: TrendConfig[] = [
    {
      key: "processCpu",
      title: t("performance.trendProcessCpu"),
      color: "#2563eb",
      zeroBase: true,
      valueOf: (point) => point.processCpuPercent,
      formatValue: formatPercent,
    },
    {
      key: "systemCpu",
      title: t("performance.trendSystemCpu"),
      color: "#16a34a",
      zeroBase: true,
      valueOf: (point) => point.systemCpuPercent,
      formatValue: formatPercent,
    },
    {
      key: "gpu",
      title: t("performance.trendGpu"),
      color: "#0d9488",
      emptyLabel: gpuEmptyLabel,
      zeroBase: true,
      valueOf: (point) => point.gpuUsagePercent,
      formatValue: formatPercent,
    },
    {
      key: "rss",
      title: t("performance.trendRss"),
      color: "#9333ea",
      valueOf: (point) => point.rssMb,
      formatValue: formatMb,
    },
    {
      key: "memory",
      title: t("performance.trendMemory"),
      color: "#0891b2",
      valueOf: (point) => point.memoryUsedGb,
      formatValue: formatGb,
    },
    {
      key: "p95",
      title: t("performance.trendP95"),
      color: "#ea580c",
      referenceValue: 16.67,
      valueOf: (point) => point.p95FrameMs,
      formatValue: formatMs,
    },
    {
      key: "network",
      title: t("performance.trendNetwork"),
      color: "#475569",
      zeroBase: true,
      valueOf: (point) => point.networkKbPerSecond,
      formatValue: formatKilobytesPerSecond,
    },
  ];

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={700}>{t("performance.trends")}</Text>
        <Text size="xs" c="dimmed">
          {t("performance.trendWindow")}
        </Text>
      </Group>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {configs.map((config) => (
          <TrendCard key={config.key} config={config} points={points} emptyLabel={config.emptyLabel ?? t("performance.noTrendData")} />
        ))}
      </div>
    </Stack>
  );
}

function TrendCard({ config, points, emptyLabel }: { config: TrendConfig; points: PerformanceTrendPoint[]; emptyLabel: string }) {
  const values = points
    .slice(-180)
    .map((point) => ({
      timestampMs: point.timestamp_ms,
      value: config.valueOf(point),
    }))
    .filter((point): point is ChartValue => point.value !== null && Number.isFinite(point.value));
  const latestValue = values.length > 0 ? values[values.length - 1].value : null;

  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" gap="sm">
          <Text size="sm" fw={700}>
            {config.title}
          </Text>
          <Text size="sm" fw={800} c="dark">
            {config.formatValue(latestValue)}
          </Text>
        </Group>
        <LineChart
          ariaLabel={config.title}
          color={config.color}
          emptyLabel={emptyLabel}
          referenceValue={config.referenceValue}
          values={values}
          zeroBase={config.zeroBase}
        />
      </Stack>
    </Paper>
  );
}

function LineChart({
  ariaLabel,
  color,
  emptyLabel,
  referenceValue,
  values,
  zeroBase = false,
}: {
  ariaLabel: string;
  color: string;
  emptyLabel: string;
  referenceValue?: number;
  values: ChartValue[];
  zeroBase?: boolean;
}) {
  if (values.length < 2) {
    return (
      <div className="h-28 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center">
        <Text size="xs" c="dimmed">
          {emptyLabel}
        </Text>
      </div>
    );
  }

  const chartValues = values.map((point) => point.value);
  let min = zeroBase ? Math.min(0, ...chartValues) : Math.min(...chartValues);
  let max = zeroBase ? Math.max(0, ...chartValues) : Math.max(...chartValues);
  if (referenceValue !== undefined && Number.isFinite(referenceValue)) {
    min = Math.min(min, referenceValue);
    max = Math.max(max, referenceValue);
  }
  if (max === min) {
    max += 1;
    min = Math.max(0, min - 1);
  }

  const width = 360;
  const height = 112;
  const paddingX = 12;
  const paddingY = 12;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;
  const yForValue = (value: number) => paddingY + (1 - (value - min) / (max - min)) * plotHeight;
  const path = values
    .map((point, index) => {
      const x = paddingX + (index / Math.max(1, values.length - 1)) * plotWidth;
      const y = yForValue(point.value);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const referenceY = referenceValue !== undefined ? yForValue(referenceValue) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full rounded-md border border-gray-200 bg-gray-50" role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      <line x1={paddingX} y1={paddingY} x2={paddingX} y2={height - paddingY} stroke="#e5e7eb" />
      <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="#e5e7eb" />
      <line x1={paddingX} y1={paddingY + plotHeight / 2} x2={width - paddingX} y2={paddingY + plotHeight / 2} stroke="#e5e7eb" strokeDasharray="4 6" />
      {referenceY !== null && (
        <line x1={paddingX} y1={referenceY} x2={width - paddingX} y2={referenceY} stroke="#dc2626" strokeDasharray="6 6" />
      )}
      <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function buildAlerts(samples: PerformanceSample[], latest: PerformanceSample | null, t: ReturnType<typeof useTranslation>["t"]): AlertItem[] {
  if (!latest) return [];
  const alerts: AlertItem[] = [];
  if (latest.target_package && !latest.pid) {
    alerts.push({ key: "process", message: t("performance.alertProcessGone") });
  }
  if ((latest.thermal.status ?? 0) >= 2) {
    alerts.push({ key: "thermal", message: t("performance.alertThermal", { status: latest.thermal.status_label || latest.thermal.status }) });
  }
  if ((latest.battery.temperature_c ?? 0) >= 45) {
    alerts.push({ key: "temperature", message: t("performance.alertTemperature", { temp: formatTemperature(latest.battery.temperature_c) }) });
  }
  const fiveMinutesAgo = Number(latest.timestamp_ms) - 5 * 60 * 1000;
  const baseline = samples.find((sample) => Number(sample.timestamp_ms) >= fiveMinutesAgo && sample.process.rss_kb);
  if (baseline?.process.rss_kb && latest.process.rss_kb && latest.process.rss_kb > baseline.process.rss_kb * 1.2) {
    alerts.push({ key: "memory", message: t("performance.alertMemory") });
  }
  return alerts;
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  const number = formatNumber(value, 1);
  return number === "-" ? "-" : `${number}%`;
}

function formatMs(value: number | null | undefined) {
  const number = formatNumber(value, 1);
  return number === "-" ? "-" : `${number} ms`;
}

function formatTemperature(value: number | null | undefined) {
  const number = formatNumber(value, 1);
  return number === "-" ? "-" : `${number} C`;
}

function formatKb(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} MB`;
  return `${value} KB`;
}

function formatMb(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value.toFixed(1)} MB`;
}

function formatGb(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} GB`;
}

function formatMemoryPair(sample: PerformanceSample | null) {
  if (!sample?.system.mem_used_kb || !sample.system.mem_total_kb) return "-";
  return `${formatKb(sample.system.mem_used_kb)} / ${formatKb(sample.system.mem_total_kb)}`;
}

function isGpuPermissionLimited(sample: PerformanceSample | null) {
  return sample?.gpu?.reason?.toLowerCase().includes("permission denied") ?? false;
}

function gpuDiagnosticStatusLabel(status: PerformanceGpuDiagnostic["status"], t: ReturnType<typeof useTranslation>["t"]) {
  switch (status) {
    case "usage_available":
      return t("performance.gpuDiagnosticStatusUsageAvailable");
    case "counters_permission_limited":
      return t("performance.gpuDiagnosticStatusCountersPermissionLimited");
    case "memory_and_frequency_only":
      return t("performance.gpuDiagnosticStatusMemoryAndFrequencyOnly");
    case "memory_only":
      return t("performance.gpuDiagnosticStatusMemoryOnly");
    case "frequency_only":
      return t("performance.gpuDiagnosticStatusFrequencyOnly");
    case "metadata_only":
      return t("performance.gpuDiagnosticStatusMetadataOnly");
    case "not_sampled":
      return t("performance.gpuDiagnosticStatusNotSampled");
    case "unavailable":
    default:
      return t("performance.gpuDiagnosticStatusUnavailable");
  }
}

function gpuDiagnosticStatusColor(status: PerformanceGpuDiagnostic["status"]) {
  switch (status) {
    case "usage_available":
      return "green";
    case "counters_permission_limited":
      return "red";
    case "memory_and_frequency_only":
    case "memory_only":
    case "frequency_only":
      return "blue";
    case "metadata_only":
      return "gray";
    case "not_sampled":
      return "gray";
    case "unavailable":
    default:
      return "yellow";
  }
}

function gpuDiagnosticSummary(status: PerformanceGpuDiagnostic["status"], t: ReturnType<typeof useTranslation>["t"]) {
  switch (status) {
    case "usage_available":
      return t("performance.gpuDiagnosticSummaryUsageAvailable");
    case "counters_permission_limited":
      return t("performance.gpuDiagnosticSummaryCountersPermissionLimited");
    case "memory_and_frequency_only":
      return t("performance.gpuDiagnosticSummaryMemoryAndFrequencyOnly");
    case "memory_only":
      return t("performance.gpuDiagnosticSummaryMemoryOnly");
    case "frequency_only":
      return t("performance.gpuDiagnosticSummaryFrequencyOnly");
    case "metadata_only":
      return t("performance.gpuDiagnosticSummaryMetadataOnly");
    case "not_sampled":
      return t("performance.gpuDiagnosticSummaryNotSampled");
    case "unavailable":
    default:
      return t("performance.gpuDiagnosticSummaryUnavailable");
  }
}

function formatGpuUsage(value: number | null, sample: PerformanceSample, t: ReturnType<typeof useTranslation>["t"]) {
  const formatted = formatPercent(value);
  if (formatted !== "-") return formatted;
  if (isGpuPermissionLimited(sample)) {
    return t("performance.gpuCountersLimited");
  }
  return "-";
}

function formatGpuMemory(sample: PerformanceSample | null) {
  const bytes = sample?.gpu?.process_memory_bytes ?? sample?.gpu?.memory_total_bytes ?? null;
  return formatBytes(bytes);
}

function formatGpuFrequencyPair(sample: PerformanceSample | null) {
  const current = formatFrequency(sample?.gpu?.current_frequency_hz);
  const max = formatFrequency(sample?.gpu?.max_frequency_hz);
  if (current === "-" && max === "-") return "-";
  if (current !== "-" && max !== "-") return `${current} / ${max}`;
  return current !== "-" ? current : max;
}

function formatGpuSource(sample: PerformanceSample | null, t: ReturnType<typeof useTranslation>["t"]) {
  if (!sample) return "-";
  if (sample.gpu?.source) return sample.gpu.source;
  if (isGpuPermissionLimited(sample)) {
    return t("performance.gpuCountersPermissionLimited");
  }
  return sample.gpu?.supported ? t("performance.available") : t("performance.unavailable");
}

function formatBattery(sample: PerformanceSample | null) {
  if (!sample) return "-";
  const level = sample.battery.level_percent === null ? "-" : `${sample.battery.level_percent}%`;
  const temp = formatTemperature(sample.battery.temperature_c);
  return temp === "-" ? level : `${level} · ${temp}`;
}

function formatNetwork(metrics: ReturnType<typeof calculatePerformanceMetrics>) {
  const rx = formatBytesPerSecond(metrics.rxBytesPerSecond);
  const tx = formatBytesPerSecond(metrics.txBytesPerSecond);
  if (rx === "-" && tx === "-") return "-";
  return `↓ ${rx} · ↑ ${tx}`;
}

function formatBytesPerSecond(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatKilobytesPerSecond(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} MB/s`;
  return `${value.toFixed(1)} KB/s`;
}

function formatFrequency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GHz`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)} MHz`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)} kHz`;
  return `${value} Hz`;
}

function intervalLabel(ms: number, t: ReturnType<typeof useTranslation>["t"]) {
  if (ms === 500) return t("performance.intervalAggressive");
  if (ms === 1000) return t("performance.intervalFast");
  if (ms === 2000) return t("performance.intervalBalanced");
  return t("performance.intervalRelaxed");
}

function formatTime(timestampMs: number) {
  return new Date(Number(timestampMs)).toLocaleTimeString();
}
