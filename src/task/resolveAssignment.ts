import { resolve } from "node:path";
import { messageContext } from "../reports/context";
import { listMessageHistory } from "../history/list";
import { readMessageHistory } from "../history/message";
import { ReportError } from "../reports/input";
import { findAssignmentMessage } from "./scaffold";

async function latestAssignmentMessageId(config: string, taskId: string, verificationId: string) {
  const history = await listMessageHistory({ config, task: taskId, verificationId });
  const messageId = findAssignmentMessage(history.items.map(item => ({ kind: item.kind, messageId: item.messageId })));
  if (!messageId) throw new ReportError("No assignment or revision message found for this task.");
  return messageId;
}

/** Latest assignment/revision message id for a worker-scoped task read. */
export async function resolveAssignmentMessage(configPath: string, taskId: string) {
  if (!taskId || taskId.length > 256) throw new ReportError("Provide the task identity.");
  const config = resolve(configPath);
  const { caller } = await messageContext(config);
  if (caller.role !== "worker") throw new ReportError("Worker reports require verified worker caller context.");
  return latestAssignmentMessageId(config, taskId, caller.verificationRequestId);
}

/** Payload from the latest assignment or revision message on the task timeline. */
export async function loadAssignmentPayload(configPath: string, taskId: string) {
  if (!taskId || taskId.length > 256) throw new ReportError("Provide the task identity.");
  const config = resolve(configPath);
  const { caller } = await messageContext(config);
  const messageId = await latestAssignmentMessageId(config, taskId, caller.verificationRequestId);
  const read = await readMessageHistory({ config, task: taskId, message: messageId, verificationId: caller.verificationRequestId });
  if (read.envelope.kind !== "assignment" && read.envelope.kind !== "revision")
    throw new ReportError("Latest assignment message is unavailable.");
  const payload = read.envelope.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new ReportError("Assignment payload is unavailable.");
  return payload as Record<string, unknown>;
}
