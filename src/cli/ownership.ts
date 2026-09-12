import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { ownershipOperation } from "../ownership/client";
export function addOwnershipCommands(program: Command) {
  for (const operator of [false, true]) for (const operation of ["handoff", "takeover"] as const) {
    const command = program.command(`${operator ? "operator-" : ""}${operation}`)
      .description(operation === "handoff" ? "Offer ownership; control transfers only when the recipient receives the ticket." : "Explicitly assume eligible unavailable supervision; resume bounded preparation internally.")
      .requiredOption("--input <file>", "Typed operation, expected epochs and pinned notice selections")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for the same intent");
    if (operator) command.requiredOption("--operator-profile <file>", "Explicit operator profile with tasks.takeover and inbox.review");
    else command.option("--config <file>", "Protected machine profile", defaultMachineConfig());
    command.action(async options => { console.log(JSON.stringify(await ownershipOperation(operation, options))); });
  }
}
