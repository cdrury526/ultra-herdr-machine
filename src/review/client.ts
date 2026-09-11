import { resolve } from "node:path";
import { reviewApi, reviewResultSchemas, canonicalJson, jsonDigest, parseJson } from "@ultra-herdr/api";
import { messageContext as context } from "../reports/context";
import { ContextError } from "../context/errors";
import { readReportFile, reportLimits, reportFailure } from "../reports/input";
import { reportRequest } from "../reports/journal";
export class ReviewError extends Error {}
export interface ReviewOptions { config: string; input: string; requestFile: string }
function failure(error: unknown): never {
  if (error instanceof ContextError || error instanceof ReviewError) throw error;
  throw new ReviewError(reportFailure(error).message.replace(/\breport\b/gi, "parent review"));
}
export async function sendReview(operation: "complete" | "feedback" | "revise" | "extend", options: ReviewOptions) {
  try {
    const config = resolve(options.config), inputFile = resolve(options.input), requestFile = resolve(options.requestFile);
    if (requestFile === config || requestFile === inputFile) throw new ReviewError("Use a separate protected retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "task.parentReview");
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.taskId !== "string" || Object.hasOwn(input, "requestId"))
      throw new ReviewError("Provide a taskId and typed parent operation input. The CLI generates requestId.");
    const { profile, caller, client } = await context(config);
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind: "parent_review", operation,
      inputDigest: (await jsonDigest(input, reportLimits, "task.parentReview")).value });
    const accepted = reviewResultSchemas[operation].parse(await client.mutation(reviewApi[operation], {
      verificationId: caller.verificationRequestId, input: canonicalJson({ ...input, requestId }, reportLimits, "task.parentReview") }));
    return { ...accepted, requestId };
  } catch (error) { failure(error); }
}
async function ownerState(operation: "state" | "budget", options: { config: string; task: string }) {
  try {
    if (!options.task || options.task.length > 256) throw new ReviewError("Provide the task identity.");
    const { caller, client } = await context(resolve(options.config));
    return reviewResultSchemas[operation].parse(await client.query(reviewApi[operation], { verificationId: caller.verificationRequestId, taskId: options.task }));
  } catch (error) { failure(error); }
}

export const reviewState = (options: { config: string; task: string }) => ownerState("state", options);
export const budgetState = (options: { config: string; task: string }) => ownerState("budget", options);
