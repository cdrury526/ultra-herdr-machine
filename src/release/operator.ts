import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas, canonicalJson, jsonDigest, parseJson } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { readReportFile, reportLimits, reportFailure } from "../reports/input";
import { reportRequest } from "../reports/journal";
import { ReleaseError } from "./client";
function failure(error: unknown): never {
  if (error instanceof ReleaseError) throw error;
  throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "operator release"));
}
export async function requestOperatorRelease(options: { operatorProfile: string; input: string; requestFile: string }) {
  try {
    const selected = resolve(options.operatorProfile), inputFile = resolve(options.input), requestFile = resolve(options.requestFile);
    if (requestFile === selected || requestFile === inputFile) throw new ReleaseError("Use a separate protected retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "session.release");
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.taskId !== "string" || Object.hasOwn(input, "requestId"))
      throw new ReleaseError("Provide a taskId and typed release input. The CLI generates requestId.");
    const profile = await loadProfile(selected, "operator"), client = clientFor(profile);
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, operatorId: profile.principalId,
      kind: "operator_session_release", inputDigest: (await jsonDigest(input, reportLimits, "session.release")).value });
    const result = releaseResultSchemas.operatorRequest.parse(await client.mutation(releaseApi.operatorRequest, {
      input: canonicalJson({ ...input, requestId }, reportLimits, "session.release") }));
    return { ...result, requestId };
  } catch (error) { failure(error); }
}
export async function operatorReleaseState(options: { operatorProfile: string; task: string }) {
  try {
    if (!options.task || options.task.length > 256) throw new ReleaseError("Provide the task identity.");
    const client = clientFor(await loadProfile(resolve(options.operatorProfile), "operator"));
    return releaseResultSchemas.operatorState.parse(await client.query(releaseApi.operatorState, { taskId: options.task }));
  } catch (error) { failure(error); }
}
export async function operatorReleaseStatus(options: { operatorProfile: string; requestId: string }) {
  try {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.requestId)) throw new ReleaseError("Provide the release request identity.");
    const client = clientFor(await loadProfile(resolve(options.operatorProfile), "operator"));
    return releaseResultSchemas.operatorStatus.parse(await client.query(releaseApi.operatorStatus, { requestId: options.requestId }));
  } catch (error) { failure(error); }
}
