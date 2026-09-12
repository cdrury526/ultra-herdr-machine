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

/** Latest assignment or revision message on the task timeline. */
export function findAssignmentMessage(messages: Array<{ kind: string; messageId: string }>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.kind === "assignment" || messages[i]!.kind === "revision") return messages[i]!.messageId;
  }
  return undefined;
}
