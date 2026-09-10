import { ContextError } from "./errors";
/** Supply only this scoped product context to the validated catalog launch profile's tool environment. */
export function launchEnvironment(launchContextId: string): Record<string, string> {
  if (!launchContextId || Buffer.byteLength(launchContextId) > 128 || /[\s\u0000-\u001f\u007f]/u.test(launchContextId)) {
    throw new ContextError("UNSUPPORTED_CONTEXT", "Launch context is malformed; prepare a valid recorded launch before bootstrap.");
  }
  return { ULTRA_HERDR_LAUNCH_CONTEXT: launchContextId };
}
