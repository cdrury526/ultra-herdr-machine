import { resolve } from "node:path";
import { ownershipApi, ownershipResultSchemas, parseJson, canonicalJson, jsonDigest } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { loadProfile, clientFor } from "../auth/client";
import { reportRequest } from "../reports/journal";
import { readReportFile, reportLimits, reportFailure, ReportError } from "../reports/input";
/** Stable protected request identity; ownership, eligibility and receipt effects remain entirely in Convex. */
export async function ownershipOperation(operation: "handoff" | "takeover", options: { config?: string; operatorProfile?: string; input: string; requestFile: string }) {
  try {
    const selected = resolve(options.operatorProfile ?? options.config!), inputFile = resolve(options.input), journal = resolve(options.requestFile);
    if (journal === selected || journal === inputFile) throw new ReportError("Use a separate protected ownership retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "task.ownership");
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "requestId"))
      throw new ReportError("Provide ownership input without requestId; the CLI records that identity in the retry journal.");
    const inputDigest = (await jsonDigest(input, reportLimits, "task.ownership")).value;
    for (;;) {
      if (options.operatorProfile) {
        const profile = await loadProfile(selected, "operator"), client = clientFor(profile);
        const requestId = await reportRequest(journal, { deploymentUrl: profile.convexUrl, operatorId: profile.principalId,
          kind: operation === "handoff" ? "operator_handoff" : "operator_takeover", inputDigest });
        const args = { input: canonicalJson({ ...input, requestId }, reportLimits, "task.ownership") };
        const result = operation === "handoff"
          ? ownershipResultSchemas.operatorHandoff.parse(await client.mutation(ownershipApi.operatorHandoff, args))
          : ownershipResultSchemas.operatorTakeover.parse(await client.mutation(ownershipApi.operatorTakeover, args));
        if (!("state" in result) || result.state !== "preparing") return { ...result, requestId };
      } else {
        const { caller, profile, client } = await messageContext(selected);
        const requestId = await reportRequest(journal, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
          callerSessionId: caller.sessionId, kind: operation === "handoff" ? "session_handoff" : "session_takeover", inputDigest });
        const args = { verificationId: caller.verificationRequestId, input: canonicalJson({ ...input, requestId }, reportLimits, "task.ownership") };
        const result = operation === "handoff"
          ? ownershipResultSchemas.handoff.parse(await client.mutation(ownershipApi.handoff, args))
          : ownershipResultSchemas.takeover.parse(await client.mutation(ownershipApi.takeover, args));
        if (!("state" in result) || result.state !== "preparing") return { ...result, requestId };
      }
    }
  } catch (error) { throw new ReportError(reportFailure(error).message.replace(/\breport\b/gi, "ownership")); }
}
