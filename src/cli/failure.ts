import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestFailure, failureStatus, type FailureOptions } from "../failure/client";
export function addFailureCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  for (const kind of ["failure", "stop"] as const) for (const operator of [false, true]) {
    const request = program.command(`${operator ? "operator-" : ""}${kind === "failure" ? "fail" : "stop"}`)
      .description(kind === "failure" ? "Request parent-owned task failure and descendant disposition. Preparing is not accepted failure."
        : "Request cooperative subtree stop. Acceptance blocks delegation; receipt pauses execution. Tasks and sessions remain retained.")
      .requiredOption("--task <id>", operator ? "Task currently owned by this operator" : "Task owned by this parent session")
      .requiredOption("--owner-epoch <number>", "Expected task owner epoch")
      .requiredOption("--revision <number>", "Expected assignment revision")
      .requiredOption("--input <file>", kind === "failure" ? "JSON with root and descendants notice/stop brief slots" : "JSON with root and descendants stop brief slots")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries and authorization refresh")
      .action(async (options: FailureOptions) => { console.log(JSON.stringify(await requestFailure(options, kind))); });
    if (operator) request.requiredOption("--operator-profile <file>", "Explicit current operator owner");
    else request.option("--config <file>", "Protected machine profile", config);
    const status = program.command(`${operator ? "operator-" : ""}${kind}-status`).description(`Read a ${kind} request's state without renewing authority or advancing work.`)
      .requiredOption("--request-file <file>", `The original protected ${kind} retry journal`)
      .action(async (options: Pick<FailureOptions, "config" | "operatorProfile" | "requestFile">) => { console.log(JSON.stringify(await failureStatus(options, kind))); });
    if (operator) status.requiredOption("--operator-profile <file>", "Explicit operator profile");
    else status.option("--config <file>", "Protected machine profile", config);
  }
}
