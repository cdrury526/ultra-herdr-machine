import { ConvexError } from "convex/values";
import { resolve } from "node:path";
import { failureApi, failureResultSchemas, canonicalJson, jsonDigest, parseJson } from "@ultra-herdr/api";
import { clientFor, loadProfile } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { ContextError } from "../context/errors";
import { readFailureRequest, reportRequest } from "../reports/journal";
import { ReportError, reportFailure, reportLimits, readReportFile } from "../reports/input";
export interface FailureOptions { config: string; task: string; ownerEpoch: string; revision: string; input: string; requestFile: string }
export class FailureError extends Error {}
function failureError(error: unknown): never {
  if (error instanceof ContextError || error instanceof FailureError) throw error;
  throw new FailureError(reportFailure(error).message.replace(/\breport\b/gi, "failure request"));
}
function epoch(text: string) {
  const value = Number(text);
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(value)) throw new FailureError("Expected a positive safe integer owner epoch and revision.");
  return value;
}
async function context(config: string) {
  const profile = await loadProfile(config, "machine"), caller = await resolveCaller(config);
  if (profile.machineId !== caller.machineId) throw new FailureError("Machine profile changed during verification; retry.");
  return { profile, caller, client: clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) })) };
}
function display(result: ReturnType<typeof failureResultSchemas.status.parse>) {
  const { errorJson, ...status } = result;
  // Stored field errors can contain user-authored names. Do not print their raw JSON.
  let error: string | undefined;
  if (errorJson) {
    try { error = reportFailure(new ConvexError(JSON.parse(errorJson))).message.replace(/\breport\b/gi, "failure request"); }
    catch { error = "Preparation could not finish. Check the failure brief contracts and current caller authority."; }
  }
  return { ...status, ...(error ? { error } : {}) };
}
export async function requestFailure(options: FailureOptions) {
  try {
    const config = resolve(options.config), inputFile = resolve(options.input), requestFile = resolve(options.requestFile);
    if (requestFile === config || requestFile === inputFile) throw new FailureError("Use a separate protected retry journal.");
    const ownerEpoch = epoch(options.ownerEpoch), revision = epoch(options.revision);
    if (!options.task || options.task.length > 256) throw new FailureError("Provide the task identity.");
    const slots = parseJson(readReportFile(inputFile), reportLimits, "task.failure");
    const briefs = canonicalJson(slots, reportLimits, "task.failure");
    const { profile, caller, client } = await context(config);
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind: "parent_failure", taskId: options.task, ownerEpoch, revision,
      inputDigest: (await jsonDigest(slots, reportLimits, "task.failure")).value });
    const input = JSON.stringify({ requestId, taskId: options.task, expectedOwnerEpoch: ownerEpoch, expectedRevision: revision });
    return display(failureResultSchemas.request.parse(await client.mutation(failureApi.request,
      { verificationId: caller.verificationRequestId, input, briefs })));
  } catch (error) { failureError(error); }
}
export async function failureStatus(options: Pick<FailureOptions, "config" | "requestFile">) {
  try {
    const saved = readFailureRequest(resolve(options.requestFile));
    const { profile, caller, client } = await context(resolve(options.config));
    if (saved.scope.deploymentUrl !== profile.convexUrl || saved.scope.machineId !== caller.machineId || saved.scope.callerSessionId !== caller.sessionId)
      throw new ReportError("Retry journal belongs to a different deployment or caller.");
    return display(failureResultSchemas.status.parse(await client.query(failureApi.status,
      { verificationId: caller.verificationRequestId, requestId: saved.requestId })));
  } catch (error) { failureError(error); }
}
