import type { PerformanceSample } from "./types";

export const PERFORMANCE_FAST_INTERVAL_MS = 2000;
export const PERFORMANCE_SLOW_INTERVAL_MS = 10000;
export const PERFORMANCE_FRAME_INTERVAL_MS = 5000;
export const PERFORMANCE_RETENTION_MS = 15 * 60 * 1000;
export const PERFORMANCE_SAMPLE_WATCHDOG_MS = 12000;
export const PERFORMANCE_SAMPLE_TIMEOUT_ERROR = "PERFORMANCE_SAMPLE_TIMEOUT";

export interface PerformanceDerivedMetrics {
  processCpuPercent: number | null;
  systemCpuPercent: number | null;
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}

export interface PerformanceExportMeta {
  deviceLabel: string;
  deviceSerial: string | null;
  lockedPackage: string | null;
  startedAtMs: number | null;
  exportedAtMs: number;
}

export interface PerformanceCadenceMarks {
  lastSlowSampleMs: number;
  lastFrameSampleMs: number;
}

export interface PerformanceTrendPoint {
  timestamp_ms: number;
  processCpuPercent: number | null;
  systemCpuPercent: number | null;
  rssMb: number | null;
  pssMb: number | null;
  memoryUsedGb: number | null;
  fps: number | null;
  p95FrameMs: number | null;
  jankRate: number | null;
  batteryTemperatureC: number | null;
  networkKbPerSecond: number | null;
}

export function initialPerformanceCadenceMarks(nowMs: number): PerformanceCadenceMarks {
  return {
    lastSlowSampleMs: nowMs,
    lastFrameSampleMs: nowMs,
  };
}

export function nextPerformancePollDueMs(completedAtMs: number): number {
  return completedAtMs + PERFORMANCE_FAST_INTERVAL_MS;
}

export function shouldIncludeSlowSample(nowMs: number, lastSlowSampleMs: number | null): boolean {
  return lastSlowSampleMs === null || nowMs - lastSlowSampleMs >= PERFORMANCE_SLOW_INTERVAL_MS;
}

export function shouldIncludeFrameSample(nowMs: number, lastFrameSampleMs: number | null): boolean {
  return lastFrameSampleMs === null || nowMs - lastFrameSampleMs >= PERFORMANCE_FRAME_INTERVAL_MS;
}

export function prunePerformanceSamples(samples: PerformanceSample[], nowMs: number): PerformanceSample[] {
  const cutoff = nowMs - PERFORMANCE_RETENTION_MS;
  return samples.filter((sample) => sample.timestamp_ms >= cutoff);
}

export function calculatePerformanceMetrics(
  previous: PerformanceSample | null,
  current: PerformanceSample | null,
): PerformanceDerivedMetrics {
  if (!previous || !current || current.timestamp_ms <= previous.timestamp_ms) {
    return {
      processCpuPercent: null,
      systemCpuPercent: null,
      rxBytesPerSecond: null,
      txBytesPerSecond: null,
    };
  }

  const totalDelta = delta(previous.system.cpu_total_jiffies, current.system.cpu_total_jiffies);
  const idleDelta = delta(previous.system.cpu_idle_jiffies, current.system.cpu_idle_jiffies);
  const processDelta = delta(previous.process.cpu_jiffies, current.process.cpu_jiffies);
  const seconds = (current.timestamp_ms - previous.timestamp_ms) / 1000;

  return {
    processCpuPercent:
      totalDelta !== null && totalDelta > 0 && processDelta !== null
        ? clampPercent((processDelta / totalDelta) * 100)
        : null,
    systemCpuPercent:
      totalDelta !== null && totalDelta > 0 && idleDelta !== null
        ? clampPercent(((totalDelta - idleDelta) / totalDelta) * 100)
        : null,
    rxBytesPerSecond: rate(previous.network.rx_bytes, current.network.rx_bytes, seconds),
    txBytesPerSecond: rate(previous.network.tx_bytes, current.network.tx_bytes, seconds),
  };
}

export function buildPerformanceTrendPoints(samples: PerformanceSample[]): PerformanceTrendPoint[] {
  return samples.map((sample, index) => {
    const metrics = calculatePerformanceMetrics(index > 0 ? samples[index - 1] : null, sample);
    return {
      timestamp_ms: sample.timestamp_ms,
      processCpuPercent: metrics.processCpuPercent,
      systemCpuPercent: metrics.systemCpuPercent,
      rssMb: kbToMb(sample.process.rss_kb),
      pssMb: kbToMb(sample.process.pss_kb),
      memoryUsedGb: kbToGb(sample.system.mem_used_kb),
      fps: finiteOrNull(sample.frame_stats?.fps),
      p95FrameMs: finiteOrNull(sample.frame_stats?.p95_frame_ms),
      jankRate: finiteOrNull(sample.frame_stats?.jank_rate),
      batteryTemperatureC: finiteOrNull(sample.battery.temperature_c),
      networkKbPerSecond: networkKbPerSecond(metrics),
    };
  });
}

export async function withPerformanceSampleTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PERFORMANCE_SAMPLE_WATCHDOG_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(PERFORMANCE_SAMPLE_TIMEOUT_ERROR)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function isPerformanceSampleTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === PERFORMANCE_SAMPLE_TIMEOUT_ERROR;
}

export function buildPerformanceJsonExport(meta: PerformanceExportMeta, samples: PerformanceSample[]): string {
  return JSON.stringify(
    {
      meta: {
        ...meta,
        sampleCount: samples.length,
        fastIntervalMs: PERFORMANCE_FAST_INTERVAL_MS,
        slowIntervalMs: PERFORMANCE_SLOW_INTERVAL_MS,
        frameIntervalMs: PERFORMANCE_FRAME_INTERVAL_MS,
        retentionMs: PERFORMANCE_RETENTION_MS,
      },
      samples,
    },
    null,
    2,
  );
}

export function buildPerformanceCsvExport(samples: PerformanceSample[]): string {
  const rows = [
    [
      "timestamp_ms",
      "target_package",
      "foreground_package",
      "pid",
      "process_cpu_jiffies",
      "rss_kb",
      "pss_kb",
      "threads",
      "system_cpu_total_jiffies",
      "system_cpu_idle_jiffies",
      "mem_used_kb",
      "mem_total_kb",
      "battery_level_percent",
      "battery_temperature_c",
      "thermal_status",
      "thermal_label",
      "rx_bytes",
      "tx_bytes",
      "storage_available_kb",
      "fps",
      "p95_frame_ms",
      "jank_rate",
    ],
    ...samples.map((sample) => [
      sample.timestamp_ms,
      sample.target_package,
      sample.foreground_package,
      sample.pid,
      sample.process.cpu_jiffies,
      sample.process.rss_kb,
      sample.process.pss_kb,
      sample.process.thread_count,
      sample.system.cpu_total_jiffies,
      sample.system.cpu_idle_jiffies,
      sample.system.mem_used_kb,
      sample.system.mem_total_kb,
      sample.battery.level_percent,
      sample.battery.temperature_c,
      sample.thermal.status,
      sample.thermal.status_label,
      sample.network.rx_bytes,
      sample.network.tx_bytes,
      sample.storage.data_available_kb,
      sample.frame_stats?.fps ?? null,
      sample.frame_stats?.p95_frame_ms ?? null,
      sample.frame_stats?.jank_rate ?? null,
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function delta(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || current < previous) return null;
  return current - previous;
}

function rate(previous: number | null, current: number | null, seconds: number): number | null {
  const valueDelta = delta(previous, current);
  if (valueDelta === null || seconds <= 0) return null;
  return valueDelta / seconds;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function kbToMb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value / 1024;
}

function kbToGb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value / 1024 / 1024;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function networkKbPerSecond(metrics: PerformanceDerivedMetrics): number | null {
  const rx = metrics.rxBytesPerSecond;
  const tx = metrics.txBytesPerSecond;
  if (rx === null && tx === null) return null;
  return ((rx ?? 0) + (tx ?? 0)) / 1024;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
