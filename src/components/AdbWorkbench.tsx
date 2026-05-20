import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import PackageNameInput from "./PackageNameInput";

type WorkbenchMode = "library" | "templates" | "custom";
type WorkbenchRisk = "low" | "medium" | "high";
type ParamType = "text" | "package" | "select";

interface ParamDef {
  name: string;
  labelKey: string;
  type: ParamType;
  required?: boolean;
  defaultValue?: string;
  placeholderKey?: string;
  options?: { value: string; labelKey: string }[];
}

interface WorkbenchItem {
  id: string;
  kind: "action" | "template" | "saved";
  titleKey?: string;
  descriptionKey?: string;
  title?: string;
  description?: string;
  categoryKey: string;
  risk: WorkbenchRisk;
  params: ParamDef[];
  buildCommand: (values: Record<string, string>) => string[];
  savedCommand?: string;
}

interface SavedTemplate {
  id: string;
  title: string;
  command: string;
  risk: WorkbenchRisk;
  createdAt: number;
}

interface WorkbenchHistoryItem {
  id: string;
  command: string;
  deviceSerial: string | null;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  createdAt: number;
  mode?: WorkbenchMode;
  itemId?: string;
  values?: Record<string, string>;
  customCommand?: string;
  risk?: WorkbenchRisk;
}

interface WorkbenchCommandResult {
  command: string;
  risk: WorkbenchRisk;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

interface Props {
  deviceSerial: string | null;
}

const MAX_HISTORY = 30;

const PARAMS = {
  packageName: { name: "packageName", labelKey: "workbench.params.packageName", type: "package" as const, required: true, placeholderKey: "workbench.placeholders.packageName" },
  componentName: { name: "componentName", labelKey: "workbench.params.componentName", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.componentName" },
  propKey: { name: "key", labelKey: "workbench.params.propKey", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.propKey" },
  propValue: { name: "value", labelKey: "workbench.params.value", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.value" },
  activity: { name: "activity", labelKey: "workbench.params.activity", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.activity" },
  permission: { name: "permission", labelKey: "workbench.params.permission", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.permission" },
  apkPath: { name: "apkPath", labelKey: "workbench.params.apkPath", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.apkPath" },
  localPath: { name: "localPath", labelKey: "workbench.params.localPath", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.localPath" },
  remotePath: { name: "remotePath", labelKey: "workbench.params.remotePath", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.remotePath" },
  directoryPath: { name: "remotePath", labelKey: "workbench.params.remotePath", type: "text" as const, required: true, defaultValue: "/sdcard/Download", placeholderKey: "workbench.placeholders.directoryPath" },
  screenshotPath: { name: "remotePath", labelKey: "workbench.params.remotePath", type: "text" as const, required: true, defaultValue: "/sdcard/Download/screenshot.png", placeholderKey: "workbench.placeholders.screenshotPath" },
  recordingPath: { name: "remotePath", labelKey: "workbench.params.remotePath", type: "text" as const, required: true, defaultValue: "/sdcard/Download/screenrecord.mp4", placeholderKey: "workbench.placeholders.recordingPath" },
  seconds: { name: "seconds", labelKey: "workbench.params.seconds", type: "text" as const, required: true, defaultValue: "10", placeholderKey: "workbench.placeholders.seconds" },
  keyevent: { name: "keyevent", labelKey: "workbench.params.keyevent", type: "text" as const, required: true, defaultValue: "3", placeholderKey: "workbench.placeholders.keyevent" },
  x: { name: "x", labelKey: "workbench.params.x", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.x" },
  y: { name: "y", labelKey: "workbench.params.y", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.y" },
  x1: { name: "x1", labelKey: "workbench.params.x1", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.x1" },
  y1: { name: "y1", labelKey: "workbench.params.y1", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.y1" },
  x2: { name: "x2", labelKey: "workbench.params.x2", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.x2" },
  y2: { name: "y2", labelKey: "workbench.params.y2", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.y2" },
  duration: { name: "duration", labelKey: "workbench.params.duration", type: "text" as const, required: false, defaultValue: "300", placeholderKey: "workbench.placeholders.duration" },
  logQuery: { name: "query", labelKey: "workbench.params.query", type: "text" as const, required: false, placeholderKey: "workbench.placeholders.query" },
  text: { name: "text", labelKey: "workbench.params.text", type: "text" as const, required: true, placeholderKey: "workbench.placeholders.text" },
  settingsNamespace: {
    name: "namespace",
    labelKey: "workbench.params.namespace",
    type: "select" as const,
    required: true,
    defaultValue: "global",
    options: [
      { value: "global", labelKey: "workbench.namespaces.global" },
      { value: "system", labelKey: "workbench.namespaces.system" },
      { value: "secure", labelKey: "workbench.namespaces.secure" },
    ],
  },
  installMode: {
    name: "installMode",
    labelKey: "workbench.params.installMode",
    type: "select" as const,
    required: true,
    defaultValue: "replace",
    options: [
      { value: "replace", labelKey: "workbench.installModes.replace" },
      { value: "grant", labelKey: "workbench.installModes.grant" },
      { value: "downgrade", labelKey: "workbench.installModes.downgrade" },
      { value: "test", labelKey: "workbench.installModes.test" },
    ],
  },
};

const buildInstallCommand = (values: Record<string, string>) => {
  switch (values.installMode) {
    case "grant":
      return ["install", "-r", "-g", values.apkPath];
    case "downgrade":
      return ["install", "-r", "-d", values.apkPath];
    case "test":
      return ["install", "-r", "-t", values.apkPath];
    default:
      return ["install", "-r", values.apkPath];
  }
};

const CATALOG: WorkbenchItem[] = [
  {
    id: "device.props",
    kind: "action",
    titleKey: "workbench.catalog.deviceProps.title",
    descriptionKey: "workbench.catalog.deviceProps.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop"],
  },
  {
    id: "device.model",
    kind: "action",
    titleKey: "workbench.catalog.deviceModel.title",
    descriptionKey: "workbench.catalog.deviceModel.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop", "ro.product.model"],
  },
  {
    id: "device.serial",
    kind: "action",
    titleKey: "workbench.catalog.deviceSerial.title",
    descriptionKey: "workbench.catalog.deviceSerial.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop", "ro.serialno"],
  },
  {
    id: "device.androidVersion",
    kind: "action",
    titleKey: "workbench.catalog.androidVersion.title",
    descriptionKey: "workbench.catalog.androidVersion.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop", "ro.build.version.release"],
  },
  {
    id: "device.sdk",
    kind: "action",
    titleKey: "workbench.catalog.sdkVersion.title",
    descriptionKey: "workbench.catalog.sdkVersion.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop", "ro.build.version.sdk"],
  },
  {
    id: "device.cpuAbi",
    kind: "action",
    titleKey: "workbench.catalog.cpuAbi.title",
    descriptionKey: "workbench.catalog.cpuAbi.desc",
    categoryKey: "workbench.categories.device",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "getprop", "ro.product.cpu.abi"],
  },
  {
    id: "display.size",
    kind: "action",
    titleKey: "workbench.catalog.displaySize.title",
    descriptionKey: "workbench.catalog.displaySize.desc",
    categoryKey: "workbench.categories.display",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "wm", "size"],
  },
  {
    id: "display.density",
    kind: "action",
    titleKey: "workbench.catalog.displayDensity.title",
    descriptionKey: "workbench.catalog.displayDensity.desc",
    categoryKey: "workbench.categories.display",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "wm", "density"],
  },
  {
    id: "display.currentFocus",
    kind: "action",
    titleKey: "workbench.catalog.currentFocus.title",
    descriptionKey: "workbench.catalog.currentFocus.desc",
    categoryKey: "workbench.categories.display",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "window"],
  },
  {
    id: "media.screenshot",
    kind: "template",
    titleKey: "workbench.catalog.screenshot.title",
    descriptionKey: "workbench.catalog.screenshot.desc",
    categoryKey: "workbench.categories.media",
    risk: "low",
    params: [PARAMS.screenshotPath],
    buildCommand: (values) => ["shell", "screencap", "-p", values.remotePath],
  },
  {
    id: "media.screenrecord",
    kind: "template",
    titleKey: "workbench.catalog.screenrecord.title",
    descriptionKey: "workbench.catalog.screenrecord.desc",
    categoryKey: "workbench.categories.media",
    risk: "low",
    params: [PARAMS.seconds, PARAMS.recordingPath],
    buildCommand: (values) => ["shell", "screenrecord", "--time-limit", values.seconds, values.remotePath],
  },
  {
    id: "files.listDir",
    kind: "template",
    titleKey: "workbench.catalog.listDirectory.title",
    descriptionKey: "workbench.catalog.listDirectory.desc",
    categoryKey: "workbench.categories.files",
    risk: "low",
    params: [PARAMS.directoryPath],
    buildCommand: (values) => ["shell", "ls", "-la", values.remotePath],
  },
  {
    id: "files.pull",
    kind: "template",
    titleKey: "workbench.catalog.pullFile.title",
    descriptionKey: "workbench.catalog.pullFile.desc",
    categoryKey: "workbench.categories.files",
    risk: "low",
    params: [PARAMS.remotePath, PARAMS.localPath],
    buildCommand: (values) => ["pull", values.remotePath, values.localPath],
  },
  {
    id: "files.push",
    kind: "template",
    titleKey: "workbench.catalog.pushFile.title",
    descriptionKey: "workbench.catalog.pushFile.desc",
    categoryKey: "workbench.categories.files",
    risk: "medium",
    params: [PARAMS.localPath, PARAMS.remotePath],
    buildCommand: (values) => ["push", values.localPath, values.remotePath],
  },
  {
    id: "network.ip",
    kind: "action",
    titleKey: "workbench.catalog.networkIp.title",
    descriptionKey: "workbench.catalog.networkIp.desc",
    categoryKey: "workbench.categories.network",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "ip", "addr"],
  },
  {
    id: "network.route",
    kind: "action",
    titleKey: "workbench.catalog.networkRoute.title",
    descriptionKey: "workbench.catalog.networkRoute.desc",
    categoryKey: "workbench.categories.network",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "ip", "route"],
  },
  {
    id: "network.wifi",
    kind: "action",
    titleKey: "workbench.catalog.wifiStatus.title",
    descriptionKey: "workbench.catalog.wifiStatus.desc",
    categoryKey: "workbench.categories.network",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "wifi"],
  },
  {
    id: "app.list",
    kind: "action",
    titleKey: "workbench.catalog.appList.title",
    descriptionKey: "workbench.catalog.appList.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "pm", "list", "packages"],
  },
  {
    id: "app.installApk",
    kind: "template",
    titleKey: "workbench.catalog.installApk.title",
    descriptionKey: "workbench.catalog.installApk.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.apkPath, PARAMS.installMode],
    buildCommand: buildInstallCommand,
  },
  {
    id: "app.installExisting",
    kind: "template",
    titleKey: "workbench.catalog.installExisting.title",
    descriptionKey: "workbench.catalog.installExisting.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "cmd", "package", "install-existing", values.packageName],
  },
  {
    id: "app.listThirdParty",
    kind: "action",
    titleKey: "workbench.catalog.appListThirdParty.title",
    descriptionKey: "workbench.catalog.appListThirdParty.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "pm", "list", "packages", "-3"],
  },
  {
    id: "app.listSystem",
    kind: "action",
    titleKey: "workbench.catalog.appListSystem.title",
    descriptionKey: "workbench.catalog.appListSystem.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "pm", "list", "packages", "-s"],
  },
  {
    id: "app.listDisabled",
    kind: "action",
    titleKey: "workbench.catalog.appListDisabled.title",
    descriptionKey: "workbench.catalog.appListDisabled.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "pm", "list", "packages", "-d"],
  },
  {
    id: "app.listPermissions",
    kind: "action",
    titleKey: "workbench.catalog.listPermissions.title",
    descriptionKey: "workbench.catalog.listPermissions.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "pm", "list", "permissions", "-g", "-d"],
  },
  {
    id: "app.path",
    kind: "action",
    titleKey: "workbench.catalog.appPath.title",
    descriptionKey: "workbench.catalog.appPath.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "pm", "path", values.packageName],
  },
  {
    id: "app.packageDump",
    kind: "action",
    titleKey: "workbench.catalog.packageDump.title",
    descriptionKey: "workbench.catalog.packageDump.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "dumpsys", "package", values.packageName],
  },
  {
    id: "app.monkeyLaunch",
    kind: "template",
    titleKey: "workbench.catalog.monkeyLaunch.title",
    descriptionKey: "workbench.catalog.monkeyLaunch.desc",
    categoryKey: "workbench.categories.app",
    risk: "low",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "monkey", "-p", values.packageName, "-c", "android.intent.category.LAUNCHER", "1"],
  },
  {
    id: "app.disable",
    kind: "template",
    titleKey: "workbench.catalog.disableApp.title",
    descriptionKey: "workbench.catalog.disableApp.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "pm", "disable-user", values.packageName],
  },
  {
    id: "app.enable",
    kind: "template",
    titleKey: "workbench.catalog.enableApp.title",
    descriptionKey: "workbench.catalog.enableApp.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "pm", "enable", values.packageName],
  },
  {
    id: "app.uninstall",
    kind: "template",
    titleKey: "workbench.catalog.uninstall.title",
    descriptionKey: "workbench.catalog.uninstall.desc",
    categoryKey: "workbench.categories.app",
    risk: "high",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["uninstall", values.packageName],
  },
  {
    id: "app.clearData",
    kind: "action",
    titleKey: "workbench.catalog.clearData.title",
    descriptionKey: "workbench.catalog.clearData.desc",
    categoryKey: "workbench.categories.app",
    risk: "high",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "pm", "clear", values.packageName],
  },
  {
    id: "app.forceStop",
    kind: "action",
    titleKey: "workbench.catalog.forceStop.title",
    descriptionKey: "workbench.catalog.forceStop.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "am", "force-stop", values.packageName],
  },
  {
    id: "app.start",
    kind: "template",
    titleKey: "workbench.catalog.startActivity.title",
    descriptionKey: "workbench.catalog.startActivity.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.activity],
    buildCommand: (values) => ["shell", "am", "start", "-n", values.activity],
  },
  {
    id: "permission.grant",
    kind: "template",
    titleKey: "workbench.catalog.grant.title",
    descriptionKey: "workbench.catalog.grant.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName, PARAMS.permission],
    buildCommand: (values) => ["shell", "pm", "grant", values.packageName, values.permission],
  },
  {
    id: "permission.revoke",
    kind: "template",
    titleKey: "workbench.catalog.revoke.title",
    descriptionKey: "workbench.catalog.revoke.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.packageName, PARAMS.permission],
    buildCommand: (values) => ["shell", "pm", "revoke", values.packageName, values.permission],
  },
  {
    id: "component.enable",
    kind: "template",
    titleKey: "workbench.catalog.enableComponent.title",
    descriptionKey: "workbench.catalog.enableComponent.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.componentName],
    buildCommand: (values) => ["shell", "pm", "enable", values.componentName],
  },
  {
    id: "component.disable",
    kind: "template",
    titleKey: "workbench.catalog.disableComponent.title",
    descriptionKey: "workbench.catalog.disableComponent.desc",
    categoryKey: "workbench.categories.app",
    risk: "medium",
    params: [PARAMS.componentName],
    buildCommand: (values) => ["shell", "pm", "disable-user", values.componentName],
  },
  {
    id: "system.setprop",
    kind: "template",
    titleKey: "workbench.catalog.setprop.title",
    descriptionKey: "workbench.catalog.setprop.desc",
    categoryKey: "workbench.categories.system",
    risk: "medium",
    params: [PARAMS.propKey, PARAMS.propValue],
    buildCommand: (values) => ["shell", "setprop", values.key, values.value],
  },
  {
    id: "settings.put",
    kind: "template",
    titleKey: "workbench.catalog.settingsPut.title",
    descriptionKey: "workbench.catalog.settingsPut.desc",
    categoryKey: "workbench.categories.system",
    risk: "medium",
    params: [PARAMS.settingsNamespace, PARAMS.propKey, PARAMS.propValue],
    buildCommand: (values) => ["shell", "settings", "put", values.namespace, values.key, values.value],
  },
  {
    id: "settings.get",
    kind: "template",
    titleKey: "workbench.catalog.settingsGet.title",
    descriptionKey: "workbench.catalog.settingsGet.desc",
    categoryKey: "workbench.categories.system",
    risk: "low",
    params: [PARAMS.settingsNamespace, PARAMS.propKey],
    buildCommand: (values) => ["shell", "settings", "get", values.namespace, values.key],
  },
  {
    id: "system.date",
    kind: "action",
    titleKey: "workbench.catalog.deviceDate.title",
    descriptionKey: "workbench.catalog.deviceDate.desc",
    categoryKey: "workbench.categories.system",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "date"],
  },
  {
    id: "diagnostics.dumpsysActivity",
    kind: "template",
    titleKey: "workbench.catalog.dumpsysActivity.title",
    descriptionKey: "workbench.catalog.dumpsysActivity.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "activity", "top"],
  },
  {
    id: "diagnostics.meminfo",
    kind: "template",
    titleKey: "workbench.catalog.meminfo.title",
    descriptionKey: "workbench.catalog.meminfo.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [PARAMS.packageName],
    buildCommand: (values) => ["shell", "dumpsys", "meminfo", values.packageName],
  },
  {
    id: "diagnostics.cpuTop",
    kind: "action",
    titleKey: "workbench.catalog.cpuTop.title",
    descriptionKey: "workbench.catalog.cpuTop.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "top", "-n", "1"],
  },
  {
    id: "diagnostics.processes",
    kind: "action",
    titleKey: "workbench.catalog.processes.title",
    descriptionKey: "workbench.catalog.processes.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "ps", "-A"],
  },
  {
    id: "diagnostics.diskUsage",
    kind: "action",
    titleKey: "workbench.catalog.diskUsage.title",
    descriptionKey: "workbench.catalog.diskUsage.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "df", "-h"],
  },
  {
    id: "diagnostics.storage",
    kind: "action",
    titleKey: "workbench.catalog.storage.title",
    descriptionKey: "workbench.catalog.storage.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "diskstats"],
  },
  {
    id: "diagnostics.input",
    kind: "action",
    titleKey: "workbench.catalog.dumpsysInput.title",
    descriptionKey: "workbench.catalog.dumpsysInput.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "input"],
  },
  {
    id: "power.battery",
    kind: "action",
    titleKey: "workbench.catalog.battery.title",
    descriptionKey: "workbench.catalog.battery.desc",
    categoryKey: "workbench.categories.power",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "dumpsys", "battery"],
  },
  {
    id: "power.wake",
    kind: "action",
    titleKey: "workbench.catalog.wake.title",
    descriptionKey: "workbench.catalog.wake.desc",
    categoryKey: "workbench.categories.power",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "input", "keyevent", "224"],
  },
  {
    id: "power.sleep",
    kind: "action",
    titleKey: "workbench.catalog.sleep.title",
    descriptionKey: "workbench.catalog.sleep.desc",
    categoryKey: "workbench.categories.power",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "input", "keyevent", "223"],
  },
  {
    id: "input.keyevent",
    kind: "template",
    titleKey: "workbench.catalog.keyevent.title",
    descriptionKey: "workbench.catalog.keyevent.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [PARAMS.keyevent],
    buildCommand: (values) => ["shell", "input", "keyevent", values.keyevent],
  },
  {
    id: "input.back",
    kind: "action",
    titleKey: "workbench.catalog.back.title",
    descriptionKey: "workbench.catalog.back.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "input", "keyevent", "4"],
  },
  {
    id: "input.home",
    kind: "action",
    titleKey: "workbench.catalog.home.title",
    descriptionKey: "workbench.catalog.home.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "input", "keyevent", "3"],
  },
  {
    id: "input.recents",
    kind: "action",
    titleKey: "workbench.catalog.recents.title",
    descriptionKey: "workbench.catalog.recents.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [],
    buildCommand: () => ["shell", "input", "keyevent", "187"],
  },
  {
    id: "input.tap",
    kind: "template",
    titleKey: "workbench.catalog.tap.title",
    descriptionKey: "workbench.catalog.tap.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [PARAMS.x, PARAMS.y],
    buildCommand: (values) => ["shell", "input", "tap", values.x, values.y],
  },
  {
    id: "input.swipe",
    kind: "template",
    titleKey: "workbench.catalog.swipe.title",
    descriptionKey: "workbench.catalog.swipe.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [PARAMS.x1, PARAMS.y1, PARAMS.x2, PARAMS.y2, PARAMS.duration],
    buildCommand: (values) => ["shell", "input", "swipe", values.x1, values.y1, values.x2, values.y2, values.duration],
  },
  {
    id: "input.text",
    kind: "template",
    titleKey: "workbench.catalog.inputText.title",
    descriptionKey: "workbench.catalog.inputText.desc",
    categoryKey: "workbench.categories.input",
    risk: "low",
    params: [PARAMS.text],
    buildCommand: (values) => ["shell", "input", "text", values.text],
  },
  {
    id: "logcat.search",
    kind: "template",
    titleKey: "workbench.catalog.logcatSearch.title",
    descriptionKey: "workbench.catalog.logcatSearch.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "low",
    params: [PARAMS.logQuery],
    buildCommand: (values) => values.query ? ["logcat", "-d", "-v", "time", "-s", values.query] : ["logcat", "-d", "-v", "time"],
  },
  {
    id: "logcat.clear",
    kind: "action",
    titleKey: "workbench.catalog.logcatClear.title",
    descriptionKey: "workbench.catalog.logcatClear.desc",
    categoryKey: "workbench.categories.diagnostics",
    risk: "medium",
    params: [],
    buildCommand: () => ["logcat", "-c"],
  },
];

const valueMapForItem = (item: WorkbenchItem, previous?: Record<string, string>) =>
  item.params.reduce<Record<string, string>>((values, param) => {
    values[param.name] = previous?.[param.name] ?? param.defaultValue ?? "";
    return values;
  }, {});

const quoteArg = (value: string) => {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const commandFromTokens = (tokens: string[]) => tokens.filter(Boolean).map(quoteArg).join(" ");

const commandPreview = (command: string, deviceSerial: string | null) => {
  const prefix = deviceSerial ? `adb -s ${quoteArg(deviceSerial)}` : "adb";
  return `${prefix} ${command}`.trim();
};

const classifyCommandText = (command: string): WorkbenchRisk => {
  const lower = command.toLowerCase();
  if (
    /\bshell\s+pm\s+clear\b/.test(lower) ||
    /\bpm\s+clear\b/.test(lower) ||
    /\buninstall\b/.test(lower) ||
    /\breboot\b/.test(lower) ||
    /\bshell\s+rm\b/.test(lower) ||
    /\bshell\s+dd\b/.test(lower)
  ) {
    return "high";
  }
  if (
    /\bshell\s+setprop\b/.test(lower) ||
    /\bshell\s+settings\s+put\b/.test(lower) ||
    /\bforce-stop\b/.test(lower) ||
    /\bpm\s+(grant|revoke)\b/.test(lower) ||
    /\binstall\b/.test(lower) ||
    /\bpush\b/.test(lower)
  ) {
    return "medium";
  }
  return "low";
};

const riskClasses: Record<WorkbenchRisk, string> = {
  low: "bg-green-50 text-green-700 border-green-100",
  medium: "bg-amber-50 text-amber-700 border-amber-100",
  high: "bg-red-50 text-red-700 border-red-100",
};

const riskOrder: Record<WorkbenchRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const stripAdbPrefix = (command: string) =>
  command.replace(/^adb(?:\s+-s\s+(?:'[^']*'|"[^"]*"|\S+))?\s+/, "");

export default function AdbWorkbench({ deviceSerial }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<WorkbenchMode>("library");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(CATALOG[0].id);
  const [values, setValues] = useState<Record<string, string>>(() => valueMapForItem(CATALOG[0]));
  const [customCommand, setCustomCommand] = useState("shell getprop ro.product.model");
  const [templateName, setTemplateName] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkbenchHistoryItem[]>([]);
  const [executing, setExecuting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [highRiskConfirmed, setHighRiskConfirmed] = useState(false);
  const [result, setResult] = useState<WorkbenchCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStore()
      .then(async (store) => {
        const [saved, recent] = await Promise.all([
          store.get<SavedTemplate[]>(STORE_KEYS.workbenchTemplates),
          store.get<WorkbenchHistoryItem[]>(STORE_KEYS.workbenchHistory),
        ]);
        if (!cancelled) {
          const nextSaved = saved ?? [];
          setSavedTemplates(nextSaved);
          setSelectedTemplateId((current) => current ?? nextSaved[0]?.id ?? null);
          setHistory(recent ?? []);
        }
      })
      .catch(() => {
        // Non-critical. Workbench still works without saved local data.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const savedItems = useMemo<WorkbenchItem[]>(
    () =>
      savedTemplates.map((template) => ({
        id: template.id,
        kind: "saved",
        title: template.title,
        description: template.command,
        categoryKey: "workbench.categories.saved",
        risk: template.risk,
        params: [],
        savedCommand: template.command,
        buildCommand: () => [template.command],
      })),
    [savedTemplates]
  );

  const allItems = useMemo(() => CATALOG, []);
  const selectedTemplate = savedItems.find((item) => item.id === selectedTemplateId) ?? savedItems[0] ?? null;
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(allItems.map((item) => item.categoryKey))).sort((a, b) =>
        t(a).localeCompare(t(b)),
      ),
    [allItems, t],
  );
  const sortedItems = useMemo(
    () =>
      [...allItems].sort((a, b) => {
        const riskDiff = riskOrder[a.risk] - riskOrder[b.risk];
        if (riskDiff !== 0) return riskDiff;

        const categoryDiff = t(a.categoryKey).localeCompare(t(b.categoryKey));
        if (categoryDiff !== 0) return categoryDiff;

        const aTitle = a.title ?? t(a.titleKey ?? "");
        const bTitle = b.title ?? t(b.titleKey ?? "");
        return aTitle.localeCompare(bTitle);
      }),
    [allItems, t],
  );
  const selectedItem = allItems.find((item) => item.id === selectedId) ?? allItems[0];

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const categoryItems =
      categoryFilter === "all"
        ? sortedItems
        : sortedItems.filter((item) => item.categoryKey === categoryFilter);

    if (!normalizedQuery) return categoryItems;

    return categoryItems.filter((item) => {
      const title = item.title ?? t(item.titleKey ?? "");
      const description = item.description ?? t(item.descriptionKey ?? "");
      const category = t(item.categoryKey);
      return `${title} ${description} ${category} ${item.id}`.toLowerCase().includes(normalizedQuery);
    });
  }, [categoryFilter, query, sortedItems, t]);

  const currentCommand = useMemo(() => {
    if (mode === "custom") return customCommand.trim();
    if (mode === "templates") return selectedTemplate?.savedCommand ?? "";
    if (selectedItem.savedCommand) return selectedItem.savedCommand;
    return commandFromTokens(selectedItem.buildCommand(values));
  }, [customCommand, mode, selectedItem, selectedTemplate, values]);

  const currentRisk = mode === "custom" ? classifyCommandText(customCommand) : mode === "templates" ? selectedTemplate?.risk ?? "low" : selectedItem.risk;
  const missingRequired = mode === "library" && selectedItem.params.some((param) => param.required && !values[param.name]?.trim());
  const canExecute = currentCommand.length > 0 && !missingRequired && !executing && (currentRisk !== "high" || highRiskConfirmed);
  const outputExportText = useMemo(() => {
    if (!result && !error) return "";

    const lines = [
      "ADB Workbench Export",
      `Time: ${new Date().toISOString()}`,
      `Device: ${deviceSerial || "default"}`,
      `Risk: ${currentRisk}`,
      `Command: ${result?.command ?? commandPreview(currentCommand, deviceSerial)}`,
      `Exit code: ${result?.exit_code ?? "-"}`,
      "",
      "STDOUT:",
      result?.stdout || "",
      "",
      "STDERR:",
      result?.stderr || error || "",
    ];

    return lines.join("\n");
  }, [currentCommand, currentRisk, deviceSerial, error, result]);

  const chooseItem = (item: WorkbenchItem) => {
    setMode("library");
    setSelectedId(item.id);
    setValues(valueMapForItem(item, values));
    setHighRiskConfirmed(false);
    setResult(null);
    setError(null);
    setExportStatus(null);
    setTemplateStatus(null);
  };

  const chooseTemplate = (item: WorkbenchItem) => {
    setMode("templates");
    setSelectedTemplateId(item.id);
    setHighRiskConfirmed(false);
    setResult(null);
    setError(null);
    setExportStatus(null);
    setTemplateStatus(null);
  };

  const switchMode = (nextMode: WorkbenchMode) => {
    setMode(nextMode);
    setTemplateStatus(null);
  };

  const persistHistory = async (nextHistory: WorkbenchHistoryItem[]) => {
    setHistory(nextHistory);
    await saveStoreValue(STORE_KEYS.workbenchHistory, nextHistory).catch(() => {});
  };

  const executeCommand = async () => {
    if (!canExecute) return;
    setExecuting(true);
    setResult(null);
    setError(null);
    setExportStatus(null);

    try {
      const commandResult = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
        command: currentCommand,
        deviceSerial: deviceSerial || null,
        allowHighRisk: currentRisk === "high" ? highRiskConfirmed : true,
      });
      setResult(commandResult);
      const ok = (commandResult.exit_code ?? 0) === 0 && !commandResult.stderr.toLowerCase().includes("error:");
      const nextHistory = [
        {
          id: `${Date.now()}`,
          command: commandResult.command,
          deviceSerial,
          ok,
          exitCode: commandResult.exit_code,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr,
          createdAt: Date.now(),
          mode,
          itemId: mode === "library" ? selectedItem.id : mode === "templates" ? selectedTemplate?.id : undefined,
          values: mode === "library" ? { ...values } : undefined,
          customCommand: mode === "custom" ? customCommand : undefined,
          risk: currentRisk,
        },
        ...history,
      ].slice(0, MAX_HISTORY);
      await persistHistory(nextHistory);
    } catch (e) {
      const message = String(e);
      setError(message);
      const nextHistory = [
        {
          id: `${Date.now()}`,
          command: commandPreview(currentCommand, deviceSerial),
          deviceSerial,
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: message,
          createdAt: Date.now(),
          mode,
          itemId: mode === "library" ? selectedItem.id : mode === "templates" ? selectedTemplate?.id : undefined,
          values: mode === "library" ? { ...values } : undefined,
          customCommand: mode === "custom" ? customCommand : undefined,
          risk: currentRisk,
        },
        ...history,
      ].slice(0, MAX_HISTORY);
      await persistHistory(nextHistory);
    } finally {
      setExecuting(false);
    }
  };

  const saveCurrentTemplate = async () => {
    const title = templateName.trim();
    if (!title || !currentCommand) return;
    const nextTemplates = [
      {
        id: `saved-${Date.now()}`,
        title,
        command: currentCommand,
        risk: currentRisk,
        createdAt: Date.now(),
      },
      ...savedTemplates,
    ].slice(0, 40);
    setSavedTemplates(nextTemplates);
    setSelectedTemplateId(nextTemplates[0].id);
    setTemplateName("");
    setTemplateStatus(t("workbench.templateSaved"));
    await saveStoreValue(STORE_KEYS.workbenchTemplates, nextTemplates).catch(() => {});
  };

  const removeTemplate = async (templateId: string) => {
    const nextTemplates = savedTemplates.filter((template) => template.id !== templateId);
    setSavedTemplates(nextTemplates);
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId(nextTemplates[0]?.id ?? null);
    }
    setTemplateStatus(t("workbench.templateRemoved"));
    await saveStoreValue(STORE_KEYS.workbenchTemplates, nextTemplates).catch(() => {});
  };

  const loadFromHistory = (item: WorkbenchHistoryItem) => {
    const historyItem = item.itemId ? allItems.find((candidate) => candidate.id === item.itemId) : null;
    const historyTemplate = item.itemId ? savedItems.find((candidate) => candidate.id === item.itemId) : null;
    if (item.mode === "library" && historyItem) {
      setMode("library");
      setSelectedId(historyItem.id);
      setValues(valueMapForItem(historyItem, item.values));
    } else if (item.mode === "templates" && historyTemplate) {
      setMode("templates");
      setSelectedTemplateId(historyTemplate.id);
    } else {
      setMode("custom");
      setCustomCommand(item.customCommand ?? stripAdbPrefix(item.command));
    }
    setResult(null);
    setError(null);
    setExportStatus(null);
    setTemplateStatus(null);
    setHighRiskConfirmed(false);
  };

  const exportOutput = async () => {
    if (!outputExportText || exporting) return;

    setExporting(true);
    setExportStatus(null);
    try {
      const savedPath = await invoke<string | null>("export_text_file", {
        defaultName: `adb-workbench-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        content: outputExportText,
      });
      if (savedPath) {
        setExportStatus({ ok: true, msg: t("workbench.exported", { path: savedPath }) });
      }
    } catch (e) {
      setExportStatus({ ok: false, msg: String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-[620px] flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4">
      <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <h3 className="text-base font-semibold text-gray-800">{t("workbench.title")}</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">{t("workbench.subtitle")}</p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workbench.searchPlaceholder")}
            className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t("workbench.categories.all")}</option>
            {categoryOptions.map((categoryKey) => (
              <option key={categoryKey} value={categoryKey}>
                {t(categoryKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {filteredItems.map((item) => {
            const selected = mode === "library" && item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => chooseItem(item)}
                className={`mb-2 w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-gray-800">{item.title ?? t(item.titleKey ?? "")}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">
                      {item.description ?? t(item.descriptionKey ?? "")}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${riskClasses[item.risk]}`}>
                    {t(`workbench.risk.${item.risk}`)}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-gray-400">{t(item.categoryKey)}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => switchMode("library")}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === "library" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t("workbench.libraryMode")}
          </button>
          <button
            type="button"
            onClick={() => switchMode("templates")}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === "templates" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t("workbench.templatesMode")}
          </button>
          <button
            type="button"
            onClick={() => switchMode("custom")}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === "custom" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t("workbench.customMode")}
          </button>
        </div>

        {mode === "library" ? (
          <>
            <div className="mb-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{selectedItem.title ?? t(selectedItem.titleKey ?? "")}</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    {selectedItem.description ?? t(selectedItem.descriptionKey ?? "")}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${riskClasses[selectedItem.risk]}`}>
                  {t(`workbench.risk.${selectedItem.risk}`)}
                </span>
              </div>
            </div>

            {selectedItem.params.length > 0 ? (
              <div className="space-y-4">
                {selectedItem.params.map((param) => (
                  <label key={param.name} className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-500">{t(param.labelKey)}</span>
                    {param.type === "select" ? (
                      <select
                        value={values[param.name] ?? ""}
                        onChange={(event) => setValues((prev) => ({ ...prev, [param.name]: event.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      >
                        {(param.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </option>
                        ))}
                      </select>
                    ) : param.type === "package" ? (
                      <PackageNameInput
                        value={values[param.name] ?? ""}
                        onChange={(value) => setValues((prev) => ({ ...prev, [param.name]: value }))}
                        deviceSerial={deviceSerial}
                        placeholder={param.placeholderKey ? t(param.placeholderKey) : ""}
                      />
                    ) : (
                      <input
                        value={values[param.name] ?? ""}
                        onChange={(event) => setValues((prev) => ({ ...prev, [param.name]: event.target.value }))}
                        placeholder={param.placeholderKey ? t(param.placeholderKey) : ""}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                {t("workbench.noParams")}
              </div>
            )}
          </>
        ) : mode === "templates" ? (
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t("workbench.templatesTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-gray-500">{t("workbench.templatesDesc")}</p>
            <div className="mt-4 space-y-2">
              {savedItems.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">
                  {t("workbench.noTemplates")}
                </div>
              )}
              {savedItems.map((item) => {
                const selected = item.id === selectedTemplate?.id;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      selected ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <button type="button" onClick={() => chooseTemplate(item)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-800">{item.title}</div>
                        <div className="mt-1 truncate font-mono text-xs text-gray-500">{item.savedCommand}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${riskClasses[item.risk]}`}>
                        {t(`workbench.risk.${item.risk}`)}
                      </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTemplate(item.id)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      {t("workbench.removeTemplate")}
                    </button>
                  </div>
                );
              })}
            </div>
            {templateStatus && (
              <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                {templateStatus}
              </div>
            )}
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t("workbench.customTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-gray-500">{t("workbench.customDesc")}</p>
            <textarea
              value={customCommand}
              onChange={(event) => {
                setCustomCommand(event.target.value);
                setHighRiskConfirmed(false);
              }}
              rows={4}
              placeholder="shell setprop example.feature.flag enabled"
              className="mt-4 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {currentRisk === "high" && (
          <label className="mt-5 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            <input
              type="checkbox"
              checked={highRiskConfirmed}
              onChange={(event) => setHighRiskConfirmed(event.target.checked)}
              className="mt-1"
            />
            <span>{t("workbench.highRiskConfirm")}</span>
          </label>
        )}

        {mode !== "templates" && (
          <div className="mt-5">
            <div className="flex items-center gap-2">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder={t("workbench.templateName")}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={saveCurrentTemplate}
                disabled={!templateName.trim() || !currentCommand}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("workbench.saveTemplate")}
              </button>
            </div>
            {templateStatus && (
              <div className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                {templateStatus}
              </div>
            )}
          </div>
        )}
      </section>

      </div>

      <section className="flex min-h-[280px] max-h-[42%] flex-col rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">{t("workbench.preview")}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-xs ${riskClasses[currentRisk]}`}>
              {t(`workbench.risk.${currentRisk}`)}
            </span>
          </div>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-gray-950 p-3 text-xs leading-5 text-gray-100">
            {commandPreview(currentCommand || "<empty>", deviceSerial)}
          </pre>
          {!deviceSerial && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("workbench.noDevice")}
            </div>
          )}
          {missingRequired && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("workbench.missingParams")}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={executeCommand}
              disabled={!canExecute}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executing ? t("workbench.executing") : t("workbench.execute")}
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(commandPreview(currentCommand, deviceSerial))}
              disabled={!currentCommand}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("workbench.copy")}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {(result || error) && (
            <div className="mb-4 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                <span className="text-xs font-medium text-gray-500">{t("workbench.output")}</span>
                <button
                  type="button"
                  onClick={exportOutput}
                  disabled={!outputExportText || exporting}
                  className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting ? t("workbench.exporting") : t("workbench.exportOutput")}
                </button>
              </div>
              {error && <pre className="whitespace-pre-wrap p-3 text-xs leading-5 text-red-600">{error}</pre>}
              {result && (
                <div className="space-y-3 p-3">
                  <div className="text-xs text-gray-500">
                    {t("workbench.exitCode")}: {result.exit_code ?? "-"}
                  </div>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                    {result.stdout || result.stderr || t("workbench.noOutput")}
                  </pre>
                  {result.stderr && result.stdout && (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-red-950 p-3 text-xs leading-5 text-red-100">
                      {result.stderr}
                    </pre>
                  )}
                </div>
              )}
              {exportStatus && (
                <div
                  className={`border-t border-gray-100 px-3 py-2 text-xs ${
                    exportStatus.ok ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {exportStatus.msg}
                </div>
              )}
            </div>
          )}

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t("workbench.history")}</h4>
          <div className="space-y-2">
            {history.length === 0 && <div className="text-sm text-gray-400">{t("workbench.noHistory")}</div>}
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => loadFromHistory(item)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs ${item.ok ? "text-green-600" : "text-red-600"}`}>
                    {item.ok ? t("workbench.ok") : t("workbench.failed")}
                  </span>
                  <span className="text-[11px] text-gray-400">{new Date(item.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-gray-600">{item.command}</div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
