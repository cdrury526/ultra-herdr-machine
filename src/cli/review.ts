import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { sendReview, reviewState, operatorReviewState, budgetState, type ReviewOptions } from "../review/client";
import { completeByTask, extendByTask, feedbackByTask, resumeByTask, reviseByTask } from "../task/reviewByTask";

type ReviewCliOptions = ReviewOptions & {
  task?: string; summary?: string; note?: string; reason?: string; allowanceMs?: string; data?: string; dataFile?: string;
};

function taskModes(options: ReviewCliOptions) {
  return [options.task, options.input, options.data, options.dataFile].filter(v => v !== undefined && v !== "").length;
}

function reviewAction(command: "complete" | "feedback" | "revise" | "extend" | "resume", options: ReviewCliOptions) {
  if (command === "complete" && options.task) {
    if (options.input) throw new Error("Use either --task or --input, not both.");
    return completeByTask({ config: options.config!, task: options.task, summary: options.summary, requestFile: options.requestFile });
  }
  if (command === "feedback" && options.task) {
    if (options.input) throw new Error("Use either --task or --input, not both.");
    if (!options.note) throw new Error("Provide --note when using feedback --task.");
    return feedbackByTask({ config: options.config!, task: options.task, note: options.note, requestFile: options.requestFile });
  }
  if (command === "revise" && options.task) {
    if (taskModes(options) > 2 || options.input) throw new Error("Use --task with --reason and optional --data/--data-file, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using revise --task.");
    return reviseByTask({ config: options.config!, task: options.task, reason: options.reason,
      requestFile: options.requestFile, data: options.data, dataFile: options.dataFile });
  }
  if (command === "extend" && options.task) {
    if (taskModes(options) > 2 || options.input) throw new Error("Use --task with --allowance-ms and --reason, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using extend --task.");
    const allowanceMs = Number(options.allowanceMs);
    if (!Number.isSafeInteger(allowanceMs) || allowanceMs <= 0) throw new Error("Provide a positive --allowance-ms when using extend --task.");
    return extendByTask({ config: options.config!, task: options.task, allowanceMs, reason: options.reason,
      requestFile: options.requestFile, data: options.data, dataFile: options.dataFile });
  }
  if (command === "resume" && options.task) {
    if (taskModes(options) > 2 || options.input) throw new Error("Use --task with --reason and optional --data/--data-file, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using resume --task.");
    return resumeByTask({ config: options.config!, task: options.task, reason: options.reason,
      requestFile: options.requestFile, data: options.data, dataFile: options.dataFile });
  }
  if (!options.input) throw new Error("Provide --input, or use --task scaffolding where available.");
  return sendReview(command, options);
}

function addTaskOptions(cmd: Command, command: "complete" | "feedback" | "revise" | "extend" | "resume") {
  if (command === "complete") {
    cmd.option("--task <id>", "Complete using current review-state scaffolding")
      .option("--summary <text>", "Completion evidence summary when using --task")
      .option("--input <file>", "Typed JSON input including task, expected epochs and brief slots; omit requestId");
  } else if (command === "feedback") {
    cmd.option("--task <id>", "Send feedback using current review-state scaffolding")
      .option("--note <text>", "Feedback text when using --task")
      .option("--input <file>", "Typed JSON input including task, expected epochs and brief slots; omit requestId");
  } else if (command === "revise") {
    cmd.option("--task <id>", "Revise using current assignment payload scaffolding")
      .option("--reason <text>", "changeReason when using --task")
      .option("--data <json>", "Optional assignment payload overrides when using --task")
      .option("--data-file <file>", "Optional assignment payload overrides file when using --task")
      .option("--input <file>", "Typed JSON input including task, expected epochs and brief slots; omit requestId");
  } else if (command === "extend") {
    cmd.option("--task <id>", "Extend allowance using current review-state scaffolding")
      .option("--allowance-ms <ms>", "Positive allowance increment when using --task")
      .option("--reason <text>", "Extension reason when using --task")
      .option("--data <json>", "Optional brief slot overrides when using --task")
      .option("--data-file <file>", "Optional brief slot overrides file when using --task")
      .option("--input <file>", "Typed JSON input including task, expected epochs and brief slots; omit requestId");
  } else {
    cmd.option("--task <id>", "Resume using current stop metadata scaffolding")
      .option("--reason <text>", "Resume reason when using --task")
      .option("--data <json>", "Optional brief slot overrides when using --task")
      .option("--data-file <file>", "Optional brief slot overrides file when using --task")
      .option("--input <file>", "Typed JSON input including task, expected epochs and brief slots; omit requestId");
  }
}

export function addReviewCommands(program: Command) {
  const config = defaultMachineConfig();
  for (const command of ["complete", "feedback", "revise", "extend", "resume"] as const) {
    const cmd = program.command(command).description(command === "complete"
      ? "Accept the current submission as completed; retain the worker session."
      : command === "feedback" ? "Send same-contract corrections; work resumes when the worker receives current feedback."
      : command === "revise" ? "Issue a full pinned assignment revision; one revision may await receipt at a time."
      : command === "resume" ? "Request resume of one acknowledged stopped task; only receipt restarts remaining execution time."
      : "Increase the task allowance within its original limits; never implicitly resume stopped work.")
      .requiredOption("--request-file <file>", "Protected retry journal; reuse for unchanged retries")
      .option("--config <file>", "Protected machine profile", config);
    addTaskOptions(cmd, command);
    cmd.action(async (options: ReviewCliOptions) => {
      console.log(JSON.stringify(await reviewAction(command, options)));
    });
  }
  for (const command of ["complete", "feedback", "revise", "extend", "resume"] as const) {
    program.command(`operator-${command}`).description(`Apply ${command} as the authenticated current operator owner.`)
      .requiredOption("--operator-profile <file>", "Explicit operator profile")
      .requiredOption("--input <file>", "Typed operation and expected epochs; omit requestId")
      .requiredOption("--request-file <file>", "Protected journal; reuse for unchanged retries")
      .action(async (options: ReviewOptions) => { console.log(JSON.stringify(await sendReview(command, options))); });
  }
  program.command("operator-review-state").description("Read review metadata for a task currently owned by this operator.")
    .requiredOption("--operator-profile <file>", "Explicit operator profile")
    .requiredOption("--task <id>", "Task identity")
    .action(async options => { console.log(JSON.stringify(await operatorReviewState(options))); });
  program.command("budget").description("Read a timestamped owner budget snapshot and original extension limits without changing execution.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; task: string }) => { console.log(JSON.stringify(await budgetState(options))); });
  program.command("review-state").description("Read current owner, revision, review and stop/resume metadata without accepting or receiving anything.")
    .requiredOption("--task <id>", "Task owned by this parent session")
    .option("--config <file>", "Protected machine profile", config)
    .action(async (options: { config: string; task: string }) => { console.log(JSON.stringify(await reviewState(options))); });
}
