import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas, jsonDigest } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { loadProfile, clientFor } from "../auth/client";
import { reportRequest } from "../reports/journal";
import { reportLimits, reportFailure } from "../reports/input";
import { ReleaseError } from "./client";
type Access = { config?: string; operatorProfile?: string };
async function access(options: Access) {
  if (options.operatorProfile) {
    const selected = resolve(options.operatorProfile), profile = await loadProfile(selected, "operator");
    return { selected, client: clientFor(profile), verificationId: undefined,
      scope: { deploymentUrl: profile.convexUrl, operatorId: profile.principalId, kind: "operator_force_review" as const } };
  }
  if (!options.config) throw new ReleaseError("Provide the machine profile or explicit operator profile.");
  const selected = resolve(options.config), { caller, profile, client } = await messageContext(selected);
  return { selected, client, verificationId: caller.verificationRequestId,
    scope: { deploymentUrl: profile.convexUrl, machineId: caller.machineId, callerSessionId: caller.sessionId, kind: "session_force_review" as const } };
}
function identity(value: string) {
  if (!value || value.length > 256) throw new ReleaseError("Provide the task or review identity returned by the CLI.");
  return value;
}
function failure(error: unknown): never {
  if (error instanceof ReleaseError) throw error;
  throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "force-release review"));
}
/** Begin/replay returns page one, without acknowledging it. Each page requires a separate explicit command. */
export async function beginForceReleaseReview(options: Access & { task: string; requestFile: string }) {
  try {
    const taskId = identity(options.task), a = await access(options), journal = resolve(options.requestFile);
    if (journal === a.selected) throw new ReleaseError("Use a separate protected retry journal.");
    const requestId = await reportRequest(journal, { ...a.scope, inputDigest: (await jsonDigest({ taskId }, reportLimits, "session.forceRelease.review")).value });
    const result = a.verificationId
      ? releaseResultSchemas.forceReviewBegin.parse(await a.client.mutation(releaseApi.forceReviewBegin, { verificationId: a.verificationId, taskId, requestId }))
      : releaseResultSchemas.operatorForceReviewBegin.parse(await a.client.mutation(releaseApi.operatorForceReviewBegin, { taskId, requestId }));
    return { ...result, requestId };
  } catch (error) { failure(error); }
}
export async function acknowledgeForceReleaseReview(options: Access & { review: string; generation: string; pageDigest: string }) {
  try {
    const reviewId = identity(options.review), generation = Number(options.generation);
    if (!Number.isSafeInteger(generation) || generation < 1 || !/^[a-f0-9]{64}$/.test(options.pageDigest))
      throw new ReleaseError("Provide the generation and page digest of the page you reviewed.");
    const a = await access(options), input = { reviewId, generation, pageDigest: options.pageDigest };
    return a.verificationId
      ? releaseResultSchemas.forceReviewAdvance.parse(await a.client.mutation(releaseApi.forceReviewAdvance, { ...input, verificationId: a.verificationId }))
      : releaseResultSchemas.operatorForceReviewAdvance.parse(await a.client.mutation(releaseApi.operatorForceReviewAdvance, input));
  } catch (error) { failure(error); }
}
export async function discardForceReleaseReview(options: Access & { review: string }) {
  try {
    const reviewId = identity(options.review), a = await access(options);
    return a.verificationId
      ? releaseResultSchemas.forceReviewDiscard.parse(await a.client.mutation(releaseApi.forceReviewDiscard, { verificationId: a.verificationId, reviewId }))
      : releaseResultSchemas.operatorForceReviewDiscard.parse(await a.client.mutation(releaseApi.operatorForceReviewDiscard, { reviewId }));
  } catch (error) { failure(error); }
}
