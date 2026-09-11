import { forceRelease } from "../release/force";
import type { Command } from "commander";
import { beginForceReleaseReview, acknowledgeForceReleaseReview, discardForceReleaseReview } from "../release/forceReview";
export function addForceReviewCommands(program: Command, config: string) {
  for (const operator of [false, true]) {
    const prefix = operator ? "operator-force-release-review" : "force-release-review";
    const authenticate = (command: Command) => operator
      ? command.requiredOption("--operator-profile <file>", "Explicit protected operator profile with sessions.forceRelease")
      : command.option("--config <file>", "Protected machine profile", config);
    authenticate(program.command(operator ? "operator-force-release" : "force-release")
      .description("Force release after a completed review, preserving unfinished work and notifying affected participants. A closing result does not confirm physical closure.")
      .requiredOption("--review <id>", "Completed acknowledged review")
      .requiredOption("--input <file>", "JSON reason and typed unavailable/closed notice slots")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse with unchanged input"))
      .action(async options => { console.log(JSON.stringify(await forceRelease(options))); });
    authenticate(program.command(prefix).description("Start/replay an obligation review and display its first page; no release is requested.")
      .requiredOption("--task <id>", "Latest task for the worker session")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for this review"))
      .action(async options => { console.log(JSON.stringify(await beginForceReleaseReview(options))); });
    authenticate(program.command(`${prefix}-ack`).description("Acknowledge the displayed page and return the next page, or reviewed after the final acknowledgement. Restart with a new journal if stale.")
      .requiredOption("--review <id>", "Review identity")
      .requiredOption("--generation <number>", "Generation of the page reviewed")
      .requiredOption("--page-digest <sha256>", "Exact page digest returned with that page"))
      .action(async options => { console.log(JSON.stringify(await acknowledgeForceReleaseReview(options))); });
    authenticate(program.command(`${prefix}-discard`).description("Revoke an unused review and schedule bounded cleanup; accepted release audit evidence remains protected.")
      .requiredOption("--review <id>", "Review identity"))
      .action(async options => { console.log(JSON.stringify(await discardForceReleaseReview(options))); });
  }
}
