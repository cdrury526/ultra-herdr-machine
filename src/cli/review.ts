import { defaultMachineConfig } from "../auth/default";
import type { Command } from "commander";
import { sendReview, reviewState, operatorReviewState, budgetState, type ReviewOptions } from "../review/client";
import { completeByTask, extendByTask, feedbackByTask, resumeByTask, reviseByTask } from "../task/reviewByTask";
import { addAutoRequestFileOption, addDocumentInputOptions, inputModeCount, resolveDocumentInput, resolveRequestFile } from "./mutationOptions";

type ReviewCliOptions = ReviewOptions & {
  task?: string; summary?: string; note?: string; reason?: string; allowanceMs?: string;
  data?: string; dataFile?: string; requestFile?: string;
};

function reviewAction(command: "complete" | "feedback" | "revise" | "extend" | "resume", options: ReviewCliOptions) {
  const requestFile = resolveRequestFile(`review-${command}`, options.requestFile);
  if (command === "complete" && options.task) {
    if (inputModeCount(options) > 0) throw new Error("Use either --task or --input/--data, not both.");
    return completeByTask({ config: options.config!, task: options.task, summary: options.summary, requestFile });
  }
  if (command === "feedback" && options.task) {
    if (inputModeCount(options) > 0) throw new Error("Use either --task or --input/--data, not both.");
    if (!options.note) throw new Error("Provide --note when using feedback --task.");
    return feedbackByTask({ config: options.config!, task: options.task, note: options.note, requestFile });
  }
  if (command === "revise" && options.task) {
    if (options.input) throw new Error("Use --task with --reason and optional --data/--data-file, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using revise --task.");
    return reviseByTask({ config: options.config!, task: options.task, reason: options.reason, requestFile,
      ...(options.data ? { data: options.data } : {}), ...(options.dataFile ? { dataFile: options.dataFile } : {}) });
  }
  if (command === "extend" && options.task) {
    if (options.input) throw new Error("Use --task with --allowance-ms and --reason, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using extend --task.");
    const allowanceMs = Number(options.allowanceMs);
    if (!Number.isSafeInteger(allowanceMs) || allowanceMs <= 0) throw new Error("Provide a positive --allowance-ms when using extend --task.");
    return extendByTask({ config: options.config!, task: options.task, allowanceMs, reason: options.reason, requestFile,
      ...(options.data ? { data: options.data } : {}), ...(options.dataFile ? { dataFile: options.dataFile } : {}) });
  }
  if (command === "resume" && options.task) {
    if (options.input) throw new Error("Use --task with --reason and optional --data/--data-file, not --input.");
    if (!options.reason) throw new Error("Provide --reason when using resume --task.");
    return resumeByTask({ config: options.config!, task: options.task, reason: options.reason, requestFile,
      ...(options.data ? { data: options.data } : {}), ...(options.dataFile ? { dataFile: options.dataFile } : {}) });
  }
  const input = resolveDocumentInput(`review-${command}`, options);
  return sendReview(command, { config: options.config, operatorProfile: options.operatorProfile, input, requestFile });
}

function addTaskOptions(cmd: Command, command: "complete" | "feedback" | "revise" | "extend" | "resume") {
  if (command === "complete") {
    cmd.option("--task <id>", "Complete using current review-state scaffolding")
      .option("--summary <text>", "Completion evidence summary when using --task");
  } else if (command === "feedback") {
    cmd.option("--task <id>", "Send feedback using current review-state scaffolding")
      .option("--note <text>", "Feedback text when using --task");
  } else if (command === "revise") {
    cmd.option("--task <id>", "Revise using current assignment payload scaffolding")
      .option("--reason <text>", "changeReason when using --task");
  } else if (command === "extend") {
    cmd.option("--task <id>", "Extend allowance using current review-state scaffolding")
      .option("--allowance-ms <ms>", "Positive allowance increment when using --task")
      .option("--reason <text>", "Extension reason when using --task");
  } else {
    cmd.option("--task <id>", "Resume using current stop metadata scaffolding")
      .option("--reason <text>", "Resume reason when using --task");
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
      .option("--config <file>", "Protected machine profile", config);
    addDocumentInputOptions(cmd, "Typed JSON input including task, expected epochs and brief slots; omit requestId");
    addAutoRequestFileOption(cmd);
    addTaskOptions(cmd, command);
    cmd.action(async (options: ReviewCliOptions) => {
      console.log(JSON.stringify(await reviewAction(command, options)));
    });
  }
  for (const command of ["complete", "feedback", "revise", "extend", "resume"] as const) {
    const cmd = program.command(`operator-${command}`).description(`Apply ${command} as the authenticated current operator owner.`)
      .requiredOption("--operator-profile <file>", "Explicit operator profile");
    addDocumentInputOptions(cmd, "Typed operation and expected epochs; omit requestId");
    addAutoRequestFileOption(cmd);
    cmd.action(async (options: ReviewCliOptions) => {
      const input = resolveDocumentInput(`operator-${command}`, options);
      const requestFile = resolveRequestFile(`operator-${command}`, options.requestFile);
      console.log(JSON.stringify(await sendReview(command, { operatorProfile: options.operatorProfile, input, requestFile })));
    });
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
