import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { ConvexError } from "convex/values";
import { parseJson, type Json } from "@ultra-herdr/api";
export const reportLimits = { maxBytes: 1048576, maxDepth: 64, maxNodes: 262144 };
export class ReportError extends Error {}

/** Read one bounded regular file without following a final symlink or waiting on a pipe. */
export function readReportFile(path: string, maxBytes = reportLimits.maxBytes, protectedFile = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || (protectedFile &&
        (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0))) throw new ReportError("Invalid report input or retry journal file.");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0, count = 0;
    while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    if (length > maxBytes) throw new ReportError("Report input or retry journal exceeds its size limit.");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally { closeSync(fd); }
}
export function reportSlots(path: string) {
  const value = parseJson(readReportFile(path), reportLimits, "task.report");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Object.hasOwn(value, "values") || !Object.hasOwn(value, "bundleValues") ||
      Object.keys(value).some(key => !["values", "bundleValues", "attributes"].includes(key)))
    throw new ReportError("Report input must contain values and bundleValues, with optional attributes only.");
  return value as { values: Json; bundleValues: Json; attributes?: Json };
}
export function reportFailure(error: unknown): ReportError {
  if (error instanceof ReportError) return error;
  if (error instanceof ConvexError) {
    const data = error.data as any;
    const code = typeof data?.code === "string" && /^[A-Z_]{1,64}$/.test(data.code) ? data.code : "REPORT_FAILED";
    const issue = data?.issues?.[0];
    const detail = typeof issue?.code === "string" && /^[A-Z_]{1,64}$/.test(issue.code) ? `/${issue.code}` : "";
    // User-authored property names may contain content. Expose only known structural field names.
    const fields = new Set(["values", "bundleValues", "attributes", "payload", "evidence", "summary", "references",
      "executionNotice", "responseNotice", "closedNotice", "root", "descendants", "noticeBriefKey", "stopBriefKey", "noticeValues", "stopValues", "noticeBundleValues", "stopBundleValues",
      "taskId", "submissionId", "expectedOwnerEpoch", "expectedRevision", "reviewId", "reviewGeneration", "briefKey", "failedChildren",
      "feedback", "corrections", "criterionResults", "criterion", "outcome", "explanation", "notes", "reason", "blockedOn", "assignmentMessageId", "requestId", "kind"]);
    const parts = typeof issue?.path === "string" ? issue.path.split("/").slice(1, 10) : [];
    const safe: string[] = [];
    for (const part of parts) { if (!fields.has(part) && !/^\d{1,6}$/.test(part)) break; safe.push(part); }
    return new ReportError(`${code}${detail}${safe.length ? ` at /${safe.join("/")}` : ""}. Check report fields and current caller authority; reuse the same request file when retrying unchanged input.`);
  }
  return new ReportError("Report not confirmed. Check the input, protected request file and machine context, then retry unchanged input with the same request file.");
}
