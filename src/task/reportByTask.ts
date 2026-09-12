import { resolve } from "node:path";
import { sendReport } from "../reports/client";
import { materializeReportInput } from "./reportData";
import { resolveAssignmentMessage } from "./resolveAssignment";

export async function reportByTask(kind: "submission" | "failure_report", options: {
  config: string; task: string; requestFile: string; input?: string; data?: string; dataFile?: string;
}) {
  const assignment = await resolveAssignmentMessage(resolve(options.config), options.task);
  const input = materializeReportInput(kind, options);
  return sendReport(kind, { config: options.config, assignment, input, requestFile: options.requestFile });
}
