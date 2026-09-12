import type { Command } from "commander";
import { defaultMachineConfig } from "../auth/default";
import { dispatch } from "../dispatch/client";
import { addAutoRequestFileOption, addDocumentInputOptions, resolveDocumentInput, resolveRequestFile } from "./mutationOptions";

export function addDispatchCommand(program: Command) {
  const cmd = program.command("dispatch").description("Accept a typed assignment and start its durable worker orchestration.");
  addDocumentInputOptions(cmd, "JSON briefKey, launchProfileKey, workingDirectory, values and bundleValues; optional retained session/parent task");
  addAutoRequestFileOption(cmd);
  cmd.option("--config <file>", "Protected machine profile", defaultMachineConfig())
    .action(async options => {
      const input = resolveDocumentInput("dispatch", options);
      const requestFile = resolveRequestFile("dispatch", options.requestFile);
      console.log(JSON.stringify(await dispatch({ config: options.config, input, requestFile })));
    });
}
