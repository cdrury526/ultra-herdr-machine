import { performance } from "node:perf_hooks";
import { ConvexError } from "convex/values";
import { authApi, contextApi, contextResultSchemas, PROTOCOL_VERSION } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { collectCallerEvidence } from "./evidence";
import { candidateTickets } from "./heldTickets";
import { ContextError, type ContextErrorCode } from "./errors";

const hints: Record<ContextErrorCode, string> = {
  MISSING_CONTEXT: "Caller context is missing. Run this command from an enrolled local Herdr session.",
  UNKNOWN_CONTEXT: "Caller context is unknown. Re-establish this session through the supported launch or discovery path.",
  AMBIGUOUS_CONTEXT: "Caller context matches multiple sessions. Re-establish a unique session binding before retrying.",
  CONFLICTING_CONTEXT: "Caller evidence conflicts with its recorded session. Reverify the launch context before retrying.",
  STALE_BINDING: "Caller binding is stale. Reverify the current session and retry the command.",
  UNSUPPORTED_CONTEXT: "Caller context is unsupported. Check the installed CLI and accepted discovery or launch profile.",
  OPERATION_NOT_READY: "Caller verification is not ready. Ensure the enrolled machine runtime is online and retry.",
};
function failure(code: ContextErrorCode) { return new ContextError(code, hints[code]); }
function sanitized(error: unknown): ContextError {
  if (error instanceof ContextError) return error;
  if (error instanceof ConvexError && error.data && typeof error.data === "object" && "code" in error.data) {
    const code = error.data.code;
    if (typeof code === "string" && Object.hasOwn(hints, code)) return failure(code as ContextErrorCode);
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
      return new ContextError("OPERATION_NOT_READY", "Machine authorization failed. Check credentials status for this configuration before retrying.");
    }
  }
  return failure("OPERATION_NOT_READY");
}
/** Product task commands reuse this resolver; they never inspect or address Herdr directly. */
export async function resolveCaller(configPath: string) {
  try {
    const profile = await loadProfile(configPath, "machine");
    // Transport ceiling only. Backend pending replies supply the actual frozen request lifetime and retry cadence.
    let deadline = performance.now() + 30_000;
    const boundedFetch: typeof globalThis.fetch = (input, init) => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw failure("STALE_BINDING");
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(Math.ceil(remaining)) }).catch(error => {
        if (performance.now() >= deadline) throw failure("STALE_BINDING");
        throw error;
      });
    };
    const client = clientFor(profile, boundedFetch);
    const deployment = await client.query(authApi.deploymentInfo, {});
    if (deployment.protocolVersion !== PROTOCOL_VERSION) throw failure("UNSUPPORTED_CONTEXT");
    // D175: a held ticket names its recipient session directly; pane evidence is only the fallback (e.g. root managers).
    for (const ticket of candidateTickets(configPath)) {
      try {
        const byTicket = contextResultSchemas.resolveTicketCaller.parse(await client.mutation(contextApi.resolveTicketCaller, { requestId: crypto.randomUUID(), ticket }));
        if (byTicket.status === "verified" && byTicket.machineId === profile.machineId) return byTicket;
      } catch { /* Stale or foreign ticket: try the next one, then pane evidence. */ }
    }
    let evidence = collectCallerEvidence(), retries = 3;
    let args = { requestId: crypto.randomUUID(), evidence };
    while (performance.now() < deadline) {
      const started = performance.now();
      const result = contextResultSchemas.resolveCaller.parse(await client.mutation(contextApi.resolveCaller, args));
      if (performance.now() >= deadline) throw failure("STALE_BINDING");
      if (result.status === "rejected") {
        // A fresh pane can be missed by the runtime's observation; a new request re-observes (fallback path only).
        if (result.code !== "UNKNOWN_CONTEXT" || retries-- <= 0) throw failure(result.code);
        await new Promise(done => setTimeout(done, 1500));
        evidence = collectCallerEvidence(); args = { requestId: crypto.randomUUID(), evidence };
        continue;
      }
      if (result.status === "verified") {
        if (result.machineId !== profile.machineId || !Number.isSafeInteger(result.bindingEpoch) || result.bindingEpoch < 1) throw failure("CONFLICTING_CONTEXT");
        return result;
      }
      if (!Number.isSafeInteger(result.remainingMs) || result.remainingMs <= 0 || result.remainingMs > 30_000 ||
          !Number.isSafeInteger(result.retryAfterMs) || result.retryAfterMs < 50 || result.retryAfterMs > 5000) throw failure("UNSUPPORTED_CONTEXT");
      deadline = Math.min(deadline, started + result.remainingMs);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw failure("STALE_BINDING");
      await new Promise(done => setTimeout(done, Math.min(result.retryAfterMs, remaining)));
    }
    throw failure("STALE_BINDING");
  } catch (error) { throw sanitized(error); }
}
