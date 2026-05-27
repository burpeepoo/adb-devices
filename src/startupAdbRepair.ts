export const STARTUP_ADB_REPAIR_COOLDOWN_MS = 10 * 60 * 1000;

export interface AdbStartupRepairState {
  completedVersion?: string;
  completedAt?: number;
  attemptedVersion?: string;
  attemptedAt?: number;
}

export interface StartupAdbRepairDecisionInput {
  currentVersion: string;
  saved?: AdbStartupRepairState;
  now: number;
  cooldownMs?: number;
}

export function shouldRunAdbStartupRepair({
  currentVersion,
  saved,
  now,
  cooldownMs = STARTUP_ADB_REPAIR_COOLDOWN_MS,
}: StartupAdbRepairDecisionInput) {
  const version = currentVersion.trim();
  if (!version) return false;
  if (
    saved?.completedVersion === version &&
    saved.completedAt !== undefined &&
    now - saved.completedAt < cooldownMs
  ) {
    return false;
  }

  if (
    saved?.attemptedVersion === version &&
    saved.attemptedAt !== undefined &&
    now - saved.attemptedAt < cooldownMs
  ) {
    return false;
  }

  return true;
}
