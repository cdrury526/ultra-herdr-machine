import { resolve } from "node:path";
import { reviewResultSchemas } from "@ultra-herdr/api";
import { reviewState, sendReview } from "../review/client";
import { scaffoldComplete, scaffoldFeedback } from "./scaffold";
import { writeEphemeralInput } from "./writeInput";

export async function completeByTask(options: { config: string; task: string; summary?: string; requestFile: string }) {
  const state = reviewResultSchemas.state.parse(await reviewState({ config: resolve(options.config), task: options.task }));
  const input = scaffoldComplete(state, options.summary ?? "Task completed.");
  return sendReview("complete", { config: options.config, input: writeEphemeralInput("complete", input), requestFile: options.requestFile });
}

export async function feedbackByTask(options: { config: string; task: string; note: string; requestFile: string }) {
  const state = reviewResultSchemas.state.parse(await reviewState({ config: resolve(options.config), task: options.task }));
  const input = scaffoldFeedback(state, options.note);
  return sendReview("feedback", { config: options.config, input: writeEphemeralInput("feedback", input), requestFile: options.requestFile });
}
