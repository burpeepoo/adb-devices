export type AdbRestartRecoveryOutcome =
  | "reconnected"
  | "services_only"
  | "unrecovered";

export interface AdbRestartRecoveryInput {
  reconnectedCount: number;
  visibleServiceCount: number;
  reconnectErrors: string[];
}

export interface AdbRestartRecoverySummary {
  recovered: boolean;
  outcome: AdbRestartRecoveryOutcome;
  lastError: string | null;
}

export function summarizeAdbRestartRecovery({
  reconnectedCount,
  visibleServiceCount,
  reconnectErrors,
}: AdbRestartRecoveryInput): AdbRestartRecoverySummary {
  const lastError = [...reconnectErrors]
    .reverse()
    .map((error) => error.trim())
    .find(Boolean) || null;

  if (reconnectedCount > 0) {
    return { recovered: true, outcome: "reconnected", lastError };
  }

  if (visibleServiceCount > 0) {
    return { recovered: false, outcome: "services_only", lastError };
  }

  return { recovered: false, outcome: "unrecovered", lastError };
}
