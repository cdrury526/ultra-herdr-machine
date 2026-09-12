import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { ownershipOperation } from "../ownership/client";
import { addAutoRequestFileOption, addDocumentInputOptions, resolveDocumentInput, resolveRequestFile } from "./mutationOptions";

export function addOwnershipCommands(program: Command) {
  for (const operator of [false, true]) for (const operation of ["handoff", "takeover"] as const) {
    const cmd = program.command(`${operator ? "operator-" : ""}${operation}`)
      .description(operation === "handoff" ? "Offer ownership; control transfers only when the recipient receives the ticket." : "Explicitly assume eligible unavailable supervision; resume bounded preparation internally.");
    addDocumentInputOptions(cmd, "Typed operation, expected epochs and pinned notice selections");
    addAutoRequestFileOption(cmd);
    if (operator) cmd.requiredOption("--operator-profile <file>", "Explicit operator profile with tasks.takeover and inbox.review");
    else cmd.option("--config <file>", "Protected machine profile", defaultMachineConfig());
    cmd.action(async options => {
      const input = resolveDocumentInput(operation, options);
      const requestFile = resolveRequestFile(operation, options.requestFile);
      console.log(JSON.stringify(await ownershipOperation(operation, { ...options, input, requestFile })));
    });
  }
}
