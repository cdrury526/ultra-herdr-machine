import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { loadProfile, clientFor } from "../auth/client";
import { reportFailure } from "../reports/input";
import { ReleaseError } from "./client";
export interface PreviewOptions { task: string; cursor?: string; limit?: string }
function input(options: PreviewOptions) {
  if (!options.task || options.task.length > 256) throw new ReleaseError("Provide the latest task identity for the worker session.");
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new ReleaseError("Provide a positive page limit.");
  return { taskId: options.task, ...(options.cursor ? { cursor: options.cursor } : {}), ...(limit === undefined ? {} : { limit }) };
}
function failure(error: unknown): never {
  if (error instanceof ReleaseError) throw error;
  throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "force-release preview"));
}
export async function previewForceRelease(options: PreviewOptions & { config: string }) {
  try {
    const args = input(options), { caller, client } = await messageContext(resolve(options.config));
    return releaseResultSchemas.forcePreview.parse(await client.query(releaseApi.forcePreview, { ...args, verificationId: caller.verificationRequestId }));
  } catch (error) { failure(error); }
}
export async function previewOperatorForceRelease(options: PreviewOptions & { operatorProfile: string }) {
  try {
    const args = input(options), client = clientFor(await loadProfile(resolve(options.operatorProfile), "operator"));
    return releaseResultSchemas.operatorForcePreview.parse(await client.query(releaseApi.operatorForcePreview, args));
  } catch (error) { failure(error); }
}
