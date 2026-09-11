import { lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson, parseJson } from "@ultra-herdr/api";
import { withCredentialLock, writeLocked } from "../auth/storage";
import { ReportError, readReportFile } from "./input";
const limits = { maxBytes: 4096, maxDepth: 8, maxNodes: 64 };
const reportScopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.enum(["submission", "failure_report"]), assignmentMessageId: z.string(), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const failureScopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.enum(["parent_failure", "parent_stop"]), taskId: z.string(), ownerEpoch: z.number().int().positive(), revision: z.number().int().positive(),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const reviewScopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.literal("parent_review"), operation: z.enum(["complete", "feedback", "revise", "extend", "resume"]), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const conversationScopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.literal("conversation"), operation: z.enum(["question", "reply", "nudge"]), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const releaseScopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.literal("session_release"), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ReleaseScope = z.infer<typeof releaseScopeShape>;
const scopeShape = z.union([releaseScopeShape,reportScopeShape, failureScopeShape, reviewScopeShape, conversationScopeShape]);
const journalShape = z.object({ version: z.literal(1), requestId: z.string().uuid(), scope: scopeShape }).strict();
export type ConversationScope = z.infer<typeof conversationScopeShape>;
export type ReportScope = z.infer<typeof reportScopeShape>;
export type ReviewScope = z.infer<typeof reviewScopeShape>;
export type FailureScope = z.infer<typeof failureScopeShape>;

/** A fresh journal is a new intent; identical retries reuse its UUID across process loss. No bodies or tickets are stored. */
export async function reportRequest(path: string, scope: ReportScope | FailureScope | ReviewScope | ConversationScope | ReleaseScope) {
  return withCredentialLock(path, async lockedPath => {
    let exists = true;
    try { lstatSync(lockedPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) {
      const saved = journalShape.parse(parseJson(readReportFile(lockedPath, limits.maxBytes, true), limits, "task.reportJournal"));
      if (canonicalJson(saved.scope, limits, "task.reportJournal") !== canonicalJson(scope, limits, "task.reportJournal"))
        throw new ReportError("Retry journal conflicts with this operation or caller. Restore the original inputs to retry; use a new request file only for a new operation intent.");
      return saved.requestId;
    }
    const journal = journalShape.parse({ version: 1, requestId: randomUUID(), scope });
    canonicalJson(journal, limits, "task.reportJournal");
    writeLocked(lockedPath, journal);
    return journal.requestId;
  });
}

export function readFailureRequest(path: string, kind: "failure" | "stop" = "failure") {
  const saved = journalShape.parse(parseJson(readReportFile(path, limits.maxBytes, true), limits, "task.failureJournal"));
  if (saved.scope.kind !== `parent_${kind}`) throw new ReportError(`Expected a parent ${kind} retry journal.`);
  return { requestId: saved.requestId, scope: saved.scope };
}
