import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(controls, /COLOR_TEMPERATURE_POINT_EFFECTIVE_RADIUS/);
  assert.match(component, /colorTemperaturePointToNativeColor/);
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
});
