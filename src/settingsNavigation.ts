export const SETTINGS_SECTION_IDS = [
  "settings-agent",
  "settings-files",
  "settings-updates",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SettingsSectionTitleMeasurement {
  id: SettingsSectionId;
  top: number;
  bottom: number;
}

export function resolveActiveSettingsSection(
  measurements: readonly SettingsSectionTitleMeasurement[],
  viewportTop: number,
  viewportBottom: number,
  fallback: SettingsSectionId,
): SettingsSectionId {
  const fullyVisibleTitles = measurements.filter(
    (measurement) => measurement.top >= viewportTop && measurement.bottom <= viewportBottom,
  );
  const lastFullyVisibleTitle = fullyVisibleTitles[fullyVisibleTitles.length - 1];

  return lastFullyVisibleTitle?.id ?? fallback;
}
