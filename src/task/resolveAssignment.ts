import { resolve } from "node:path";
import { messageContext } from "../reports/context";
import { listMessageHistory } from "../history/list";
import { ReportError } from "../reports/input";
import { findAssignmentMessage } from "./scaffold";

/** Latest assignment/revision message id for a worker-scoped task read. */
export async function resolveAssignmentMessage(configPath: string, taskId: string) {
  if (!taskId || taskId.length > 256) throw new ReportError("Provide the task identity.");
  const config = resolve(configPath);
  const { caller } = await messageContext(config);
  if (caller.role !== "worker") throw new ReportError("Worker reports require verified worker caller context.");
  const history = await listMessageHistory({ config, task: taskId, verificationId: caller.verificationRequestId });
  const assignment = findAssignmentMessage(history.items.map(item => ({ kind: item.kind, messageId: item.messageId })));
  if (!assignment) throw new ReportError("No assignment or revision message found for this task.");
  return assignment;
}
