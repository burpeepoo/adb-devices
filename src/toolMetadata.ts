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
import { createElement, type CSSProperties, type ComponentType } from "react";
import type { TabKey } from "./types";

export interface ToolIconProps {
  size?: string | number;
  style?: CSSProperties;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

export type ToolIcon = ComponentType<ToolIconProps>;

export const FileManagerIcon: ToolIcon = ({ size = 24, style, className, ...props }) =>
  createElement(
    "svg",
    {
      ...props,
      className,
      style,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    createElement("path", {
      d: "M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v1",
    }),
    createElement("path", {
      d: "m2 18 2.4-6a2 2 0 0 1 1.86-1.26H20a2 2 0 0 1 1.86 2.74l-2 5A2 2 0 0 1 18 20",
    }),
  );

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
  files: "tabs.fileManager",
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
  files: FileManagerIcon,
  performance: IconActivityHeartbeat,
  packages: IconPackages,
};
