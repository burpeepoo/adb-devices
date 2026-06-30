import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PERFORMANCE_RETENTION_MS,
  PERFORMANCE_SAMPLE_WATCHDOG_MS,
  PERFORMANCE_SAMPLE_TIMEOUT_ERROR,
  mergePerformanceAgentSample,
  normalizePerformanceAgentStatus,
  performanceSampleSource,
  buildPerformanceDisplaySnapshot,
  buildPerformanceGpuDiagnostic,
  normalizePerformanceFastIntervalMs,
  buildPerformanceCsvExport,
  buildPerformanceJsonExport,
  buildPerformanceTrendPoints,
  calculatePerformanceMetrics,
  initialPerformanceCadenceMarks,
  isPerformanceSampleTimeout,
  nextPerformancePollDueMs,
  nextPerformanceStreamPollIntervalMs,
  prunePerformanceSamples,
  shouldIncludeFrameSample,
  shouldIncludeSlowSample,
  withPerformanceSampleTimeout,
} from "../src/performanceSampling.ts";
import type { PerformanceSample } from "../src/types/index.ts";

test("performance sampling cadence separates slow and frame intervals", () => {
  assert.equal(shouldIncludeSlowSample(10_000, null), true);
  assert.equal(shouldIncludeSlowSample(19_000, 10_000), false);
  assert.equal(shouldIncludeSlowSample(20_000, 10_000), true);

  assert.equal(shouldIncludeFrameSample(5_000, null), true);
  assert.equal(shouldIncludeFrameSample(9_999, 5_000), false);
  assert.equal(shouldIncludeFrameSample(10_000, 5_000), true);
});

test("performance sampling starts with a fast sample before slow probes", () => {
  const marks = initialPerformanceCadenceMarks(10_000);

  assert.equal(shouldIncludeSlowSample(10_001, marks.lastSlowSampleMs), false);
  assert.equal(shouldIncludeFrameSample(10_001, marks.lastFrameSampleMs), false);
  assert.equal(shouldIncludeFrameSample(15_000, marks.lastFrameSampleMs), true);
  assert.equal(shouldIncludeSlowSample(20_000, marks.lastSlowSampleMs), true);
  assert.equal(nextPerformancePollDueMs(12_345), 13_345);
  assert.equal(nextPerformancePollDueMs(12_345, 500), 12_845);
  assert.equal(normalizePerformanceFastIntervalMs(333), 1000);
});

test("performance stream polls cached frames faster than device sampling cadence", () => {
  assert.equal(nextPerformanceStreamPollIntervalMs(5000, false, false), 500);
  assert.equal(nextPerformanceStreamPollIntervalMs(2000, false, false), 500);
  assert.equal(nextPerformanceStreamPollIntervalMs(1000, false, false), 500);
  assert.equal(nextPerformanceStreamPollIntervalMs(500, false, false), 500);
});

test("performance stream follows selected interval after first sample", () => {
  assert.equal(nextPerformanceStreamPollIntervalMs(5000, false, true), 5000);
  assert.equal(nextPerformanceStreamPollIntervalMs(2000, false, true), 2000);
  assert.equal(nextPerformanceStreamPollIntervalMs(1000, false, true), 1000);
  assert.equal(nextPerformanceStreamPollIntervalMs(500, false, true), 500);
  assert.equal(nextPerformanceStreamPollIntervalMs(2000, true), 2000);
});

test("performance agent status normalizes unknown backend states to failed", () => {
  assert.equal(normalizePerformanceAgentStatus("connected"), "connected");
  assert.equal(normalizePerformanceAgentStatus("permission_limited"), "permission_limited");
  assert.equal(normalizePerformanceAgentStatus("update_available"), "update_available");
  assert.equal(normalizePerformanceAgentStatus("unexpected-state"), "failed");
});

test("performance sample source reflects agent and adb availability", () => {
  assert.equal(performanceSampleSource("connected", true, true), "merged");
  assert.equal(performanceSampleSource("connected", true, false), "agent");
  assert.equal(performanceSampleSource("missing", false, true), "adb");
  assert.equal(performanceSampleSource("failed", false, false), "agent_unavailable");
});

test("performance agent sample merge keeps adb system metrics and uses fresher agent app metrics", () => {
  const adb = sample({
    timestamp_ms: 1_000,
    packageName: "com.example.game",
    rssKb: 10_000,
    pssKb: 9_000,
    cpuTotal: 1_000,
    cpuIdle: 200,
  });
  const agent = sample({
    timestamp_ms: 1_200,
    packageName: "com.example.game",
    rssKb: 22_000,
    pssKb: 20_000,
  });
  agent.sample_source = "agent";
  agent.process.thread_count = 42;
  agent.system.cpu_total_jiffies = null;
  agent.system.cpu_idle_jiffies = null;
  agent.battery.temperature_c = null;
  agent.storage.data_available_kb = null;

  const merged = mergePerformanceAgentSample(adb, agent);

  assert.equal(merged.sample_source, "merged");
  assert.equal(merged.agent_status, "connected");
  assert.equal(merged.timestamp_ms, 1_200);
  assert.equal(merged.process.rss_kb, 22_000);
  assert.equal(merged.process.pss_kb, 20_000);
  assert.equal(merged.process.thread_count, 42);
  assert.equal(merged.system.cpu_total_jiffies, 1_000);
  assert.equal(merged.system.cpu_idle_jiffies, 200);
  assert.equal(merged.battery.temperature_c, 35);
  assert.equal(merged.storage.data_available_kb, 40_000);
});

test("performance sample watchdog has headroom for slow wireless probes", () => {
  assert.equal(PERFORMANCE_SAMPLE_WATCHDOG_MS, 20_000);
});

test("performance samples are retained for a rolling 15 minute window", () => {
  const now = 1_000_000;
  const samples = [
    sample({ timestamp_ms: now - PERFORMANCE_RETENTION_MS - 1 }),
    sample({ timestamp_ms: now - PERFORMANCE_RETENTION_MS }),
    sample({ timestamp_ms: now }),
  ];

  assert.deepEqual(
    prunePerformanceSamples(samples, now).map((item) => item.timestamp_ms),
    [now - PERFORMANCE_RETENTION_MS, now],
  );
});

test("performance metrics calculate CPU percentages and network rates from deltas", () => {
  const previous = sample({
    timestamp_ms: 1_000,
    processCpu: 100,
    cpuTotal: 1_000,
    cpuIdle: 200,
    rx: 1_000,
      tx: 2_000,
      gpuBusy: 100,
      gpuTotal: 1_000,
    });
  const current = sample({
    timestamp_ms: 3_000,
    processCpu: 150,
    cpuTotal: 1_500,
    cpuIdle: 300,
    rx: 3_000,
    tx: 3_000,
    gpuBusy: 250,
    gpuTotal: 1_500,
  });

  const metrics = calculatePerformanceMetrics(previous, current);

  assert.equal(metrics.processCpuPercent, 10);
  assert.equal(metrics.systemCpuPercent, 80);
  assert.equal(metrics.gpuUsagePercent, 30);
  assert.equal(metrics.rxBytesPerSecond, 1000);
  assert.equal(metrics.txBytesPerSecond, 500);
});

test("performance metrics do not calculate process CPU across app changes", () => {
  const previous = sample({
    timestamp_ms: 1_000,
    packageName: "com.example.old",
    pid: 100,
    processCpu: 500,
    cpuTotal: 1_000,
    cpuIdle: 200,
  });
  const current = sample({
    timestamp_ms: 2_000,
    packageName: "com.example.new",
    pid: 200,
    processCpu: 800,
    cpuTotal: 1_500,
    cpuIdle: 300,
  });

  const metrics = calculatePerformanceMetrics(previous, current);

  assert.equal(metrics.processCpuPercent, null);
  assert.equal(metrics.systemCpuPercent, 80);
});

test("performance trend points derive chart-ready values from adjacent samples", () => {
  const points = buildPerformanceTrendPoints([
    sample({
      timestamp_ms: 1_000,
      processCpu: 100,
      cpuTotal: 1_000,
      cpuIdle: 200,
      rx: 1_024,
      tx: 2_048,
      rssKb: 10_240,
      memUsedKb: 1_048_576,
      gpuBusyPercent: 12,
    }),
    sample({
      timestamp_ms: 3_000,
      processCpu: 150,
      cpuTotal: 1_500,
      cpuIdle: 300,
      rx: 3_072,
      tx: 4_096,
      rssKb: 20_480,
      memUsedKb: 2_097_152,
      gpuBusyPercent: 24,
    }),
  ]);

  assert.equal(points.length, 2);
  assert.equal(points[0].processCpuPercent, null);
  assert.equal(points[0].rssMb, 10);
  assert.equal(points[1].processCpuPercent, 10);
  assert.equal(points[1].systemCpuPercent, 80);
  assert.equal(points[1].rssMb, 20);
  assert.equal(points[1].memoryUsedGb, 2);
  assert.equal(points[1].gpuUsagePercent, 24);
  assert.equal(points[1].gpuFrequencyMhz, 500);
  assert.equal(points[1].networkKbPerSecond, 2);
});

test("performance display snapshot keeps last slow metrics during fast samples", () => {
  const slow = sample({
    timestamp_ms: 1_000,
    pssKb: 12_000,
    batteryTemperatureC: 36.5,
    storageAvailableKb: 88_000,
    gpuMemoryTotalBytes: 512 * 1024 * 1024,
  });
  const fast = sample({
    timestamp_ms: 2_000,
    processCpu: 120,
    cpuTotal: 1_200,
    cpuIdle: 300,
  });
  fast.process.pss_kb = null;
  fast.battery.temperature_c = null;
  fast.storage.data_available_kb = null;
  fast.gpu.memory_total_bytes = null;
  fast.frame_stats = null;

  const snapshot = buildPerformanceDisplaySnapshot([slow, fast]);

  assert.ok(snapshot);
  assert.equal(snapshot.sample.timestamp_ms, 2_000);
  assert.equal(snapshot.sample.process.pss_kb, 12_000);
  assert.equal(snapshot.sample.battery.temperature_c, 36.5);
  assert.equal(snapshot.sample.storage.data_available_kb, 88_000);
  assert.equal(snapshot.sample.gpu.memory_total_bytes, 512 * 1024 * 1024);
  assert.equal(snapshot.sample.frame_stats?.p95_frame_ms, 24);
});

test("performance display snapshot does not carry app metrics across target packages", () => {
  const app = sample({
    timestamp_ms: 1_000,
    packageName: "com.example.app",
    pssKb: 12_000,
  });
  const settings = sample({
    timestamp_ms: 2_000,
    packageName: "com.android.settings",
  });
  settings.process.pss_kb = null;
  settings.frame_stats = null;
  settings.gpu.process_memory_bytes = null;

  const snapshot = buildPerformanceDisplaySnapshot([app, settings]);

  assert.ok(snapshot);
  assert.equal(snapshot.sample.target_package, "com.android.settings");
  assert.equal(snapshot.sample.process.pss_kb, null);
  assert.equal(snapshot.sample.frame_stats, null);
});

test("performance GPU diagnostics classify available and limited counter states", () => {
  const available = buildPerformanceGpuDiagnostic(sample({ gpuBusyPercent: 42 }), 42);
  assert.equal(available.status, "usage_available");
  assert.equal(available.hasUsageCounters, true);
  assert.equal(available.hasFrequency, true);
  assert.equal(available.hasMemory, true);

  const limited = sample({});
  limited.gpu = {
    supported: true,
    busy_percent: null,
    busy_time: null,
    total_time: null,
    current_frequency_hz: null,
    max_frequency_hz: null,
    memory_total_bytes: 414_253_056,
    process_memory_bytes: 172_662_784,
    source: "dumpsys gpu",
    reason: "gpu counters permission denied by device",
    raw: "path=/sys/class/devfreq/23100000.gpu\ncur_freq_error=permission denied",
  };
  const limitedDiagnostic = buildPerformanceGpuDiagnostic(limited, null);
  assert.equal(limitedDiagnostic.status, "counters_permission_limited");
  assert.equal(limitedDiagnostic.permissionLimited, true);
  assert.equal(limitedDiagnostic.hasMemory, true);
  assert.deepEqual(limitedDiagnostic.rawLines, [
    "path=/sys/class/devfreq/23100000.gpu",
    "cur_freq_error=permission denied",
  ]);

  const memoryOnly = sample({});
  memoryOnly.gpu = {
    ...limited.gpu,
    source: "dumpsys gpu",
    reason: null,
    raw: null,
  };
  const memoryOnlyDiagnostic = buildPerformanceGpuDiagnostic(memoryOnly, null);
  assert.equal(memoryOnlyDiagnostic.status, "memory_only");

  const unavailable = sample({});
  unavailable.gpu = {
    supported: false,
    busy_percent: null,
    busy_time: null,
    total_time: null,
    current_frequency_hz: null,
    max_frequency_hz: null,
    memory_total_bytes: null,
    process_memory_bytes: null,
    source: null,
    reason: "gpu sysfs counters unavailable",
    raw: null,
  };
  const unavailableDiagnostic = buildPerformanceGpuDiagnostic(unavailable, null);
  assert.equal(unavailableDiagnostic.status, "unavailable");
  assert.equal(unavailableDiagnostic.hasUsageCounters, false);
});

test("performance overview panels stay in a two-column desktop layout", () => {
  const source = readFileSync(new URL("../src/components/PerformancePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /grid grid-cols-1 xl:grid-cols-2 gap-4/);
  assert.doesNotMatch(source, /xl:grid-cols-4/);
});

test("performance bounded metrics show real limits without synthetic percent caps", () => {
  const source = readFileSync(new URL("../src/components/PerformancePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /formatPercent\(displayMetrics\.processCpuPercent\)/);
  assert.match(source, /formatPercent\(displayMetrics\.systemCpuPercent\)/);
  assert.doesNotMatch(source, /formatPercentLimit/);
  assert.doesNotMatch(source, /\/ 100%/);
  assert.match(source, /formatLimitPair/);
  assert.match(source, /formatCpuFrequencyPair\(displaySample\)/);
  assert.match(source, /formatGpuFrequencyPair\(displaySample\)/);
  assert.match(source, /formatStoragePair\(displaySample\)/);
  assert.match(source, /formatGpuMemory\(displaySample\)/);
  assert.match(source, /performance\.cpuFrequency/);
  assert.match(source, /overflowWrap: "anywhere"/);
});

test("performance GPU diagnostics default to collapsed details", () => {
  const source = readFileSync(new URL("../src/components/PerformancePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /\{expanded && \(/);
  assert.match(source, /<details className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">/);
});

test("performance sample timeout is detectable without waiting for the default watchdog", async () => {
  await assert.rejects(
    withPerformanceSampleTimeout(new Promise(() => undefined), 1),
    (error) => {
      assert.equal(isPerformanceSampleTimeout(error), true);
      assert.equal((error as Error).message, PERFORMANCE_SAMPLE_TIMEOUT_ERROR);
      return true;
    },
  );
});

test("performance exports include metadata and csv headers", () => {
  const samples = [sample({ timestamp_ms: 42, packageName: "com.example.app" })];
  const json = JSON.parse(
    buildPerformanceJsonExport(
      {
        deviceLabel: "QA TV",
        deviceSerial: "USB123",
        lockedPackage: "com.example.app",
        startedAtMs: 1,
        exportedAtMs: 2,
        sampleIntervalMs: 500,
      },
      samples,
    ),
  );
  const csv = buildPerformanceCsvExport(samples);

  assert.equal(json.meta.sampleCount, 1);
  assert.equal(json.meta.fastIntervalMs, 500);
  assert.equal(json.samples[0].target_package, "com.example.app");
  assert.match(csv, /gpu_busy_percent/);
  assert.match(csv, /gpu_memory_total_bytes/);
  assert.match(csv, /^timestamp_ms,target_package,foreground_package/);
  assert.match(csv, /42,com\.example\.app,com\.example\.app/);
});

function sample(overrides: {
  timestamp_ms?: number;
  packageName?: string;
  pid?: number;
  processCpu?: number;
  cpuTotal?: number;
  cpuIdle?: number;
  rx?: number;
  tx?: number;
  rssKb?: number;
  pssKb?: number;
  memUsedKb?: number;
  gpuBusyPercent?: number;
  gpuBusy?: number;
  gpuTotal?: number;
  gpuMemoryTotalBytes?: number;
  batteryTemperatureC?: number;
  storageAvailableKb?: number;
}): PerformanceSample {
  const packageName = overrides.packageName ?? "com.example.app";
  return {
    timestamp_ms: overrides.timestamp_ms ?? 0,
    device_serial: "USB123",
    sample_source: "adb",
    agent_status: null,
    target_package: packageName,
    foreground_package: packageName,
    foreground_activity: ".MainActivity",
    pid: overrides.pid ?? 123,
    process: {
      package_name: packageName,
      pid: overrides.pid ?? 123,
      state: "R",
      cpu_jiffies: overrides.processCpu ?? 0,
      rss_kb: overrides.rssKb ?? 10_000,
      pss_kb: overrides.pssKb ?? 9_000,
      thread_count: 20,
      running: true,
    },
    system: {
      cpu_total_jiffies: overrides.cpuTotal ?? 0,
      cpu_idle_jiffies: overrides.cpuIdle ?? 0,
      mem_total_kb: 1_000_000,
      mem_available_kb: 500_000,
      mem_used_kb: overrides.memUsedKb ?? 500_000,
      cpu_frequency: {
        average_current_khz: 1_000_000,
        average_max_khz: 2_000_000,
        online_cores: 4,
      },
    },
    battery: {
      level_percent: 80,
      status: "charging",
      temperature_c: overrides.batteryTemperatureC ?? 35,
    },
    thermal: {
      status: 0,
      status_label: "none",
      raw: null,
    },
    display: {
      size: "1920x1080",
      density: "320",
      refresh_rate_hz: 60,
    },
    network: {
      rx_bytes: overrides.rx ?? 0,
      tx_bytes: overrides.tx ?? 0,
    },
    storage: {
      data_total_kb: 100_000,
      data_used_kb: 60_000,
      data_available_kb: overrides.storageAvailableKb ?? 40_000,
    },
    gpu: {
      supported: true,
      busy_percent: overrides.gpuBusyPercent ?? null,
      busy_time: overrides.gpuBusy ?? 10,
      total_time: overrides.gpuTotal ?? 100,
      current_frequency_hz: 500_000_000,
      max_frequency_hz: 800_000_000,
      memory_total_bytes: overrides.gpuMemoryTotalBytes ?? 256 * 1024 * 1024,
      process_memory_bytes: null,
      source: "/sys/class/kgsl/kgsl-3d0",
      reason: null,
      raw: null,
    },
    frame_stats: {
      supported: true,
      frame_count: 60,
      fps: 58,
      average_frame_ms: 16,
      p50_frame_ms: 15,
      p95_frame_ms: 24,
      jank_count: 3,
      jank_rate: 5,
      reason: null,
    },
    unavailable: [],
  };
}
