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
  | "imageCast"
  | "clipboard"
  | "logcat"
  | "packages";
