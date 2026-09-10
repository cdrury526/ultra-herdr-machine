import { resolve } from "node:path";
import { reportApi, reportResultSchemas, canonicalJson, jsonDigest } from "@ultra-herdr/api";
import { clientFor, loadProfile } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { ContextError } from "../context/errors";
import { reportRequest } from "./journal";
import { ReportError, reportFailure, reportLimits, reportSlots } from "./input";
export interface ReportOptions { config: string; assignment: string; input: string; requestFile: string }
export async function sendReport(kind: "submission" | "failure_report", options: ReportOptions) {
  try {
    const config = resolve(options.config), requestFile = resolve(options.requestFile), inputFile = resolve(options.input);
    if (requestFile === config || requestFile === inputFile) throw new ReportError("Use a separate protected file for the report retry journal.");
    if (!options.assignment || options.assignment.length > 256) throw new ReportError("Provide the immutable assignment message identity.");
    const slots = reportSlots(inputFile);
    const profile = await loadProfile(config, "machine"), caller = await resolveCaller(config);
    if (caller.machineId !== profile.machineId) throw new ReportError("Machine profile changed during caller verification; retry.");
    const inputDigest = (await jsonDigest(slots, reportLimits, "task.report")).value;
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind, assignmentMessageId: options.assignment, inputDigest });
    const input = canonicalJson({ ...slots, kind, assignmentMessageId: options.assignment, requestId }, reportLimits, "task.report");
    const client = clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
    const accepted = reportResultSchemas.accept.parse(await client.mutation(reportApi.accept, { verificationId: caller.verificationRequestId, input }));
    return { ...accepted, requestId };
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw reportFailure(error);
  }
}
