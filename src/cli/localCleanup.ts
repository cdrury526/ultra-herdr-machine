import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { join } from "node:path";
import { homedir } from "node:os";
import { previewLocalCleanup, applyLocalCleanup } from "../history/localCleanup";
export function addLocalCleanupCommands(history: Command) {
  const local = history.command("local-cleanup").description("Preview and explicitly remove eligible verified local artifacts.");
  const common = (command: Command) => command
    .requiredOption("--preview-file <file>", "Protected preview manifest, separate from credentials and cached artifacts")
    .option("--config <file>", "Protected machine profile and its adjacent artifact cache", defaultMachineConfig())
    .option("--released-session <id>", "Use retained grants of this machine's released session")
    .option("--operator-profile <file>", "Use history.manage and this operator profile's artifact cache");
  common(local.command("preview").description("Write a new preview; no cached file is removed."))
    .option("--task <id>", "Select artifacts belonging to this task")
    .option("--session <id>", "Select artifacts for this assigned worker or message participant")
    .option("--eligible-cache", "Inspect the selected profile's cache")
    .option("--after <artifact-id>", "Continue after a previous preview's next cursor")
    .option("--limit <count>", "Files inspected per preview page, 1–1000", "100")
    .action(async options => { console.log(JSON.stringify(await previewLocalCleanup(options))); });
  common(local.command("apply").description("Remove previewed eligible files after fresh permission and identity checks."))
    .option("--artifact <ids...>", "Select a subset of eligible preview IDs; default is all eligible IDs in this preview")
    .action(async options => { console.log(JSON.stringify(await applyLocalCleanup(options))); });
}
