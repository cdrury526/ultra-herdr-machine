import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestFailure, failureStatus, type FailureOptions } from "../failure/client";
export function addFailureCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  program.command("fail").description("Request parent-owned task failure and descendant disposition. Check state: preparing is not accepted failure.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .requiredOption("--owner-epoch <number>", "Expected task owner epoch")
    .requiredOption("--revision <number>", "Expected assignment revision")
    .requiredOption("--input <file>", "JSON with root and descendants notice/stop brief slots")
    .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries and authorization refresh")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: FailureOptions) => { console.log(JSON.stringify(await requestFailure(options))); });
  program.command("failure-status").description("Read a failure request's state without renewing authority or advancing work.")
    .requiredOption("--request-file <file>", "The original protected failure retry journal")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: Pick<FailureOptions, "config" | "requestFile">) => { console.log(JSON.stringify(await failureStatus(options))); });
}
