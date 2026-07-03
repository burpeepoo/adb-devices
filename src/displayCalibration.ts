import { invoke } from "@tauri-apps/api/core";

export type DisplayCalibrationTarget =
  | { kind: "settings"; namespace: "system" | "secure" | "global"; key: string }
  | { kind: "systemProperty"; key: string }
  | { kind: "sysfs"; path: string }
  | {
      kind: "vendorDisplay";
      service: string;
      displayId: number;
      operation: "enhanceComponent" | "colorTemperature" | "smartBacklight" | "blackWhiteMode" | "readingMode";
      component?: number | null;
      readMethod: string;
      writeMethod: string;
    };

export interface DisplayCalibrationProbe {
  id: string;
  label: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
  truncated: boolean;
}

export interface DisplayCalibrationCandidate {
  id: string;
  label: string;
  value: string;
  source: string;
  probeId: string;
  line: string;
  confidence: number;
  reason: string;
  writable: boolean;
  target: DisplayCalibrationTarget | null;
}

export interface DisplayCalibrationSnapshot {
  capturedAt: string;
  deviceSerial: string;
  probes: DisplayCalibrationProbe[];
  candidates: DisplayCalibrationCandidate[];
}

export interface DisplayCalibrationChangedValue {
  id: string;
  label: string;
  source: string;
  beforeValue: string;
  afterValue: string;
  writable: boolean;
  target: DisplayCalibrationTarget | null;
  confidence: number;
}

export interface DisplayCalibrationDiff {
  beforeCapturedAt: string;
  afterCapturedAt: string;
  changed: DisplayCalibrationChangedValue[];
}

export interface DisplayCalibrationApplyResult {
  target: DisplayCalibrationTarget;
  requestedValue: string;
  readbackValue: string | null;
  command: string;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface DisplayCalibrationReadResult {
  target: DisplayCalibrationTarget;
  readbackValue: string | null;
  command: string;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface DisplayCalibrationDeviceIdentity {
  adbSerial: string;
  deviceSn?: string | null;
  model?: string | null;
  buildFingerprint?: string | null;
  firmwareVersion?: string | null;
}

export interface DisplayCalibrationProfileParameter {
  name: string;
  target: DisplayCalibrationTarget;
  baselineValue?: string | null;
  desiredValue: string;
  readbackValue?: string | null;
  visibleEffectConfirmed?: boolean | null;
  requiresPhysicalValidation: boolean;
  notes?: string | null;
}

export interface DisplayCalibrationProfile {
  profileName: string;
  createdAt?: string | null;
  device: DisplayCalibrationDeviceIdentity;
  parameters: DisplayCalibrationProfileParameter[];
  notes?: string | null;
}

export interface DisplayCalibrationExportBundle {
  json: string;
  markdown: string;
}

export interface DisplayCalibrationTestPatternResult {
  localPath: string;
  remotePath: string;
  pushed: boolean;
  opened: boolean;
  message: string;
}

export interface DisplayCalibrationRootResult {
  stdout: string;
  stderr: string;
  success: boolean;
  message: string;
}

export function captureDisplayCalibrationSnapshot(deviceSerial: string) {
  return invoke<DisplayCalibrationSnapshot>("adb_display_calibration_snapshot", { deviceSerial });
}

export function diffDisplayCalibrationSnapshots(
  before: DisplayCalibrationSnapshot,
  after: DisplayCalibrationSnapshot,
) {
  return invoke<DisplayCalibrationDiff>("adb_display_calibration_diff", { before, after });
}

export function readDisplayCalibrationTarget(
  deviceSerial: string,
  target: DisplayCalibrationTarget,
) {
  return invoke<DisplayCalibrationReadResult>("adb_display_calibration_read_target", {
    deviceSerial,
    target,
  });
}

export function applyDisplayCalibrationTarget(
  deviceSerial: string,
  target: DisplayCalibrationTarget,
  value: string,
  confirmed: boolean,
) {
  return invoke<DisplayCalibrationApplyResult>("adb_display_calibration_apply", {
    deviceSerial,
    target,
    value,
    confirmed,
  });
}

export function buildDisplayCalibrationExport(profile: DisplayCalibrationProfile) {
  return invoke<DisplayCalibrationExportBundle>("adb_display_calibration_build_export", {
    profile,
  });
}

export function openDisplayCalibrationTestPattern(deviceSerial: string) {
  return invoke<DisplayCalibrationTestPatternResult>(
    "adb_display_calibration_open_test_pattern",
    { deviceSerial },
  );
}

export function enableDisplayCalibrationRoot(deviceSerial: string) {
  return invoke<DisplayCalibrationRootResult>(
    "adb_display_calibration_enable_root",
    { deviceSerial },
  );
}
