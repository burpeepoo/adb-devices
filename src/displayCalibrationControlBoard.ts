import {
  COLOR_TEMPERATURE_POINT_CONTROL_ID,
  COLOR_TEMPERATURE_VALUE_CONTROL_ID,
} from "./displayCalibrationControls.ts";

export type DisplayCalibrationControlBoardVariant = "control" | "colorPoint" | "readOnly";

export interface DisplayCalibrationControlBoardSlot<T> {
  row: T;
  variant: DisplayCalibrationControlBoardVariant;
}

const SMART_BACKLIGHT_CONTROL_ID = "smartBacklight";

export function layoutDisplayCalibrationControlRows<T extends { control: { id: string } }>(
  rows: T[],
): DisplayCalibrationControlBoardSlot<T>[] {
  const specialControlIds = new Set([
    COLOR_TEMPERATURE_POINT_CONTROL_ID,
    COLOR_TEMPERATURE_VALUE_CONTROL_ID,
    SMART_BACKLIGHT_CONTROL_ID,
  ]);
  const slots: DisplayCalibrationControlBoardSlot<T>[] = rows
    .filter((row) => !specialControlIds.has(row.control.id))
    .map((row) => ({ row, variant: "control" }));
  const colorPointRow = rows.find(
    (row) => row.control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID,
  );
  const smartBacklightRow = rows.find(
    (row) => row.control.id === SMART_BACKLIGHT_CONTROL_ID,
  );
  const rawColorTemperatureRow = rows.find(
    (row) => row.control.id === COLOR_TEMPERATURE_VALUE_CONTROL_ID,
  );

  if (colorPointRow) {
    slots.push({ row: colorPointRow, variant: "colorPoint" });
  }
  if (smartBacklightRow) {
    slots.push({ row: smartBacklightRow, variant: "control" });
  }
  if (rawColorTemperatureRow) {
    slots.push({ row: rawColorTemperatureRow, variant: "readOnly" });
  }

  return slots;
}

export function isDisplayCalibrationControlInteractive(
  variant: DisplayCalibrationControlBoardVariant,
) {
  return variant !== "readOnly";
}
