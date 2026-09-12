import type { z } from "zod";
import { releaseResultSchemas, reviewResultSchemas } from "@ultra-herdr/api";

type ReviewState = z.infer<typeof reviewResultSchemas.state>;
type ReleaseState = z.infer<typeof releaseResultSchemas.state>;

export function scaffoldFeedback(state: ReviewState, feedback: string, corrections: string[] = [feedback]) {
  if (state.terminal) throw new Error("Task is already terminal.");
  if (!state.review?.submissionId || !state.review.reviewId) throw new Error("No current submission review to feedback.");
  return { taskId: state.taskId, submissionId: state.review.submissionId, expectedOwnerEpoch: state.ownerEpoch,
    expectedRevision: state.revision, reviewId: state.review.reviewId, reviewGeneration: state.review.reviewGeneration,
    briefKey: "review-feedback", values: { payload: { submissionId: state.review.submissionId, feedback, corrections } },
    bundleValues: {} };
}

export function scaffoldComplete(state: ReviewState, summary: string) {
  if (state.terminal) throw new Error("Task is already terminal.");
  if (!state.review?.submissionId) throw new Error("No current submission to complete.");
  return { taskId: state.taskId, submissionId: state.review.submissionId, expectedOwnerEpoch: state.ownerEpoch,
    expectedRevision: state.revision, failedChildren: [] as Array<never>, briefKey: "notice-task-completed",
    values: { payload: { evidence: { summary, references: [] as Array<never> } } }, bundleValues: {} };
}

export function scaffoldRelease(state: ReleaseState, reason: string) {
  if (state.released || state.closing) throw new Error("Session is already released or closing.");
  if (state.bindingEpoch === null) throw new Error("Worker binding is unavailable for release.");
  return { taskId: state.taskId, expectedOwnerEpoch: state.ownerEpoch, expectedAssignmentEpoch: state.assignmentEpoch,
    expectedBindingEpoch: state.bindingEpoch, reason, briefKey: "notice-session-released",
    values: { payload: {} }, bundleValues: {} };
}

export function scaffoldRevise(state: ReviewState, payload: Record<string, unknown>, changeReason: string) {
  if (state.terminal) throw new Error("Task is already terminal.");
  if (state.pendingRevision) throw new Error("A revision is already awaiting receipt.");
  return { taskId: state.taskId, expectedOwnerEpoch: state.ownerEpoch, expectedRevision: state.revision,
    briefKey: "revision", values: { payload: { ...payload, changeReason } }, bundleValues: {} };
}

export function scaffoldExtend(state: ReviewState, addedAllowanceMs: number, reason: string) {
  if (state.terminal) throw new Error("Task is already terminal.");
  if (!Number.isSafeInteger(addedAllowanceMs) || addedAllowanceMs <= 0) throw new Error("Provide a positive allowance increment.");
  return { taskId: state.taskId, expectedOwnerEpoch: state.ownerEpoch, expectedRevision: state.revision,
    addedAllowanceMs, briefKey: "extension", values: { payload: { reason } }, bundleValues: {} };
}

export function scaffoldResume(state: ReviewState, reason: string) {
  if (state.terminal) throw new Error("Task is already terminal.");
  if (!state.stop) throw new Error("Task is not stopped.");
  if (state.stop.epoch <= state.stop.resumedThroughEpoch) throw new Error("Task is not stopped.");
  if (state.pendingRevision) throw new Error("Finish or receive the pending revision before resuming.");
  if (state.pendingResume && !state.pendingResume.superseded) throw new Error("A resume is already awaiting receipt.");
  return { taskId: state.taskId, expectedOwnerEpoch: state.ownerEpoch, expectedRevision: state.revision,
    expectedStopEpoch: state.stop.epoch, briefKey: "resume", values: { payload: { reason } }, bundleValues: {} };
}

/** Latest assignment or revision message on the task timeline. */
export function findAssignmentMessage(messages: Array<{ kind: string; messageId: string }>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.kind === "assignment" || messages[i]!.kind === "revision") return messages[i]!.messageId;
  }
  return undefined;
}
