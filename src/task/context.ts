import { resolve } from "node:path";
import { reviewResultSchemas } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";
import { reviewState } from "../review/client";
import { releaseState } from "../release/client";
import { listMessageHistory } from "../history/list";
import { listTaskHierarchy } from "../history/tasks";
import { readInbox } from "../receive/inbox";
import { peekDelivery, peekTicket, type TicketAnchor } from "./peek";
import { defaultExtensionMs } from "./reviewByTask";
import { findAssignmentMessage, scaffoldComplete, scaffoldExtend, scaffoldFeedback, scaffoldRelease, scaffoldResume, scaffoldRevise } from "./scaffold";
import { loadAssignmentPayload } from "./resolveAssignment";

export type TaskAction = { command: string; ready: boolean; reason?: string; argv: string[] };

export async function readTaskContext(options: {
  config: string; task?: string; ticket?: string; delivery?: string; generation?: number; childLimit?: number;
}) {
  const config = resolve(options.config);
  let anchor: (TicketAnchor & { ticket?: string }) | undefined;
  let taskId = options.task;
  if (options.ticket) {
    anchor = await peekTicket(config, options.ticket);
    taskId = anchor.taskId;
  } else if (options.delivery !== undefined && options.generation !== undefined) {
    anchor = await peekDelivery(config, options.delivery, options.generation);
    taskId = anchor.taskId;
  }
  if (!taskId) throw new Error("Provide --task, --ticket, or --delivery with --generation.");

  const { caller } = await messageContext(config);
  const pageLimit = options.childLimit !== undefined && Number.isFinite(options.childLimit) && options.childLimit > 0
    ? String(Math.trunc(options.childLimit)) : undefined;
  const history = await listMessageHistory({ config, task: taskId, ...(pageLimit ? { limit: pageLimit } : {}),
    verificationId: caller.verificationRequestId });
  const inbox = await readInbox({ config });
  const children = await listTaskHierarchy({ config, task: taskId, scope: "children", ...(pageLimit ? { limit: pageLimit } : {}),
    verificationId: caller.verificationRequestId });
  let review: ReturnType<typeof reviewResultSchemas.state.parse> | null = null;
  try { review = reviewResultSchemas.state.parse(await reviewState({ config, task: taskId })); } catch { review = null; }
  const release = await releaseState({ config, task: taskId }).catch(() => null);
  const pending = inbox.items.filter(item => item.taskId === taskId);
  const messages = history.items.map(item => ({ sequence: item.sequence, kind: item.kind, messageId: item.messageId,
    digest: item.digest, createdAt: item.createdAt, sender: item.sender, recipient: item.recipient }));
  const childTasks = children.items.map(item => ({ taskId: item.taskId, outcome: item.outcome, awaitingReview: item.awaitingReview,
    stopped: item.stopped, sessionId: item.sessionId, ownerEpoch: item.ownerEpoch, revision: item.assignmentRevision }));

  const scaffolds: Record<string, unknown> = {};
  const actions: TaskAction[] = [];
  for (const item of pending) {
    actions.push({ command: "receive", ready: true,
      argv: ["herdr-cli", "receive", "--delivery", item.deliveryId, "--generation", String(item.generation)] });
  }
  if (review && !review.terminal) {
    if (review.review?.submissionId) {
      try {
        scaffolds.complete = scaffoldComplete(review, "Task completed.");
        actions.push({ command: "complete", ready: true, argv: ["herdr-cli", "complete", "--task", taskId, "--summary", "Task completed."] });
      } catch (error) {
        actions.push({ command: "complete", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
      }
      if (review.review.reviewId) {
        try {
          scaffolds.feedback = scaffoldFeedback(review, "Apply these corrections.");
          actions.push({ command: "feedback", ready: true,
            argv: ["herdr-cli", "feedback", "--task", taskId, "--note", "Apply these corrections."] });
        } catch (error) {
          actions.push({ command: "feedback", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
        }
      }
    }
    try {
      const payload = await loadAssignmentPayload(config, taskId);
      scaffolds.revise = scaffoldRevise(review, payload, "Clarify assignment.");
      actions.push({ command: "revise", ready: true,
        argv: ["herdr-cli", "revise", "--task", taskId, "--reason", "Clarify assignment."] });
    } catch (error) {
      actions.push({ command: "revise", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
    }
    try {
      const allowanceMs = await defaultExtensionMs(config, taskId);
      scaffolds.extend = scaffoldExtend(review, allowanceMs, "More time for this task.");
      actions.push({ command: "extend", ready: true,
        argv: ["herdr-cli", "extend", "--task", taskId, "--allowance-ms", String(allowanceMs), "--reason", "More time for this task."] });
    } catch (error) {
      actions.push({ command: "extend", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
    }
    try {
      scaffolds.resume = scaffoldResume(review, "Continue after stop.");
      actions.push({ command: "resume", ready: true,
        argv: ["herdr-cli", "resume", "--task", taskId, "--reason", "Continue after stop."] });
    } catch (error) {
      actions.push({ command: "resume", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
    }
  }
  if (release && !release.released && !release.closing && release.terminal) {
    try {
      scaffolds.release = scaffoldRelease(release, "Routine release after task completion.");
      actions.push({ command: "release", ready: true, argv: ["herdr-cli", "release", "--task", taskId, "--reason", "Routine release after task completion."] });
    } catch (error) {
      actions.push({ command: "release", ready: false, reason: error instanceof Error ? error.message : "Unavailable", argv: [] });
    }
  }
  if (caller.role === "worker" && findAssignmentMessage(messages)) {
    actions.push({ command: "submit", ready: true,
      argv: ["herdr-cli", "submit", "--task", taskId, "--data", "{\"payload\":{}}", "--request-file", "REPORT.request.json"] });
  }

  return {
    mode: "task-context", taskId, anchor: anchor ?? null,
    caller: { sessionId: caller.sessionId, role: caller.role, machineId: caller.machineId },
    review, release, messages, children: childTasks, pendingDeliveries: pending, actions, scaffolds,
  };
}
