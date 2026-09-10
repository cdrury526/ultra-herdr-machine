import { resolve } from "node:path";
import { authApi, historyApi, historyResultSchemas, PROTOCOL_VERSION, verifyEnvelope, messageArtifactId } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { saveArtifact } from "../receive/artifact";
export class HistoryError extends Error {
  constructor() { super("History read failed. Check the selected profile, task/message scope and current content permission. No content was returned."); }
}
export interface HistoryOptions { config: string; task: string; message: string; digest?: string; releasedSession?: string; operatorProfile?: string }
export async function readMessageHistory(options: HistoryOptions) {
  try {
    if (options.operatorProfile && options.releasedSession) throw new HistoryError();
    const config = resolve(options.operatorProfile ?? options.config);
    const profile = options.operatorProfile ? await loadProfile(config, "operator") : await loadProfile(config, "machine");
    const actor = options.operatorProfile ? { kind: "operator" as const } : options.releasedSession
      ? { kind: "releasedSession" as const, sessionId: options.releasedSession }
      : { kind: "liveSession" as const, verificationId: (await resolveCaller(config)).verificationRequestId };
    const client = clientFor(profile, (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
    const deployment = await client.query(authApi.deploymentInfo, {});
    if (deployment.protocolVersion !== PROTOCOL_VERSION) throw new HistoryError();
    const value = historyResultSchemas.message.parse(await client.query(historyApi.message, { actor,
      taskId: options.task, messageId: options.message, ...(options.digest !== undefined ? { digest: options.digest } : {}) }));
    const envelope = await verifyEnvelope(value.canonical);
    if (envelope.messageId !== options.message || envelope.taskId !== options.task || envelope.messageId !== value.messageId ||
        envelope.digest !== value.digest || envelope.byteLength !== value.byteLength ||
        (options.digest !== undefined && options.digest !== envelope.digest) ||
        await messageArtifactId(value.deploymentId, envelope) !== value.artifactId) throw new HistoryError();
    const path = await saveArtifact(`${config}.messages`, value.deploymentId, value.artifactId, envelope);
    // History is a read, never a receipt: do not call confirm or synthesize a receipt result.
    return { mode: "history" as const, path, envelope };
  } catch { throw new HistoryError(); }
}
