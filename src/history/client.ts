import { resolve } from "node:path";
import { authApi, PROTOCOL_VERSION } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
export class HistoryError extends Error {
  constructor() { super("History read failed. Check the selected profile, task/message scope and current content permission. No content was returned."); }
}
export interface HistoryScopeOptions { config: string; task: string; releasedSession?: string; operatorProfile?: string }
/** Explicit authority selection shared by history operations. No fallback from a failed live binding. */
export async function historyConnection(options: HistoryScopeOptions) {
  if (options.operatorProfile && options.releasedSession) throw new HistoryError();
  const config = resolve(options.operatorProfile ?? options.config);
  const profile = options.operatorProfile ? await loadProfile(config, "operator") : await loadProfile(config, "machine");
  const actor = options.operatorProfile ? { kind: "operator" as const } : options.releasedSession
    ? { kind: "releasedSession" as const, sessionId: options.releasedSession }
    : { kind: "liveSession" as const, verificationId: (await resolveCaller(config)).verificationRequestId };
  const client = clientFor(profile, (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  const deployment = await client.query(authApi.deploymentInfo, {});
  if (deployment.protocolVersion !== PROTOCOL_VERSION) throw new HistoryError();
  return { client, actor, config };
}
