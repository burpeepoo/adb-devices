export interface DeviceInfo {
  serial: string;
  state: "device" | "offline" | "unauthorized" | "disconnected";
  model: string;
  product: string;
  connection_type: "usb" | "wireless" | "unknown";
}

export interface DeviceHistoryItem extends DeviceInfo {
  lastSeen: number;
}

export interface PackageInfo {
  name: string;
  version_name: string;
  version_code: string;
  device_serial: string;
  build_number: string;
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
  | "clipboard"
  | "logcat"
  | "packages";
