import { historyApi, historyResultSchemas, verifyEnvelope, messageArtifactId } from "@ultra-herdr/api";
import { saveArtifact } from "../receive/artifact";
import { historyConnection, HistoryError, type HistoryScopeOptions } from "./client";
export { HistoryError } from "./client";
export interface HistoryOptions extends HistoryScopeOptions { message: string; digest?: string }
export async function readMessageHistory(options: HistoryOptions) {
  try {
    const { client, actor, config } = await historyConnection(options);
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
