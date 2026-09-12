import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { sendReport, type ReportOptions } from "../reports/client";
import { reportByTask } from "../task/reportByTask";
import { addAutoRequestFileOption, addDocumentInputOptions, inputModeCount, resolveReportContentInput, resolveRequestFile } from "./mutationOptions";

type ReportCliOptions = ReportOptions & { task?: string; data?: string; dataFile?: string; requestFile?: string };

function reportAction(kind: "submission" | "failure_report", options: ReportCliOptions) {
  const requestFile = resolveRequestFile(kind, options.requestFile);
  if (options.task) {
    if (options.assignment || inputModeCount(options) > 0)
      throw new Error("Use --task with --data/--data-file, not --assignment or --input.");
    return reportByTask(kind, { config: options.config, task: options.task, requestFile,
      ...(options.data ? { data: options.data } : {}), ...(options.dataFile ? { dataFile: options.dataFile } : {}) });
  }
  const input = resolveReportContentInput(kind, options);
  if (!options.assignment) throw new Error("Provide --assignment and input, or use --task with --data.");
  return sendReport(kind, { config: options.config, assignment: options.assignment, input, requestFile });
}

export function addReportCommands(program: Command) {
  const config = defaultMachineConfig();
  for (const [command, kind] of [["submit", "submission"], ["report-failure", "failure_report"]] as const) {
    const cmd = program.command(command).description("Send a typed worker report to the parent; task closure remains the parent's decision.")
      .option("--task <id>", "Resolve assignment from task history; use with --data or --data-file")
      .option("--assignment <message-id>", "Immutable assignment/revision message this report answers");
    addDocumentInputOptions(cmd, "JSON file with values and optional attributes");
    addAutoRequestFileOption(cmd);
    cmd.option("--config <file>", "Protected machine profile", config)
      .action(async (options: ReportCliOptions) => { console.log(JSON.stringify(await reportAction(kind, options))); });
  }
}
