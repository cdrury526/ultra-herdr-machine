import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas, canonicalJson, jsonDigest, parseJson } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { ContextError } from "../context/errors";
import { readReportFile, reportLimits, reportFailure } from "../reports/input";
import { reportRequest } from "../reports/journal";
export class ReleaseError extends Error {}
function failure(error: unknown): never {
  if (error instanceof ContextError || error instanceof ReleaseError) throw error;
  throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "session release"));
}
export async function requestRelease(options: { config: string; input: string; requestFile: string }) {
  try {
    const config = resolve(options.config), inputFile = resolve(options.input), requestFile = resolve(options.requestFile);
    if (requestFile === config || requestFile === inputFile) throw new ReleaseError("Use a separate protected retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "session.release");
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.taskId !== "string" || Object.hasOwn(input, "requestId"))
      throw new ReleaseError("Provide a taskId and typed release input. The CLI generates requestId.");
    const { profile, caller, client } = await messageContext(config);
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind: "session_release", inputDigest: (await jsonDigest(input, reportLimits, "session.release")).value });
    const result = releaseResultSchemas.request.parse(await client.mutation(releaseApi.request, {
      verificationId: caller.verificationRequestId, input: canonicalJson({ ...input, requestId }, reportLimits, "session.release") }));
    return { ...result, requestId };
  } catch (error) { failure(error); }
}
export async function releaseState(options: { config: string; task: string; ancestryCheck?: string }) {
  try {
    if (!options.task || options.task.length > 256) throw new ReleaseError("Provide the task identity.");
    const { caller, client } = await messageContext(resolve(options.config));
    return releaseResultSchemas.state.parse(await client.query(releaseApi.state, { verificationId: caller.verificationRequestId, taskId: options.task, ...(options.ancestryCheck ? { ancestryCheckId: options.ancestryCheck } : {}) }));
  } catch (error) { failure(error); }
}
export async function releaseStatus(options: { config: string; requestId: string }) {
  try {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.requestId)) throw new ReleaseError("Provide the release request identity.");
    const { caller, client } = await messageContext(resolve(options.config));
    return releaseResultSchemas.status.parse(await client.query(releaseApi.status, { verificationId: caller.verificationRequestId, requestId: options.requestId }));
  } catch (error) { failure(error); }
}
