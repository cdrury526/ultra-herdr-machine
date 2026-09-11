import type { Command } from "commander";
import { cleanupHistory } from "../history/cleanup";
export function addHistoryCleanupCommands(history: Command) {
  history.command("cleanup").description("Request audited cloud history disposal. Eligible deletion continues on the backend; local files are retained.")
    .requiredOption("--task <id>", "Task whose cloud history should be disposed")
    .requiredOption("--reason <text>", "Audit reason for disposal")
    .option("--early", "Explicitly request deletion before the retention age; active work and unanswered requests remain protected")
    .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
    .requiredOption("--operator-profile <file>", "Protected operator profile with history.manage")
    .action(async options => { console.log(JSON.stringify(await cleanupHistory("begin", options))); });
  for (const [verb, mode, description] of [
    ["cleanup-status", "status", "Read disposal progress and any blocking reason."],
    ["cleanup-resume", "resume", "Advance and rearm an interrupted cleanup with current operator authority."],
    ["cleanup-cancel", "cancel", "Cancel checking before deletion is accepted; release any temporary locks."],
  ] as const) history.command(verb).description(description)
    .requiredOption("--cleanup <id>", "Cleanup identity")
    .requiredOption("--operator-profile <file>", "Protected operator profile with history.manage")
    .action(async options => { console.log(JSON.stringify(await cleanupHistory(mode, options))); });
  history.command("cleanup-list").description("List the latest twenty disposal attempts for a task, including automatic retention.")
    .requiredOption("--task <id>", "Task identity")
    .requiredOption("--operator-profile <file>", "Protected operator profile with history.manage")
    .action(async options => { console.log(JSON.stringify(await cleanupHistory("list", options))); });
}
