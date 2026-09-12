import { ContextError } from "../context/errors";
export type ReceiveStage = "input" | "profile" | "caller" | "resolve-delivery" | "exchange" | "artifact-lock" | "verify-artifact" | "save-artifact" | "confirm-caller" | "confirm";
/** Only fixed stages and already-sanitized caller codes cross this boundary.
 * Never include raw exception text, tickets, backend payloads or credential paths. */
export class ReceiveError extends Error {
  constructor(readonly stage?: ReceiveStage, readonly contextCode?: string) {
    super(`Receive could not verify, save or confirm this message.${stage ? ` Stage: ${stage}${contextCode ? ` (${contextCode})` : ""}.` : ""} Retry with current authorization; no content was returned.`);
  }
}
export function receiveFailure(error: unknown, stage: ReceiveStage): ReceiveError {
  if (error instanceof ReceiveError && error.stage) return error;
  return new ReceiveError(stage, error instanceof ContextError ? error.code : undefined);
}
export async function receiveStage<T>(stage: ReceiveStage, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw receiveFailure(error, stage); }
}
