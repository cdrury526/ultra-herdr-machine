import { resolve } from "node:path";
import { reviewResultSchemas } from "@ultra-herdr/api";
import { budgetState, reviewState, sendReview } from "../review/client";
import { readReportFile } from "../reports/input";
import { loadAssignmentPayload } from "./resolveAssignment";
import { mergeReviewSlots, mergeRevisionPayload } from "./reviewData";
import { scaffoldComplete, scaffoldExtend, scaffoldFeedback, scaffoldResume, scaffoldRevise } from "./scaffold";
import { writeEphemeralInput } from "./writeInput";

type TaskReviewOptions = { config: string; task: string; requestFile: string; data?: string; dataFile?: string };

async function reviewStateFor(config: string, task: string) {
  return reviewResultSchemas.state.parse(await reviewState({ config: resolve(config), task }));
}

function optionalDataRaw(options: TaskReviewOptions) {
  const modes = [options.data, options.dataFile].filter(v => v !== undefined && v !== "").length;
  if (modes > 1) throw new Error("Provide at most one of --data or --data-file.");
  return options.data ?? (options.dataFile ? readReportFile(resolve(options.dataFile)) : undefined);
}

export async function completeByTask(options: { config: string; task: string; summary?: string; requestFile: string }) {
  const state = await reviewStateFor(options.config, options.task);
  const input = scaffoldComplete(state, options.summary ?? "Task completed.");
  return sendReview("complete", { config: options.config, input: writeEphemeralInput("complete", input), requestFile: options.requestFile });
}

export async function feedbackByTask(options: { config: string; task: string; note: string; requestFile: string }) {
  const state = await reviewStateFor(options.config, options.task);
  const input = scaffoldFeedback(state, options.note);
  return sendReview("feedback", { config: options.config, input: writeEphemeralInput("feedback", input), requestFile: options.requestFile });
}

export async function reviseByTask(options: TaskReviewOptions & { reason: string }) {
  const state = await reviewStateFor(options.config, options.task);
  const payload = mergeRevisionPayload(await loadAssignmentPayload(options.config, options.task), options.reason, optionalDataRaw(options));
  const input = mergeReviewSlots(scaffoldRevise(state, payload, options.reason), optionalDataRaw(options));
  return sendReview("revise", { config: options.config, input: writeEphemeralInput("revise", input), requestFile: options.requestFile });
}

export async function extendByTask(options: TaskReviewOptions & { allowanceMs: number; reason: string }) {
  const state = await reviewStateFor(options.config, options.task);
  const input = mergeReviewSlots(scaffoldExtend(state, options.allowanceMs, options.reason), optionalDataRaw(options));
  return sendReview("extend", { config: options.config, input: writeEphemeralInput("extend", input), requestFile: options.requestFile });
}

export async function resumeByTask(options: TaskReviewOptions & { reason: string }) {
  const state = await reviewStateFor(options.config, options.task);
  const input = mergeReviewSlots(scaffoldResume(state, options.reason), optionalDataRaw(options));
  return sendReview("resume", { config: options.config, input: writeEphemeralInput("resume", input), requestFile: options.requestFile });
}

export async function defaultExtensionMs(config: string, task: string) {
  const budget = reviewResultSchemas.budget.parse(await budgetState({ config: resolve(config), task }));
  return budget.bounds.minimumExtensionMs;
}
