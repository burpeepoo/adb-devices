export const UPDATE_AUTO_CHECK_DELAY_MS = 2500;
export const UPDATE_AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AutoCheckUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

export function isAutoUpdateCheckEnabled(value?: boolean): boolean {
  return value !== false;
}

export function canRunAutomaticUpdateCheck(status: AutoCheckUpdateStatus): boolean {
  return status === "idle" || status === "not-available" || status === "error";
}

export function shouldTreatUpdateCheckErrorAsNoUpdate(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("could not fetch a valid release json from the remote");
}
