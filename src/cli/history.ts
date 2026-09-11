import { listMessageHistory, type HistoryListOptions } from "../history/list";
import { addHistoryCleanupCommands } from "./historyCleanup";
import { addLocalCleanupCommands } from "./localCleanup";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readMessageHistory, type HistoryOptions } from "../history/message";
export function addHistoryCommands(program: Command) {
  const history = program.command("history").description("Inspect authorized immutable history without applying receipt effects.");
  addHistoryCleanupCommands(history);
  addLocalCleanupCommands(history);
  history.command("list").description("List one authorized page of immutable message metadata in task order.")
    .requiredOption("--task <id>", "Task identity")
    .option("--cursor <cursor>", "Continue a previous page; restart if history or permissions changed")
    .option("--limit <count>", "Page size up to the deployment's configured bound")
    .option("--config <file>", "Protected machine profile", join(homedir(), ".config", "ultra-herdr", "machine.json"))
    .option("--released-session <id>", "Use this machine's recorded released session and its retained grants")
    .option("--operator-profile <file>", "Explicit operator profile with history.manage; excludes released-session mode")
    .action(async (options: HistoryListOptions) => { console.log(JSON.stringify(await listMessageHistory(options))); });
  history.command("message").description("Read one task-scoped message and save a verified private artifact.")
    .requiredOption("--task <id>", "Expected task identity")
    .requiredOption("--message <id>", "Immutable message identity")
    .option("--digest <sha256>", "Expected message digest")
    .option("--packet <id>", "Acknowledged execution escalation explicitly referencing this message; operator requires inbox.review")
    .option("--config <file>", "Protected machine profile", join(homedir(), ".config", "ultra-herdr", "machine.json"))
    .option("--released-session <id>", "Use this machine's recorded released session and its retained grants")
    .option("--operator-profile <file>", "Explicit operator profile: history.manage, or inbox.review with --packet; excludes released-session mode")
    .action(async (options: HistoryOptions) => { console.log(JSON.stringify(await readMessageHistory(options))); });
}
