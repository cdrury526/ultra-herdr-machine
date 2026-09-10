import { lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson, parseJson } from "@ultra-herdr/api";
import { withCredentialLock, writeLocked } from "../auth/storage";
import { ReportError, readReportFile } from "./input";
const limits = { maxBytes: 4096, maxDepth: 8, maxNodes: 64 };
const scopeShape = z.object({ deploymentUrl: z.string(), machineId: z.string(), callerSessionId: z.string(),
  kind: z.enum(["submission", "failure_report"]), assignmentMessageId: z.string(), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const journalShape = z.object({ version: z.literal(1), requestId: z.string().uuid(), scope: scopeShape }).strict();
export type ReportScope = z.infer<typeof scopeShape>;

/** A fresh journal is a new intent; identical retries reuse its UUID across process loss. No bodies or tickets are stored. */
export async function reportRequest(path: string, scope: ReportScope) {
  return withCredentialLock(path, async lockedPath => {
    let exists = true;
    try { lstatSync(lockedPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) {
      const saved = journalShape.parse(parseJson(readReportFile(lockedPath, limits.maxBytes, true), limits, "task.reportJournal"));
      if (canonicalJson(saved.scope, limits, "task.reportJournal") !== canonicalJson(scope, limits, "task.reportJournal"))
        throw new ReportError("Retry journal conflicts with this report or caller. Restore the original inputs to retry; use a new request file only for a new report intent.");
      return saved.requestId;
    }
    const journal = journalShape.parse({ version: 1, requestId: randomUUID(), scope });
    canonicalJson(journal, limits, "task.reportJournal");
    writeLocked(lockedPath, journal);
    return journal.requestId;
  });
}
