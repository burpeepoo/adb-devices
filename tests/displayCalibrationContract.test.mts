import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COLOR_TEMPERATURE_POINT_CONTROL_ID,
  COLOR_TEMPERATURE_VALUE_CONTROL_ID,
  DISPLAY_CALIBRATION_CONTROLS,
  updateColorTemperaturePointAxis,
} from "../src/displayCalibrationControls.ts";
import { layoutDisplayCalibrationControlRows } from "../src/displayCalibrationControlBoard.ts";

test("precise color coordinate editing updates one axis and keeps the point inside the native wheel", () => {
  assert.equal(
    updateColorTemperaturePointAxis("128.88,150.97", "x", 129.25),
    "129.25,150.97",
  );
  assert.equal(
    updateColorTemperaturePointAxis("128.88,150.97", "y", 151.2),
    "128.88,151.20",
  );
  assert.equal(
    updateColorTemperaturePointAxis("102.50,102.50", "x", 205),
    "197.31,102.50",
  );
  assert.equal(updateColorTemperaturePointAxis("invalid", "x", 120), null);
});

test("control board merges precise coordinates with the wheel and keeps the raw value card at bottom-right", () => {
  const component = readFileSync(new URL("../src/components/DisplayCalibrationLab.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/components/DisplayCalibrationLab.css", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));
  const slots = layoutDisplayCalibrationControlRows(
    DISPLAY_CALIBRATION_CONTROLS.map((control) => ({ control })),
  );

  assert.deepEqual(
    slots.map(({ row, variant }) => `${row.control.id}:${variant}`),
    [
      "colorEnhance:control",
      "colorBright:control",
      "contrast:control",
      "saturation:control",
      `${COLOR_TEMPERATURE_POINT_CONTROL_ID}:colorPoint`,
      "smartBacklight:control",
      `${COLOR_TEMPERATURE_VALUE_CONTROL_ID}:control`,
    ],
  );
  assert.deepEqual(
    DISPLAY_CALIBRATION_CONTROLS.slice(-3).map((control) => control.id),
    [
      COLOR_TEMPERATURE_VALUE_CONTROL_ID,
      COLOR_TEMPERATURE_POINT_CONTROL_ID,
      "smartBacklight",
    ],
  );
  assert.equal(
    slots.filter(({ row }) => row.control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID).length,
    1,
  );
  assert.equal(slots[4]?.variant, "colorPoint");
  const rawColorTemperatureControl = DISPLAY_CALIBRATION_CONTROLS.find(
    (control) => control.id === COLOR_TEMPERATURE_VALUE_CONTROL_ID,
  );
  assert.equal(rawColorTemperatureControl?.kind, "integer");
  assert.deepEqual(rawColorTemperatureControl?.target, {
    kind: "settings",
    namespace: "system",
    key: "aw_color_temperature_value",
  });
  assert.match(component, /CombinedColorPointInput/);
  assert.match(component, /PreciseColorPointInput/);
  assert.match(component, /updateColorTemperaturePointAxis/);
  assert.match(component, /displayCalibration\.controls\.colorTemperaturePointCombined/);
  assert.match(component, /type="number"/);
  assert.match(component, /aria-label=\{`\$\{t\(titleKey\)\} · \$\{t\("displayCalibration\.apply"\)\}`\}/);
  assert.match(styles, /\.display-calibration-precise-point/);
  const cssRule = (selector: string) => {
    const ruleStart = styles.indexOf(`${selector} {`);
    assert.notEqual(ruleStart, -1, `missing CSS rule: ${selector}`);
    const ruleEnd = styles.indexOf("}", ruleStart);
    assert.notEqual(ruleEnd, -1, `unterminated CSS rule: ${selector}`);
    return styles.slice(ruleStart, ruleEnd + 1);
  };
  assert.match(
    cssRule(".display-calibration-control-board"),
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*420px\),\s*1fr\)\)/,
  );
  assert.match(
    cssRule(".display-calibration-control__main code"),
    /overflow-wrap:\s*anywhere/,
  );
  assert.match(
    cssRule(".display-calibration-control__main code"),
    /white-space:\s*normal/,
  );
  for (const selector of [
    ".display-calibration-chip strong",
    ".display-calibration-chip small",
  ]) {
    const rule = cssRule(selector);
    assert.match(rule, /overflow-wrap:\s*anywhere/);
    assert.match(rule, /white-space:\s*normal/);
    assert.doesNotMatch(rule, /text-overflow:\s*ellipsis/);
  }
  assert.match(
    cssRule(".display-calibration-control__input"),
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    cssRule(".display-calibration-control__input > .display-calibration-action"),
    /justify-self:\s*end/,
  );
  assert.match(
    cssRule(".display-calibration-control.is-color-point"),
    /grid-column:\s*1\s*\/\s*-1/,
  );
  assert.match(
    cssRule(".display-calibration-color-point-editor"),
    /grid-template-columns:\s*116px\s+minmax\(0,\s*1fr\)/,
  );
  assert.equal(zh.displayCalibration.controls.colorTemperaturePointPrecise, "X/Y 精确坐标");
  assert.equal(en.displayCalibration.controls.colorTemperaturePointPrecise, "Precise X/Y Coordinates");
  assert.equal(zh.displayCalibration.controls.colorTemperaturePointCombined, "色温坐标");
  assert.equal(en.displayCalibration.controls.colorTemperaturePointCombined, "Color Temperature Coordinates");
});

test("display calibration is registered as a visible diagnostics workspace", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const commandsMod = readFileSync(new URL("../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const tabState = readFileSync(new URL("../src/tabState.ts", import.meta.url), "utf8");
  const toolMetadata = readFileSync(new URL("../src/toolMetadata.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../src/components/DisplayCalibrationLab.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/components/DisplayCalibrationLab.css", import.meta.url), "utf8");
  const controls = readFileSync(new URL("../src/displayCalibrationControls.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/displayCalibration.ts", import.meta.url), "utf8");
  const zh = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(readFileSync(new URL("../src/locales/en-US.json", import.meta.url), "utf8"));

  assert.match(commandsMod, /pub mod display_calibration;/);
  for (const command of [
    "adb_display_calibration_snapshot",
    "adb_display_calibration_diff",
    "adb_display_calibration_read_target",
    "adb_display_calibration_apply",
    "adb_display_calibration_build_export",
    "adb_display_calibration_enable_root",
    "adb_display_calibration_open_test_pattern",
  ]) {
    assert.match(lib, new RegExp(`commands::display_calibration::${command}`));
  }

  assert.match(tabState, /"displayCalibration"/);
  assert.match(toolMetadata, /displayCalibration: "tabs\.displayCalibration"/);
  assert.match(toolMetadata, /displayCalibration: IconColorSwatch/);
  assert.match(app, /<DisplayCalibrationLab deviceTarget=\{deviceTarget\}/);
  assert.match(app, /\{ key: "displayCalibration" as const, groupLabel: t\("layout\.navDiagnostics"\)/);
  assert.match(component, /applyDisplayCalibrationTarget/);
  assert.match(component, /enableDisplayCalibrationRoot/);
  assert.match(component, /window\.confirm\(t\("displayCalibration\.confirmRoot"\)\)/);
  assert.match(component, /readDisplayCalibrationTarget/);
  assert.match(component, /controlStatuses/);
  assert.match(component, /refreshFixedControls/);
  assert.match(component, /setControlCurrentRefreshedAt/);
  assert.match(component, /normalizeReadbackValue/);
  assert.match(component, /toLowerCase\(\) === "null"/);
  assert.match(component, /displayCalibration\.settingUnset/);
  assert.doesNotMatch(component, /vendorHelperRequired/);
  assert.doesNotMatch(component, /rootPropertyRequired/);
  assert.match(component, /writeConfirmed/);
  assert.match(component, /ControlBoard/);
  assert.match(component, /buildDisplayCalibrationExport/);
  assert.match(component, /refreshAdvancedCurrentSnapshot\(serial\)/);
  assert.match(component, /const fixedControls = await refreshFixedControls\(serial, "current"\);[\s\S]*setStatus\({[\s\S]*displayCalibration\.currentRefreshed/);
  assert.match(types, /kind: "vendorDisplay"/);
  assert.match(controls, /persist\.vendor\.display\.enhance_bright/);
  assert.match(controls, /persist\.vendor\.display\.enhance_contrast/);
  assert.match(controls, /persist\.vendor\.display\.enhance_saturation/);
  assert.match(controls, /aw_color_temperature_value/);
  assert.match(controls, /srgb_color_temperature/);
  assert.match(controls, /parseColorTemperaturePoint/);
  assert.match(controls, /COLOR_TEMPERATURE_POINT_RANGE = 205/);
  assert.match(controls, /COLOR_TEMPERATURE_POINT_CONTROL_ID/);
  assert.match(controls, /colorTemperaturePointToNativeColor/);
  assert.match(controls, /colorTemperatureNativeColorToCssColor/);
  assert.match(controls, /formatColorTemperaturePointForDisplay/);
  assert.match(controls, /COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS/);
  assert.match(component, /colorTemperaturePointToNativeColor/);
  assert.match(component, /formatControlChipValue/);
  assert.match(component, /displayCalibration\.firmwareRawValue/);
  assert.match(component, /display-calibration-color-wheel/);
  assert.match(component, /SHOW_CAPTURE_METRICS = false/);
  assert.match(component, /SHOW_ADVANCED_PARAMETER_SECTIONS = false/);
  assert.match(component, /advancedProfileParameters/);
  assert.match(styles, /\.display-calibration-actions\s*\{[\s\S]*display: grid;/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(136px, 1fr\)\)/);
  assert.match(styles, /\.display-calibration-action\s*\{[\s\S]*white-space: nowrap;/);
  assert.match(styles, /\.display-calibration-actions \.display-calibration-action:nth-child\(4\)\s*\{[\s\S]*grid-column: 2;/);
  assert.match(styles, /\.display-calibration-actions \.display-calibration-action:nth-child\(5\)\s*\{[\s\S]*grid-column: 3;/);
  assert.equal(zh.tabs.displayCalibration, "显示调色");
  assert.equal(en.tabs.displayCalibration, "Display Color");
  assert.equal(zh.displayCalibration.deviceControls, "设备调色控制");
  assert.equal(en.displayCalibration.deviceControls, "Device Color Controls");
  assert.match(zh.displayCalibration.controlsRefreshSummary, /固定参数读取/);
  assert.match(en.displayCalibration.controlsRefreshSummary, /Fixed controls read/);
  assert.match(zh.displayCalibration.confirmWrite, /确认/);
  assert.match(en.displayCalibration.confirmWrite, /Confirm/);
  assert.match(zh.displayCalibration.confirmRoot, /重启/);
  assert.match(en.displayCalibration.confirmRoot, /reboot/);
  assert.match(zh.displayCalibration.propertyUnset, /读回为空/);
  assert.match(en.displayCalibration.propertyUnset, /readback is empty/);
  assert.match(zh.displayCalibration.settingUnset, /未写入/);
  assert.match(en.displayCalibration.settingUnset, /has not written/);
  assert.equal(zh.displayCalibration.firmwareRawValue, "固件原始值");
  assert.equal(en.displayCalibration.firmwareRawValue, "Firmware Raw Value");
});
