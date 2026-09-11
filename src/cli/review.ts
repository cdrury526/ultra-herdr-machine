import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendReview, reviewState, budgetState, type ReviewOptions } from "../review/client";
export function addReviewCommands(program: Command) {
  const config = join(homedir(), ".config", "ultra-herdr", "machine.json");
  for (const command of ["complete", "feedback", "revise", "extend", "resume"] as const) {
    program.command(command).description(command === "complete"
      ? "Accept the current submission as completed; retain the worker session."
      : command === "feedback" ? "Send same-contract corrections; work resumes when the worker receives current feedback."
      : command === "revise" ? "Issue a full pinned assignment revision; one revision may await receipt at a time."
      : command === "resume" ? "Request resume of one acknowledged stopped task; only receipt restarts remaining execution time."
      : "Increase the task allowance within its original limits; never implicitly resume stopped work.")
      .requiredOption("--input <file>", "Typed JSON input including task, expected epochs and brief slots; review commands also require submission; omit requestId")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
      .option("--config <file>", "Protected machine profile", config)
      .action(async (options: ReviewOptions) => { console.log(JSON.stringify(await sendReview(command, options))); });
  }
  program.command("budget").description("Read a timestamped owner budget snapshot and original extension limits without changing execution.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; task: string }) => { console.log(JSON.stringify(await budgetState(options))); });
  program.command("review-state").description("Read current owner, revision, review and stop/resume metadata without accepting or receiving anything.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; task: string }) => { console.log(JSON.stringify(await reviewState(options))); });
}
