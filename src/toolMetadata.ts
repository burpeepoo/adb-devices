import {
  IconActivityHeartbeat,
  IconApps,
  IconCamera,
  IconClipboard,
  IconColorSwatch,
  IconDeviceMobileCode,
  IconDevicesPc,
  IconListDetails,
  IconPackages,
  IconPhotoUp,
  IconPlugConnected,
  IconRobot,
  IconTerminal2,
  IconVideo,
} from "@tabler/icons-react";
import type { TabKey } from "./types";

export type ToolIcon = typeof IconPlugConnected;

export const toolLabelKeys: Record<TabKey, string> = {
  pair: "tabs.pairConnect",
  workbench: "tabs.workbench",
  install: "tabs.apkInstall",
  screenshot: "tabs.screenshot",
  record: "tabs.screenRecord",
  mirror: "tabs.screenMirror",
  remote: "tabs.remoteControl",
  imageCast: "tabs.imageCast",
  clipboard: "tabs.clipboard",
  logcat: "tabs.logcat",
  displayCalibration: "tabs.displayCalibration",
  agent: "tabs.agent",
  performance: "tabs.performance",
  packages: "tabs.packageList",
};

export const toolIcons: Record<TabKey, ToolIcon> = {
  pair: IconPlugConnected,
  workbench: IconTerminal2,
  install: IconApps,
  screenshot: IconCamera,
  record: IconVideo,
  mirror: IconDevicesPc,
  remote: IconDeviceMobileCode,
  imageCast: IconPhotoUp,
  clipboard: IconClipboard,
  logcat: IconListDetails,
  displayCalibration: IconColorSwatch,
  agent: IconRobot,
  performance: IconActivityHeartbeat,
  packages: IconPackages,
};
