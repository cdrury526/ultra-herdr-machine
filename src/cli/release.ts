import { checkReleaseAuthority, discardReleaseAuthority } from "../release/ancestry";
import { requestOperatorRelease, operatorReleaseState, operatorReleaseStatus } from "../release/operator";
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestRelease, releaseState, releaseStatus } from "../release/client";
export function addReleaseCommands(program: Command) {
  program.command("operator-release").description("Request routine worker release with sessions.forceRelease; outstanding work/replies still prevent release.")
    .requiredOption("--operator-profile <file>", "Explicit protected operator profile")
    .requiredOption("--input <file>", "Typed release input with task, expected epochs, reason and notice brief slots; omit requestId")
    .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
    .action(async options => { console.log(JSON.stringify(await requestOperatorRelease(options))); });
  program.command("operator-release-state").description("Read release epoch metadata using the explicit operator capability.")
    .requiredOption("--operator-profile <file>", "Explicit protected operator profile")
    .requiredOption("--task <id>", "Task whose latest worker assignment is being considered")
    .action(async options => { console.log(JSON.stringify(await operatorReleaseState(options))); });
  program.command("operator-release-status").description("Read this operator's accepted release request; no machine context required.")
    .requiredOption("--operator-profile <file>", "Explicit protected operator profile")
    .requiredOption("--request-id <id>", "Operator's release request identity")
    .action(async options => { console.log(JSON.stringify(await operatorReleaseStatus(options))); });
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  program.command("release-authority").description("Advance one bounded ancestor-verification page; repeat the same journal while searching. Use verified checkId as ancestryCheckId in release input.")
    .requiredOption("--task <id>", "Descendant task")
    .requiredOption("--request-file <file>", "Protected retry journal for this ancestry check")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await checkReleaseAuthority(options))); });
  program.command("release-authority-discard").description("Request bounded disposal of unused ancestry evidence; remaining pages continue automatically. Accepted release audit evidence remains protected.")
    .requiredOption("--check <id>", "Ancestry check identity")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await discardReleaseAuthority(options))); });
  program.command("release").description("Request routine release of an idle owned worker or verified descendant; closing awaits machine confirmation.")
    .requiredOption("--input <file>", "Typed JSON: taskId, expectedOwnerEpoch, expectedAssignmentEpoch, expectedBindingEpoch, reason, briefKey, values, bundleValues; omit requestId")
    .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await requestRelease(options))); });
  program.command("release-state").description("Read owner/verified-ancestor session epochs and release state; acceptance rechecks eligibility.")
    .requiredOption("--task <id>", "Task owned by this parent session or verified descendant")
    .option("--ancestry-check <id>", "Verified ancestry check for descendant release metadata")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await releaseState(options))); });
  program.command("release-status").description("Read an accepted release request; this does not execute a pane close.")
    .requiredOption("--request-id <id>", "Request identity returned by release or stored in its retry journal")
    .option("--config <file>", "Protected machine profile", config)
    .action(async options => { console.log(JSON.stringify(await releaseStatus(options))); });
}
