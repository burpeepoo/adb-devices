export interface PairRequest extends Record<string, unknown> {
  ip: string;
  port: string;
  code: string;
}

export interface PairOperationResult {
  ok: boolean;
  msg: string;
}

type PairCommandInvoker = (command: string, args: PairRequest) => Promise<string>;

export async function retryPairAfterAdbRestart(
  request: PairRequest,
  invokeCommand: PairCommandInvoker,
): Promise<PairOperationResult> {
  try {
    const msg = await invokeCommand("adb_restart_and_retry_pair", request);
    return { ok: true, msg };
  } catch (error) {
    return { ok: false, msg: String(error) };
  }
}
