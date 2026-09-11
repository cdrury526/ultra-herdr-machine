import { resolve } from "node:path";
import { releaseApi, releaseResultSchemas, jsonDigest } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { reportRequest } from "../reports/journal";
import { reportLimits, reportFailure } from "../reports/input";
import { ReleaseError } from "./client";
/** One bounded backend page per CLI invocation; reuse the journal until the returned state is verified/rejected. */
export async function checkReleaseAuthority(options: { config: string; task: string; requestFile: string }) {
  try {
    const config = resolve(options.config), journal = resolve(options.requestFile);
    if (journal === config || !options.task || options.task.length > 256) throw new ReleaseError("Provide a task and a separate protected retry journal.");
    const { caller, profile, client } = await messageContext(config);
    const requestId = await reportRequest(journal, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind: "session_ancestry", inputDigest: (await jsonDigest({ taskId: options.task }, reportLimits, "session.release.ancestry")).value });
    const initial = releaseResultSchemas.ancestryBegin.parse(await client.mutation(releaseApi.ancestryBegin, {
      verificationId: caller.verificationRequestId, taskId: options.task, requestId }));
    const result = initial.state === "searching" ? releaseResultSchemas.ancestryAdvance.parse(await client.mutation(releaseApi.ancestryAdvance, {
      verificationId: caller.verificationRequestId, checkId: initial.checkId, expectedGeneration: initial.generation })) : initial;
    return { ...result, requestId };
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "release authority"));
  }
}
export async function discardReleaseAuthority(options: { config: string; check: string }) {
  try {
    if (!options.check || options.check.length > 256) throw new ReleaseError("Provide the ancestry check identity.");
    const { caller, client } = await messageContext(resolve(options.config));
    return releaseResultSchemas.ancestryDiscard.parse(await client.mutation(releaseApi.ancestryDiscard, {
      verificationId: caller.verificationRequestId, checkId: options.check }));
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(reportFailure(error).message.replace(/\breport\b/gi, "release authority"));
  }
}
