import type {Command} from "commander";
import {defaultMachineConfig} from "../auth/default";
import {dispatch} from "../dispatch/client";
export function addDispatchCommand(program:Command){
  program.command("dispatch").description("Accept a typed assignment and start its durable worker orchestration.")
    .requiredOption("--input <file>","JSON briefKey, launchProfileKey, workingDirectory, values and bundleValues; optional retained session/parent task")
    .requiredOption("--request-file <file>","Protected retry journal; reuse unchanged input after interruption")
    .option("--config <file>","Protected machine profile",defaultMachineConfig())
    .action(async options=>console.log(JSON.stringify(await dispatch(options))));
}
