import { ConvexError } from "convex/values";
import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas, parseJson, canonicalJson, jsonDigest } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { loadProfile, clientFor } from "../auth/client";
import { reportRequest } from "../reports/journal";
import { readReportFile, reportLimits, reportFailure } from "../reports/input";
import { ReleaseError } from "./client";

/** A completed explicit review is required. Repeating this command resumes bounded preparation or recovers acceptance. */
export async function forceRelease(options: { config?: string; operatorProfile?: string; review: string; input: string; requestFile: string }) {
  try {
    const selected = resolve(options.operatorProfile ?? options.config!), inputFile = resolve(options.input), journal = resolve(options.requestFile);
    if (journal === selected || journal === inputFile || !options.review || options.review.length > 256)
      throw new ReleaseError("Provide the completed review identity and a separate protected retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "session.forceRelease");
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "requestId"))
      throw new ReleaseError("Provide reason, executionNotice, responseNotice and closedNotice input. The CLI generates requestId.");
    const inputDigest = (await jsonDigest({ reviewId: options.review, input }, reportLimits, "session.forceRelease")).value;
    const access = async () => {
      if (options.operatorProfile) {
        const profile = await loadProfile(selected, "operator");
        return { client: clientFor(profile), verificationId: undefined,
          scope: { deploymentUrl: profile.convexUrl, operatorId: profile.principalId, kind: "operator_force_release" as const, inputDigest } };
      }
      const { caller, profile, client } = await messageContext(selected);
      return { client, verificationId: caller.verificationRequestId,
        scope: { deploymentUrl: profile.convexUrl, machineId: caller.machineId, callerSessionId: caller.sessionId, kind: "session_force_release" as const, inputDigest } };
    };
    // Refresh caller/authentication for every bounded step. The protected journal also fences a changed caller.
    for (;;) {
      const a = await access(), requestId = await reportRequest(journal, a.scope);
      const args = { reviewId: options.review, input: canonicalJson({ ...input, requestId }, reportLimits, "session.forceRelease") };
      const result = a.verificationId
        ? releaseResultSchemas.forceRequest.parse(await a.client.mutation(releaseApi.forceRequest, { ...args, verificationId: a.verificationId }))
        : releaseResultSchemas.operatorForceRequest.parse(await a.client.mutation(releaseApi.operatorForceRequest, args));
      if (result.state !== "preparing") return { ...result, requestId };
    }
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    if (error instanceof ConvexError && ["STALE_CURSOR", "STALE_REVISION"].includes((error.data as { code?: string }).code ?? ""))
      throw new ReleaseError("The prepared release or reviewed scope changed. Discard the unused review, review current obligations, and use a new request journal.");
    throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "force release"));
  }
}
