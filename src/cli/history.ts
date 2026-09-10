import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readMessageHistory, type HistoryOptions } from "../history/message";
export function addHistoryCommands(program: Command) {
  const history = program.command("history").description("Inspect authorized immutable history without applying receipt effects.");
  history.command("message").description("Read one task-scoped message and save a verified private artifact.")
    .requiredOption("--task <id>", "Expected task identity")
    .requiredOption("--message <id>", "Immutable message identity")
    .option("--digest <sha256>", "Expected message digest")
    .option("--config <file>", "Protected machine profile", join(homedir(), ".config", "ultra-herdr", "machine.json"))
    .option("--released-session <id>", "Use this machine's recorded released session and its retained grants")
    .option("--operator-profile <file>", "Explicit operator profile with history.manage; excludes released-session mode")
    .action(async (options: HistoryOptions) => { console.log(JSON.stringify(await readMessageHistory(options))); });
}
