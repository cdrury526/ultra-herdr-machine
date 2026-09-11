import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestRelease, releaseState, releaseStatus } from "../release/client";
export function addReleaseCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  program.command("release").description("Request routine release of an idle owned worker; closing awaits machine confirmation.")
    .requiredOption("--input <file>", "Typed JSON: taskId, expectedOwnerEpoch, expectedAssignmentEpoch, expectedBindingEpoch, reason, briefKey, values, bundleValues; omit requestId")
    .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await requestRelease(options))); });
  program.command("release-state").description("Read owner-scoped session epochs and release state; acceptance rechecks eligibility.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await releaseState(options))); });
  program.command("release-status").description("Read an accepted release request; this does not execute a pane close.")
    .requiredOption("--request-id <id>", "Request identity returned by release or stored in its retry journal")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await releaseStatus(options))); });
}
