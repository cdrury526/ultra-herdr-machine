import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendReport, type ReportOptions } from "../reports/client";
export function addReportCommands(program: Command) {
  for (const [command, kind] of [["submit", "submission"], ["report-failure", "failure_report"]] as const) {
    program.command(command).description("Send a typed worker report to the parent; task closure remains the parent's decision.")
      .requiredOption("--assignment <message-id>", "Immutable assignment/revision message this report answers")
      .requiredOption("--input <file>", "JSON file with values, bundleValues and optional attributes")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for retries, choose a fresh path for a new report")
      .option("--config <file>", "Protected machine profile", defaultMachineConfig())
      .action(async (options: ReportOptions) => { console.log(JSON.stringify(await sendReport(kind, options))); });
  }
}
