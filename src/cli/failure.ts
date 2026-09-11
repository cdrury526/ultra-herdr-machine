import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestFailure, failureStatus, type FailureOptions } from "../failure/client";
export function addFailureCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  for (const kind of ["failure", "stop"] as const) {
    program.command(kind === "failure" ? "fail" : "stop")
      .description(kind === "failure" ? "Request parent-owned task failure and descendant disposition. Preparing is not accepted failure."
        : "Request cooperative subtree stop. Acceptance blocks delegation; receipt pauses execution. Tasks and sessions remain retained.")
      .requiredOption("--task <id>", "Task owned by this parent session")
      .requiredOption("--owner-epoch <number>", "Expected task owner epoch")
      .requiredOption("--revision <number>", "Expected assignment revision")
      .requiredOption("--input <file>", kind === "failure" ? "JSON with root and descendants notice/stop brief slots" : "JSON with root and descendants stop brief slots")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries and authorization refresh")
      .option("--config <file>", "Protected machine profile", config)
      .action(async (options: FailureOptions) => { console.log(JSON.stringify(await requestFailure(options, kind))); });
    program.command(`${kind}-status`).description(`Read a ${kind} request's state without renewing authority or advancing work.`)
      .requiredOption("--request-file <file>", `The original protected ${kind} retry journal`)
      .option("--config <file>", "Protected machine profile", config)
      .action(async (options: Pick<FailureOptions, "config" | "requestFile">) => { console.log(JSON.stringify(await failureStatus(options, kind))); });
  }
}
