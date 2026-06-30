import type { PerformanceAgentStatus, PerformanceSample, PerformanceSampleSource } from "./types";

export const PERFORMANCE_FAST_INTERVAL_OPTIONS_MS = [500, 1000, 2000, 5000] as const;
export const PERFORMANCE_DEFAULT_FAST_INTERVAL_MS = 1000;
export const PERFORMANCE_SLOW_INTERVAL_MS = 10000;
export const PERFORMANCE_FRAME_INTERVAL_MS = 5000;
export const PERFORMANCE_RETENTION_MS = 15 * 60 * 1000;
export const PERFORMANCE_SAMPLE_WATCHDOG_MS = 20000;
export const PERFORMANCE_SAMPLE_TIMEOUT_ERROR = "PERFORMANCE_SAMPLE_TIMEOUT";
export const PERFORMANCE_STREAM_FIRST_SAMPLE_POLL_MS = 500;

export interface PerformanceDerivedMetrics {
  processCpuPercent: number | null;
  systemCpuPercent: number | null;
  gpuUsagePercent: number | null;
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}

export interface PerformanceExportMeta {
  deviceLabel: string;
  deviceSerial: string | null;
  lockedPackage: string | null;
  startedAtMs: number | null;
  exportedAtMs: number;
  sampleIntervalMs: number;
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
  gpuUsagePercent: number | null;
  gpuFrequencyMhz: number | null;
  batteryTemperatureC: number | null;
  networkKbPerSecond: number | null;
}

export interface PerformanceDisplaySnapshot {
  sample: PerformanceSample;
  metrics: PerformanceDerivedMetrics;
}

export type PerformanceEffectiveSampleSource = PerformanceSampleSource | "agent_unavailable";

export type PerformanceGpuDiagnosticStatus =
  | "usage_available"
  | "counters_permission_limited"
  | "memory_and_frequency_only"
  | "memory_only"
  | "frequency_only"
  | "metadata_only"
  | "unavailable"
  | "not_sampled";

export interface PerformanceGpuDiagnostic {
  status: PerformanceGpuDiagnosticStatus;
  hasUsageCounters: boolean;
  hasFrequency: boolean;
  hasMemory: boolean;
  permissionLimited: boolean;
  source: string | null;
  reason: string | null;
  rawLines: string[];
}

export function initialPerformanceCadenceMarks(nowMs: number): PerformanceCadenceMarks {
  return {
    lastSlowSampleMs: nowMs,
    lastFrameSampleMs: nowMs,
  };
}

export function nextPerformancePollDueMs(completedAtMs: number, intervalMs = PERFORMANCE_DEFAULT_FAST_INTERVAL_MS): number {
  return completedAtMs + normalizePerformanceFastIntervalMs(intervalMs);
}

export function nextPerformanceStreamPollIntervalMs(
  selectedIntervalMs: number,
  usingFallback: boolean,
  hasStreamSample = true,
): number {
  const normalized = normalizePerformanceFastIntervalMs(selectedIntervalMs);
  if (usingFallback) {
    return normalized;
  }
  // Before the first stream frame, poll the lightweight in-memory snapshot
  // quickly so the panel does not look blank. After that, visible auto-refresh
  // follows the interval the user selected.
  return hasStreamSample ? normalized : Math.min(normalized, PERFORMANCE_STREAM_FIRST_SAMPLE_POLL_MS);
}

export function normalizePerformanceFastIntervalMs(value: number): number {
  return PERFORMANCE_FAST_INTERVAL_OPTIONS_MS.includes(value as (typeof PERFORMANCE_FAST_INTERVAL_OPTIONS_MS)[number])
    ? value
    : PERFORMANCE_DEFAULT_FAST_INTERVAL_MS;
}

export function normalizePerformanceAgentStatus(value: unknown): PerformanceAgentStatus {
  return value === "missing" ||
    value === "installing" ||
    value === "starting" ||
    value === "update_available" ||
    value === "connected" ||
    value === "permission_limited" ||
    value === "failed"
    ? value
    : "failed";
}

export function performanceSampleSource(
  agentStatus: PerformanceAgentStatus | null,
  hasAgentSample: boolean,
  hasAdbSample: boolean,
): PerformanceEffectiveSampleSource {
  if (hasAgentSample && hasAdbSample) return "merged";
  if (hasAgentSample) return "agent";
  if (hasAdbSample) return "adb";
  return agentStatus === "connected" || agentStatus === "permission_limited" ? "agent" : "agent_unavailable";
}

export function mergePerformanceAgentSample(
  adbSample: PerformanceSample | null,
  agentSample: PerformanceSample | null,
): PerformanceSample {
  if (!adbSample && !agentSample) {
    throw new Error("at least one performance sample is required");
  }
  if (!adbSample) {
    return markPerformanceSampleSource(agentSample!, "agent", agentSample!.agent_status ?? "connected");
  }
  if (!agentSample) {
    return markPerformanceSampleSource(adbSample, "adb", adbSample.agent_status ?? null);
  }

  return {
    ...adbSample,
    timestamp_ms: Math.max(adbSample.timestamp_ms, agentSample.timestamp_ms),
    sample_source: "merged",
    agent_status: normalizePerformanceAgentStatus(agentSample.agent_status ?? "connected"),
    target_package: agentSample.target_package ?? adbSample.target_package,
    foreground_package: agentSample.foreground_package ?? adbSample.foreground_package,
    foreground_activity: agentSample.foreground_activity ?? adbSample.foreground_activity,
    pid: agentSample.pid ?? adbSample.pid,
    process: {
      ...adbSample.process,
      ...nonNullObject(agentSample.process),
      package_name: agentSample.process.package_name ?? adbSample.process.package_name,
      pid: agentSample.process.pid ?? adbSample.process.pid,
      running: agentSample.process.running || adbSample.process.running,
    },
    network: {
      rx_bytes: agentSample.network.rx_bytes ?? adbSample.network.rx_bytes,
      tx_bytes: agentSample.network.tx_bytes ?? adbSample.network.tx_bytes,
    },
    frame_stats: agentSample.frame_stats ?? adbSample.frame_stats,
    unavailable: [...new Set([...adbSample.unavailable, ...agentSample.unavailable])],
  };
}

function markPerformanceSampleSource(
  sample: PerformanceSample,
  sampleSource: PerformanceSampleSource,
  agentStatus: PerformanceAgentStatus | null,
): PerformanceSample {
  return {
    ...sample,
    sample_source: sampleSource,
    agent_status: agentStatus,
  };
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
      gpuUsagePercent: current ? directGpuUsagePercent(current) : null,
      rxBytesPerSecond: null,
      txBytesPerSecond: null,
    };
  }

  const totalDelta = delta(previous.system.cpu_total_jiffies, current.system.cpu_total_jiffies);
  const idleDelta = delta(previous.system.cpu_idle_jiffies, current.system.cpu_idle_jiffies);
  const processDelta = isSameProcessSample(previous, current)
    ? delta(previous.process.cpu_jiffies, current.process.cpu_jiffies)
    : null;
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
    gpuUsagePercent: gpuUsagePercent(previous, current),
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
      gpuUsagePercent: metrics.gpuUsagePercent,
      gpuFrequencyMhz: hzToMhz(sample.gpu?.current_frequency_hz),
      batteryTemperatureC: finiteOrNull(sample.battery.temperature_c),
      networkKbPerSecond: networkKbPerSecond(metrics),
    };
  });
}

export function buildPerformanceDisplaySnapshot(samples: PerformanceSample[]): PerformanceDisplaySnapshot | null {
  if (samples.length === 0) return null;
  return {
    sample: buildDisplaySample(samples),
    metrics: buildDisplayMetrics(samples),
  };
}

export function buildPerformanceGpuDiagnostic(
  sample: PerformanceSample | null,
  gpuUsagePercent: number | null = null,
): PerformanceGpuDiagnostic {
  const gpu = sample?.gpu ?? null;
  if (!gpu) {
    return {
      status: "not_sampled",
      hasUsageCounters: false,
      hasFrequency: false,
      hasMemory: false,
      permissionLimited: false,
      source: null,
      reason: null,
      rawLines: [],
    };
  }

  const hasDirectUsage = finiteOrNull(gpuUsagePercent) !== null || finiteOrNull(gpu.busy_percent) !== null;
  const hasBusyCounters =
    hasDirectUsage ||
    (finiteOrNull(gpu.busy_time) !== null && finiteOrNull(gpu.total_time) !== null);
  const hasFrequency =
    finiteOrNull(gpu.current_frequency_hz) !== null || finiteOrNull(gpu.max_frequency_hz) !== null;
  const hasMemory =
    finiteOrNull(gpu.memory_total_bytes) !== null || finiteOrNull(gpu.process_memory_bytes) !== null;
  const permissionLimited = gpu.reason?.toLowerCase().includes("permission denied") ?? false;
  const rawLines = gpu.raw
    ? gpu.raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  let status: PerformanceGpuDiagnosticStatus = "unavailable";
  if (hasBusyCounters) {
    status = "usage_available";
  } else if (permissionLimited) {
    status = "counters_permission_limited";
  } else if (hasMemory && hasFrequency) {
    status = "memory_and_frequency_only";
  } else if (hasMemory) {
    status = "memory_only";
  } else if (hasFrequency) {
    status = "frequency_only";
  } else if (gpu.supported || gpu.source || rawLines.length > 0) {
    status = "metadata_only";
  }

  return {
    status,
    hasUsageCounters: hasBusyCounters,
    hasFrequency,
    hasMemory,
    permissionLimited,
    source: gpu.source ?? null,
    reason: gpu.reason ?? null,
    rawLines,
  };
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
        fastIntervalMs: meta.sampleIntervalMs,
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
      "gpu_busy_percent",
      "gpu_busy_time",
      "gpu_total_time",
      "gpu_current_frequency_hz",
      "gpu_max_frequency_hz",
      "gpu_memory_total_bytes",
      "gpu_process_memory_bytes",
      "gpu_source",
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
      sample.gpu?.busy_percent ?? null,
      sample.gpu?.busy_time ?? null,
      sample.gpu?.total_time ?? null,
      sample.gpu?.current_frequency_hz ?? null,
      sample.gpu?.max_frequency_hz ?? null,
      sample.gpu?.memory_total_bytes ?? null,
      sample.gpu?.process_memory_bytes ?? null,
      sample.gpu?.source ?? null,
      sample.frame_stats?.fps ?? null,
      sample.frame_stats?.p95_frame_ms ?? null,
      sample.frame_stats?.jank_rate ?? null,
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function buildDisplaySample(samples: PerformanceSample[]): PerformanceSample {
  const latest = samples[samples.length - 1];
  const latestTarget = targetKey(latest);
  const latestFrameStats = latest.frame_stats?.supported ? latest.frame_stats : null;
  return {
    ...latest,
    process: {
      ...latest.process,
      pss_kb:
        latest.process.pss_kb ??
        lastNonNullForTarget(samples, latestTarget, (sample) => sample.process.pss_kb),
    },
    system: {
      ...latest.system,
      cpu_frequency: {
        average_current_khz:
          latest.system.cpu_frequency.average_current_khz ??
          lastNonNull(samples, (sample) => sample.system.cpu_frequency.average_current_khz),
        average_max_khz:
          latest.system.cpu_frequency.average_max_khz ??
          lastNonNull(samples, (sample) => sample.system.cpu_frequency.average_max_khz),
        online_cores:
          latest.system.cpu_frequency.online_cores ||
          lastNonNull(samples, (sample) => sample.system.cpu_frequency.online_cores) ||
          0,
      },
    },
    battery: {
      level_percent:
        latest.battery.level_percent ?? lastNonNull(samples, (sample) => sample.battery.level_percent),
      status: latest.battery.status ?? lastNonNull(samples, (sample) => sample.battery.status),
      temperature_c:
        latest.battery.temperature_c ?? lastNonNull(samples, (sample) => sample.battery.temperature_c),
    },
    thermal: {
      status: latest.thermal.status ?? lastNonNull(samples, (sample) => sample.thermal.status),
      status_label:
        latest.thermal.status_label ?? lastNonNull(samples, (sample) => sample.thermal.status_label),
      raw: latest.thermal.raw ?? lastNonNull(samples, (sample) => sample.thermal.raw),
    },
    display: {
      size: latest.display.size ?? lastNonNull(samples, (sample) => sample.display.size),
      density: latest.display.density ?? lastNonNull(samples, (sample) => sample.display.density),
      refresh_rate_hz:
        latest.display.refresh_rate_hz ?? lastNonNull(samples, (sample) => sample.display.refresh_rate_hz),
    },
    storage: {
      data_total_kb:
        latest.storage.data_total_kb ?? lastNonNull(samples, (sample) => sample.storage.data_total_kb),
      data_used_kb:
        latest.storage.data_used_kb ?? lastNonNull(samples, (sample) => sample.storage.data_used_kb),
      data_available_kb:
        latest.storage.data_available_kb ??
        lastNonNull(samples, (sample) => sample.storage.data_available_kb),
    },
    gpu: buildDisplayGpuSample(samples),
    frame_stats:
      latestFrameStats ??
      lastNonNullForTarget(samples, latestTarget, (sample) =>
        sample.frame_stats?.supported ? sample.frame_stats : null,
      ) ??
      latest.frame_stats,
  };
}

function buildDisplayMetrics(samples: PerformanceSample[]): PerformanceDerivedMetrics {
  const latest = samples[samples.length - 1];
  const latestTarget = targetKey(latest);
  let metrics = calculatePerformanceMetrics(
    samples.length >= 2 ? samples[samples.length - 2] : null,
    latest,
  );
  for (let index = samples.length - 1; index > 0 && hasMissingMetric(metrics); index -= 1) {
    const candidate = calculatePerformanceMetrics(samples[index - 1], samples[index]);
    metrics = {
      processCpuPercent:
        metrics.processCpuPercent ??
        (targetKey(samples[index]) === latestTarget ? candidate.processCpuPercent : null),
      systemCpuPercent: metrics.systemCpuPercent ?? candidate.systemCpuPercent,
      gpuUsagePercent: metrics.gpuUsagePercent ?? candidate.gpuUsagePercent,
      rxBytesPerSecond: metrics.rxBytesPerSecond ?? candidate.rxBytesPerSecond,
      txBytesPerSecond: metrics.txBytesPerSecond ?? candidate.txBytesPerSecond,
    };
  }
  return metrics;
}

function buildDisplayGpuSample(samples: PerformanceSample[]): PerformanceSample["gpu"] {
  const latestSample = samples[samples.length - 1];
  const latestTarget = targetKey(latestSample);
  const latest = latestSample.gpu;
  const merged = {
    supported: latest.supported,
    busy_percent: latest.busy_percent ?? lastNonNull(samples, (sample) => sample.gpu.busy_percent),
    busy_time: latest.busy_time ?? lastNonNull(samples, (sample) => sample.gpu.busy_time),
    total_time: latest.total_time ?? lastNonNull(samples, (sample) => sample.gpu.total_time),
    current_frequency_hz:
      latest.current_frequency_hz ?? lastNonNull(samples, (sample) => sample.gpu.current_frequency_hz),
    max_frequency_hz:
      latest.max_frequency_hz ?? lastNonNull(samples, (sample) => sample.gpu.max_frequency_hz),
    memory_total_bytes:
      latest.memory_total_bytes ?? lastNonNull(samples, (sample) => sample.gpu.memory_total_bytes),
    process_memory_bytes:
      latest.process_memory_bytes ??
      lastNonNullForTarget(samples, latestTarget, (sample) => sample.gpu.process_memory_bytes),
    source: latest.source ?? lastNonNull(samples, (sample) => sample.gpu.source),
    reason: latest.reason ?? lastNonNull(samples, (sample) => sample.gpu.reason),
    raw: latest.raw ?? lastNonNull(samples, (sample) => sample.gpu.raw),
  };
  return {
    ...merged,
    supported: merged.supported || hasGpuValues(merged),
  };
}

function hasMissingMetric(metrics: PerformanceDerivedMetrics): boolean {
  return Object.values(metrics).some((value) => value === null);
}

function hasGpuValues(gpu: PerformanceSample["gpu"]): boolean {
  return (
    gpu.busy_percent !== null ||
    gpu.busy_time !== null ||
    gpu.total_time !== null ||
    gpu.current_frequency_hz !== null ||
    gpu.max_frequency_hz !== null ||
    gpu.memory_total_bytes !== null ||
    gpu.process_memory_bytes !== null
  );
}

function isSameProcessSample(previous: PerformanceSample, current: PerformanceSample): boolean {
  return (
    previous.process.pid !== null &&
    current.process.pid !== null &&
    previous.process.pid === current.process.pid &&
    previous.process.package_name === current.process.package_name
  );
}

function targetKey(sample: PerformanceSample): string | null {
  return sample.target_package ?? sample.foreground_package ?? sample.process.package_name ?? null;
}

function lastNonNullForTarget<T>(
  samples: PerformanceSample[],
  target: string | null,
  getter: (sample: PerformanceSample) => T | null | undefined,
): T | null {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (targetKey(samples[index]) !== target) continue;
    const value = getter(samples[index]);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function lastNonNull<T>(samples: PerformanceSample[], getter: (sample: PerformanceSample) => T | null | undefined): T | null {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const value = getter(samples[index]);
    if (value !== null && value !== undefined) return value;
  }
  return null;
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

function directGpuUsagePercent(sample: PerformanceSample): number | null {
  const value = finiteOrNull(sample.gpu?.busy_percent);
  return value === null ? null : clampPercent(value);
}

function gpuUsagePercent(previous: PerformanceSample, current: PerformanceSample): number | null {
  const direct = directGpuUsagePercent(current);
  if (direct !== null) return direct;
  const busyDelta = delta(previous.gpu?.busy_time ?? null, current.gpu?.busy_time ?? null);
  const totalDelta = delta(previous.gpu?.total_time ?? null, current.gpu?.total_time ?? null);
  if (busyDelta === null || totalDelta === null || totalDelta <= 0) return null;
  return clampPercent((busyDelta / totalDelta) * 100);
}

function kbToMb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value / 1024;
}

function kbToGb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value / 1024 / 1024;
}

function hzToMhz(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value / 1_000_000;
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

function nonNullObject<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as Partial<T>;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
