export interface DeviceInfo {
  serial: string;
  state: "device" | "offline" | "unauthorized" | "disconnected";
  model: string;
  product: string;
}

export interface PackageInfo {
  name: string;
  version_name: string;
  version_code: string;
  build_id: string;
}

export interface AppSettings {
  screenshotDir: string;
  recordingDir: string;
}

export type TabKey = "pair" | "install" | "screenshot" | "record" | "packages";
