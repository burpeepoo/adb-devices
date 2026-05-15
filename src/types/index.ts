export interface DeviceInfo {
  serial: string;
  device_sn: string;
  state: "device" | "offline" | "unauthorized" | "disconnected";
  model: string;
  product: string;
  connection_type: "usb" | "wireless" | "unknown";
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
}

export interface PairConnectSettings {
  pairIp: string;
  pairPort: string;
  connectIp: string;
  connectPort: string;
}

export type TabKey =
  | "pair"
  | "install"
  | "screenshot"
  | "record"
  | "mirror"
  | "clipboard"
  | "logcat"
  | "packages";
