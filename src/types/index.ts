export interface DeviceInfo {
  serial: string;
  device_sn: string;
  state: "device" | "offline" | "unauthorized" | "disconnected";
  model: string;
  product: string;
  connection_type: "usb" | "wireless" | "unknown";
}

export interface DeviceSummary {
  android_version: string;
  api_level: string;
  build_tags: string;
  verified_boot_state: string;
  vbmeta_device_state: string;
  bootloader_state: string;
  battery_level: string;
  battery_status: string;
  display_size: string;
  display_density: string;
  display_physical_size_mm: string;
  storage: string;
  foreground_app: string;
  security_patch: string;
  selinux: string;
  uptime: string;
  cpu_abi: string;
  build_fingerprint: string;
}

export interface DeviceHistoryItem extends DeviceInfo {
  lastSeen: number;
}

export interface MdnsDevice {
  service_name: string;
  service_type: string;
  ip: string;
  port: string;
  address: string;
  connectable: boolean;
}

export interface PackageInfo {
  name: string;
  version_name: string;
  version_code: string;
  device_serial: string;
  build_number: string;
}

export interface LaunchableApp {
  package_name: string;
  activity_name: string;
  component_name: string;
  label: string;
  icon_data_url: string | null;
}

export interface LaunchableAppAsset {
  package_name: string;
  activity_name: string;
  label: string | null;
  icon_data_url: string | null;
  cache_stale: boolean;
}

export interface ExportedApk {
  package_name: string;
  output_dir: string;
  files: string[];
}

export interface LogcatEntry {
  timestamp: string;
  level: string;
  pid: string;
  tag: string;
  message: string;
}

export interface PerformanceSample {
  timestamp_ms: number;
  device_serial: string;
  target_package: string | null;
  foreground_package: string | null;
  foreground_activity: string | null;
  pid: number | null;
  process: PerformanceProcessSample;
  system: PerformanceSystemSample;
  battery: PerformanceBatterySample;
  thermal: PerformanceThermalSample;
  display: PerformanceDisplaySample;
  network: PerformanceNetworkSample;
  storage: PerformanceStorageSample;
  gpu: PerformanceGpuSample;
  frame_stats: PerformanceFrameStats | null;
  unavailable: string[];
}

export interface PerformanceProcessSample {
  package_name: string | null;
  pid: number | null;
  state: string | null;
  cpu_jiffies: number | null;
  rss_kb: number | null;
  pss_kb: number | null;
  thread_count: number | null;
  running: boolean;
}

export interface PerformanceSystemSample {
  cpu_total_jiffies: number | null;
  cpu_idle_jiffies: number | null;
  mem_total_kb: number | null;
  mem_available_kb: number | null;
  mem_used_kb: number | null;
  cpu_frequency: {
    average_current_khz: number | null;
    average_max_khz: number | null;
    online_cores: number;
  };
}

export interface PerformanceBatterySample {
  level_percent: number | null;
  status: string | null;
  temperature_c: number | null;
}

export interface PerformanceThermalSample {
  status: number | null;
  status_label: string | null;
  raw: string | null;
}

export interface PerformanceDisplaySample {
  size: string | null;
  density: string | null;
  refresh_rate_hz: number | null;
}

export interface PerformanceNetworkSample {
  rx_bytes: number | null;
  tx_bytes: number | null;
}

export interface PerformanceStorageSample {
  data_total_kb: number | null;
  data_used_kb: number | null;
  data_available_kb: number | null;
}

export interface PerformanceGpuSample {
  supported: boolean;
  busy_percent: number | null;
  busy_time: number | null;
  total_time: number | null;
  current_frequency_hz: number | null;
  max_frequency_hz: number | null;
  memory_total_bytes: number | null;
  process_memory_bytes: number | null;
  source: string | null;
  reason: string | null;
  raw: string | null;
}

export interface PerformanceFrameStats {
  supported: boolean;
  frame_count: number;
  fps: number | null;
  average_frame_ms: number | null;
  p50_frame_ms: number | null;
  p95_frame_ms: number | null;
  jank_count: number;
  jank_rate: number | null;
  reason: string | null;
}

export interface AppSettings {
  screenshotDir: string;
  recordingDir: string;
  recentApkDir: string;
  languagePreference?: LanguagePreference;
  autoCheckUpdates?: boolean;
}

export type LanguagePreference = "system" | "en-US" | "zh-CN";

export interface PairConnectSettings {
  pairIp: string;
  pairPort: string;
  connectIp: string;
  connectPort: string;
  recentConnects?: RecentConnectEndpoint[];
}

export interface RecentConnectEndpoint {
  ip: string;
  port: string;
  lastConnectedAt: number;
}

export type TabKey =
  | "pair"
  | "workbench"
  | "install"
  | "screenshot"
  | "record"
  | "mirror"
  | "remote"
  | "imageCast"
  | "clipboard"
  | "logcat"
  | "performance"
  | "packages";
