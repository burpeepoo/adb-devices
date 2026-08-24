export const LOGCAT_CUSTOM_RANGE = "custom";
export const MAX_LOGCAT_LOOKBACK_MINUTES = 7 * 24 * 60;

export const LOGCAT_RANGE_VALUES = [300, 900, 1800, 3600, 6 * 3600, 24 * 3600, 0] as const;

export function logcatRangeAmount(seconds: number): {
  unit: "minutes" | "hours";
  count: number;
} {
  if (seconds < 3600 || seconds % 3600 !== 0) {
    return { unit: "minutes", count: seconds / 60 };
  }
  return { unit: "hours", count: seconds / 3600 };
}

export function resolveLogcatLookbackSeconds(
  selectedRange: string,
  customMinutes: string,
): number | null {
  if (selectedRange === LOGCAT_CUSTOM_RANGE) {
    const minutes = Number(customMinutes);
    if (
      !Number.isFinite(minutes)
      || !Number.isInteger(minutes)
      || minutes < 1
      || minutes > MAX_LOGCAT_LOOKBACK_MINUTES
    ) {
      return null;
    }
    return minutes * 60;
  }

  const seconds = Number(selectedRange);
  return LOGCAT_RANGE_VALUES.includes(seconds as (typeof LOGCAT_RANGE_VALUES)[number])
    ? seconds
    : null;
}
