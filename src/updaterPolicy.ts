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

export type UpdateCheckErrorKind = "invalid-feed" | "network" | "other";

export function isAutoUpdateCheckEnabled(value?: boolean): boolean {
  return value !== false;
}

export function canRunAutomaticUpdateCheck(status: AutoCheckUpdateStatus): boolean {
  return status === "idle" || status === "not-available" || status === "error";
}

export function shouldTreatUpdateCheckErrorAsNoUpdate(error: unknown): boolean {
  return getUpdateCheckErrorKind(error) === "invalid-feed";
}

export function getUpdateCheckErrorKind(error: unknown): UpdateCheckErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("could not fetch a valid release json from the remote")) {
    return "invalid-feed";
  }

  if (isLikelyUpdateNetworkError(error)) {
    return "network";
  }

  return "other";
}

export function isLikelyUpdateNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return [
    "error sending request",
    "request timed out",
    "timed out",
    "connection refused",
    "connection reset",
    "connection closed",
    "dns error",
    "tls",
    "ssl",
    "network",
  ].some((pattern) => normalized.includes(pattern));
}
