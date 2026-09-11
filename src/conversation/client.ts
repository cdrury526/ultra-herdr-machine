import { clientFor, loadProfile } from "../auth/client";
import { resolve } from "node:path";
import { conversationApi, conversationResultSchemas, canonicalJson, jsonDigest, parseJson } from "@ultra-herdr/api";
import { ContextError } from "../context/errors";
import { readReportFile, reportLimits, reportFailure } from "../reports/input";
import { reportRequest } from "../reports/journal";
import { messageContext } from "../reports/context";
export class ConversationError extends Error {}
export interface ConversationOptions { config?: string; operatorProfile?: string; input: string; requestFile: string }
function failure(error: unknown): never {
  if (error instanceof ContextError || error instanceof ConversationError) throw error;
  throw new ConversationError(reportFailure(error).message.replace(/\breport\b/gi, "conversation"));
}
export async function sendConversation(kind: "question" | "reply" | "nudge", options: ConversationOptions) {
  try {
    const config = resolve(options.operatorProfile ?? options.config!), inputFile = resolve(options.input), requestFile = resolve(options.requestFile);
    if (requestFile === config || requestFile === inputFile) throw new ConversationError("Use a separate protected retry journal.");
    const input = parseJson(readReportFile(inputFile), reportLimits, "task.conversation");
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "requestId") || Object.hasOwn(input, "kind"))
      throw new ConversationError("Provide typed conversation input without kind or requestId; the CLI supplies them.");
    if (options.operatorProfile) {
      if (kind === "question") throw new ConversationError("Operator conversation supports replies and nudges.");
      const profile = await loadProfile(config, "operator");
      const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, operatorId: profile.principalId,
        kind: kind === "reply" ? "operator_reply" : "operator_nudge", inputDigest: (await jsonDigest(input, reportLimits, "task.conversation")).value });
      const client = clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
      const operation = kind === "reply" ? "operatorReply" : "operatorNudge";
      const accepted = conversationResultSchemas[operation].parse(await client.mutation(conversationApi[operation],
        { input: canonicalJson({ ...input, kind, requestId }, reportLimits, "task.conversation") }));
      return { ...accepted, requestId };
    }
    const { profile, caller, client } = await messageContext(config);
    const requestId = await reportRequest(requestFile, { deploymentUrl: profile.convexUrl, machineId: caller.machineId,
      callerSessionId: caller.sessionId, kind: "conversation", operation: kind,
      inputDigest: (await jsonDigest(input, reportLimits, "task.conversation")).value });
    const accepted = conversationResultSchemas.accept.parse(await client.mutation(conversationApi.accept, {
      verificationId: caller.verificationRequestId, input: canonicalJson({ ...input, kind, requestId }, reportLimits, "task.conversation") }));
    return { ...accepted, requestId };
  } catch (error) { failure(error); }
}
export async function questionState(options: { config: string; request: string }) {
  try {
    if (!options.request || options.request.length > 256) throw new ConversationError("Provide the immutable question message identity.");
    const { caller, client } = await messageContext(resolve(options.config));
    return conversationResultSchemas.state.parse(await client.query(conversationApi.state,
      { verificationId: caller.verificationRequestId, requestMessageId: options.request }));
  } catch (error) { failure(error); }
}
