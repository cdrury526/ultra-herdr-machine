import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { requestFailure, failureStatus, type FailureOptions } from "../failure/client";
import { addAutoRequestFileOption, addDocumentInputOptions, resolveDocumentInput, resolveRequestFile } from "./mutationOptions";

type FailureCliOptions = FailureOptions & { data?: string; dataFile?: string; requestFile?: string };

export function addFailureCommands(program: Command) {
  const config = defaultMachineConfig();
  for (const kind of ["failure", "stop"] as const) for (const operator of [false, true]) {
    const request = program.command(`${operator ? "operator-" : ""}${kind === "failure" ? "fail" : "stop"}`)
      .description(kind === "failure" ? "Request parent-owned task failure and descendant disposition. Preparing is not accepted failure."
        : "Request cooperative subtree stop. Acceptance blocks delegation; receipt pauses execution. Tasks and sessions remain retained.")
      .requiredOption("--task <id>", operator ? "Task currently owned by this operator" : "Task owned by this parent session")
      .requiredOption("--owner-epoch <number>", "Expected task owner epoch")
      .requiredOption("--revision <number>", "Expected assignment revision");
    addDocumentInputOptions(request, kind === "failure" ? "JSON with root and descendants notice/stop brief slots" : "JSON with root and descendants stop brief slots");
    addAutoRequestFileOption(request);
    request.action(async (options: FailureCliOptions) => {
      const input = resolveDocumentInput(kind, options);
      const requestFile = resolveRequestFile(kind, options.requestFile);
      console.log(JSON.stringify(await requestFailure({ ...options, input, requestFile }, kind)));
    });
    if (operator) request.requiredOption("--operator-profile <file>", "Explicit current operator owner");
    else request.option("--config <file>", "Protected machine profile", config);
    const status = program.command(`${operator ? "operator-" : ""}${kind}-status`).description(`Read a ${kind} request's state without renewing authority or advancing work.`)
      .requiredOption("--request-file <file>", `The original protected ${kind} retry journal`);
    if (operator) status.requiredOption("--operator-profile <file>", "Explicit operator profile");
    else status.option("--config <file>", "Protected machine profile", config);
    status.action(async (options: Pick<FailureOptions, "config" | "operatorProfile" | "requestFile">) => {
      console.log(JSON.stringify(await failureStatus(options, kind)));
    });
  }
}
