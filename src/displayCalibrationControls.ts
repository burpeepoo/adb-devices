import type {
  DisplayCalibrationApplyResult,
  DisplayCalibrationCandidate,
  DisplayCalibrationProfileParameter,
  DisplayCalibrationTarget,
} from "./displayCalibration";

export type DisplayCalibrationControlKind = "slider" | "toggle" | "integer" | "point";

export interface DisplayCalibrationControlDefinition {
  id: string;
  labelKey: string;
  descriptionKey: string;
  parameterName: string;
  kind: DisplayCalibrationControlKind;
  target: DisplayCalibrationTarget;
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string;
  requiresHelper: boolean;
  requiresRoot?: boolean;
  source: "settings-apk" | "android-settings" | "surfaceflinger";
}

const VENDOR_DISPLAY_SERVICE = "vendor.display.output.IDisplayOutputManager/default";
export const COLOR_TEMPERATURE_VALUE_CONTROL_ID = "colorTemperatureValue";
export const COLOR_TEMPERATURE_POINT_CONTROL_ID = "colorTemperaturePoint";
export const COLOR_TEMPERATURE_POINT_RANGE = 205;
export const COLOR_TEMPERATURE_POINT_CENTER = COLOR_TEMPERATURE_POINT_RANGE / 2;
export const COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS =
  COLOR_TEMPERATURE_POINT_CENTER * (74 / 75) * (15 / 16);

// Verified from Settings.apk:
// AwEnhanceModePreferenceController maps Color Bright/Contrast/Saturation to
// getEnhanceComponent/setEnhanceComponent with component ids 1/2/6 and
// config_HSL_max_range=100. Color Enhance uses component id 0.
export const DISPLAY_CALIBRATION_CONTROLS: DisplayCalibrationControlDefinition[] = [
  {
    id: "colorEnhance",
    labelKey: "displayCalibration.controls.colorEnhance",
    descriptionKey: "displayCalibration.controlDescriptions.colorEnhance",
    parameterName: "vendor.display.output.IDisplayOutputManager/default · enhanceComponent[0]",
    kind: "toggle",
    target: vendorEnhanceComponentTarget(0, "getDisplayEnhanceMode", "setDisplayEnhanceMode"),
    min: 0,
    max: 1,
    step: 1,
    defaultValue: "1",
    requiresHelper: true,
    source: "settings-apk",
  },
  {
    id: "colorBright",
    labelKey: "displayCalibration.controls.colorBright",
    descriptionKey: "displayCalibration.controlDescriptions.colorBright",
    parameterName: "persist.vendor.display.enhance_bright",
    kind: "slider",
    target: firmwareDisplayPropertyTarget("persist.vendor.display.enhance_bright"),
    min: 0,
    max: 100,
    step: 1,
    defaultValue: "50",
    requiresHelper: false,
    requiresRoot: true,
    source: "settings-apk",
  },
  {
    id: "contrast",
    labelKey: "displayCalibration.controls.contrast",
    descriptionKey: "displayCalibration.controlDescriptions.contrast",
    parameterName: "persist.vendor.display.enhance_contrast",
    kind: "slider",
    target: firmwareDisplayPropertyTarget("persist.vendor.display.enhance_contrast"),
    min: 0,
    max: 100,
    step: 1,
    defaultValue: "50",
    requiresHelper: false,
    requiresRoot: true,
    source: "settings-apk",
  },
  {
    id: "saturation",
    labelKey: "displayCalibration.controls.saturation",
    descriptionKey: "displayCalibration.controlDescriptions.saturation",
    parameterName: "persist.vendor.display.enhance_saturation",
    kind: "slider",
    target: firmwareDisplayPropertyTarget("persist.vendor.display.enhance_saturation"),
    min: 0,
    max: 100,
    step: 1,
    defaultValue: "50",
    requiresHelper: false,
    requiresRoot: true,
    source: "settings-apk",
  },
  {
    id: COLOR_TEMPERATURE_VALUE_CONTROL_ID,
    labelKey: "displayCalibration.controls.colorTemperatureValue",
    descriptionKey: "displayCalibration.controlDescriptions.colorTemperatureValue",
    parameterName: "settings system aw_color_temperature_value",
    kind: "integer",
    target: {
      kind: "settings",
      namespace: "system",
      key: "aw_color_temperature_value",
    },
    defaultValue: "-1",
    requiresHelper: false,
    source: "settings-apk",
  },
  {
    id: COLOR_TEMPERATURE_POINT_CONTROL_ID,
    labelKey: "displayCalibration.controls.colorTemperaturePoint",
    descriptionKey: "displayCalibration.controlDescriptions.colorTemperaturePoint",
    parameterName: "settings system srgb_color_temperature",
    kind: "point",
    target: {
      kind: "settings",
      namespace: "system",
      key: "srgb_color_temperature",
    },
    defaultValue: "102.50,102.50",
    requiresHelper: false,
    source: "settings-apk",
  },
  {
    id: "smartBacklight",
    labelKey: "displayCalibration.controls.smartBacklight",
    descriptionKey: "displayCalibration.controlDescriptions.smartBacklight",
    parameterName: "vendor.display.output.IDisplayOutputManager/default · getSmartBacklight/setSmartBacklight",
    kind: "toggle",
    target: {
      kind: "vendorDisplay",
      service: VENDOR_DISPLAY_SERVICE,
      displayId: 0,
      operation: "smartBacklight",
      component: null,
      readMethod: "getSmartBacklight",
      writeMethod: "setSmartBacklight",
    },
    min: 0,
    max: 1,
    step: 1,
    defaultValue: "1",
    requiresHelper: true,
    source: "settings-apk",
  },
];

export function targetSignature(target: DisplayCalibrationTarget) {
  switch (target.kind) {
    case "settings":
      return `${target.kind}:${target.namespace}:${target.key}`;
    case "systemProperty":
      return `${target.kind}:${target.key}`;
    case "sysfs":
      return `${target.kind}:${target.path}`;
    case "vendorDisplay":
      return [
        target.kind,
        target.service,
        target.displayId,
        target.operation,
        target.component ?? "none",
        target.readMethod,
        target.writeMethod,
      ].join(":");
  }
}

export function sameTarget(left: DisplayCalibrationTarget, right: DisplayCalibrationTarget) {
  return targetSignature(left) === targetSignature(right);
}

export function formatDisplayCalibrationTarget(target: DisplayCalibrationTarget | null) {
  if (!target) return "-";
  switch (target.kind) {
    case "settings":
      return `settings ${target.namespace} ${target.key}`;
    case "systemProperty":
      return `setprop ${target.key}`;
    case "sysfs":
      return target.path;
    case "vendorDisplay":
      return target.operation === "enhanceComponent"
        ? `${target.service} ${target.readMethod}/${target.writeMethod} component=${target.component}`
        : `${target.service} ${target.readMethod}/${target.writeMethod}`;
  }
}

export function controlValueFromCandidates(
  control: DisplayCalibrationControlDefinition,
  candidates: DisplayCalibrationCandidate[],
) {
  const match = candidates.find((candidate) => candidate.target && sameTarget(candidate.target, control.target));
  return match?.value ?? null;
}

export function buildControlProfileParameter(
  control: DisplayCalibrationControlDefinition,
  baselineValue: string | null,
  desiredValue: string,
  applyResult: DisplayCalibrationApplyResult | null,
): DisplayCalibrationProfileParameter {
  return {
    name: control.parameterName,
    target: control.target,
    baselineValue,
    desiredValue,
    readbackValue:
      applyResult && sameTarget(applyResult.target, control.target) ? applyResult.readbackValue : null,
    visibleEffectConfirmed: false,
    requiresPhysicalValidation: true,
    notes: `${control.source}; ${
      control.id === COLOR_TEMPERATURE_VALUE_CONTROL_ID
        ? "adb settings read/write; live refresh uses ADB Manager display helper setColorTemperature"
        : control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID
          ? "adb settings read/write; derives the Settings native ARGB value and live refreshes display sRGB white point"
          : control.requiresHelper
        ? "uses ADB Manager display helper; firmware must allow shell/bridge access to vendor display HAL"
        : control.requiresRoot
          ? "writes firmware persist property; userdebug/adb root may be required, and live screen refresh depends on firmware support"
          : "adb settings read/write"
    }`,
  };
}

export function parseColorTemperaturePoint(value: string) {
  const [rawX, rawY] = value.split(",");
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clamp(x, 0, COLOR_TEMPERATURE_POINT_RANGE),
    y: clamp(y, 0, COLOR_TEMPERATURE_POINT_RANGE),
  };
}

export function formatColorTemperaturePoint(x: number, y: number) {
  const point = clampColorTemperaturePointToNativeWheel(x, y);
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

export function clampColorTemperaturePointToNativeWheel(x: number, y: number) {
  const safeX = clamp(x, 0, COLOR_TEMPERATURE_POINT_RANGE);
  const safeY = clamp(y, 0, COLOR_TEMPERATURE_POINT_RANGE);
  const dx = safeX - COLOR_TEMPERATURE_POINT_CENTER;
  const dy = safeY - COLOR_TEMPERATURE_POINT_CENTER;
  const distance = Math.hypot(dx, dy);
  if (distance <= COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS) {
    return { x: safeX, y: safeY };
  }
  const scale = COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS / distance;
  return {
    x: COLOR_TEMPERATURE_POINT_CENTER + dx * scale,
    y: COLOR_TEMPERATURE_POINT_CENTER + dy * scale,
  };
}

export function colorTemperaturePointToNativeColor(value: string) {
  const point = parseColorTemperaturePoint(value);
  if (!point) return null;
  const dx = point.x - COLOR_TEMPERATURE_POINT_CENTER;
  const dy = point.y - COLOR_TEMPERATURE_POINT_CENTER;
  const xRotated = -dy;
  const yRotated = dx;
  const hue = normalizeHue((Math.atan2(yRotated, -xRotated) * 180) / Math.PI + 180);
  const saturation =
    clamp(Math.hypot(dx, dy) / COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS, 0, 1) * 0.498;
  const [r, g, b] = hsvToRgb(hue, saturation, 1);
  const unsignedColor = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
  return unsignedColor > 0x7fffffff ? unsignedColor - 0x100000000 : unsignedColor;
}

export function colorTemperaturePointToCssColor(value: string) {
  const color = colorTemperaturePointToNativeColor(value);
  if (color === null) return "#ffffff";
  const unsignedColor = color >>> 0;
  const r = (unsignedColor >> 16) & 0xff;
  const g = (unsignedColor >> 8) & 0xff;
  const b = unsignedColor & 0xff;
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function firmwareDisplayPropertyTarget(key: string): DisplayCalibrationTarget {
  return {
    kind: "systemProperty",
    key,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number) {
  return ((hue % 360) + 360) % 360;
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation;
  const hueSection = hue / 60;
  const x = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const m = value - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hueSection >= 0 && hueSection < 1) {
    r = chroma;
    g = x;
  } else if (hueSection < 2) {
    r = x;
    g = chroma;
  } else if (hueSection < 3) {
    g = chroma;
    b = x;
  } else if (hueSection < 4) {
    g = x;
    b = chroma;
  } else if (hueSection < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function vendorEnhanceComponentTarget(component: number, readMethod: string, writeMethod: string): DisplayCalibrationTarget {
  return {
    kind: "vendorDisplay",
    service: VENDOR_DISPLAY_SERVICE,
    displayId: 0,
    operation: "enhanceComponent",
    component,
    readMethod,
    writeMethod,
  };
}
