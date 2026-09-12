import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { sendReport, type ReportOptions } from "../reports/client";
import { reportByTask } from "../task/reportByTask";

type ReportCliOptions = ReportOptions & { task?: string; data?: string; dataFile?: string };

function reportAction(kind: "submission" | "failure_report", options: ReportCliOptions) {
  if (options.task) {
    if (options.assignment || options.input) throw new Error("Use --task with --data/--data-file, not --assignment or --input.");
    return reportByTask(kind, { config: options.config, task: options.task, requestFile: options.requestFile,
      ...(options.data ? { data: options.data } : {}), ...(options.dataFile ? { dataFile: options.dataFile } : {}) });
  }
  if (!options.assignment || !options.input) throw new Error("Provide --assignment and --input, or use --task with --data.");
  return sendReport(kind, options);
}

export function addReportCommands(program: Command) {
  const config = defaultMachineConfig();
  for (const [command, kind] of [["submit", "submission"], ["report-failure", "failure_report"]] as const) {
    program.command(command).description("Send a typed worker report to the parent; task closure remains the parent's decision.")
      .option("--task <id>", "Resolve assignment from task history; use with --data or --data-file")
      .option("--assignment <message-id>", "Immutable assignment/revision message this report answers")
      .option("--input <file>", "JSON file with values and optional attributes")
      .option("--data <json>", "Inline JSON report content (values object or {values:…})")
      .option("--data-file <file>", "Path to JSON report content")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for retries, choose a fresh path for a new report")
      .option("--config <file>", "Protected machine profile", config)
      .action(async (options: ReportCliOptions) => { console.log(JSON.stringify(await reportAction(kind, options))); });
  }
}
