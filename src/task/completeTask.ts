import { resolve } from "node:path";
import { reviewResultSchemas } from "@ultra-herdr/api";
import { reviewState, sendReview } from "../review/client";
import { scaffoldComplete } from "./scaffold";
import { writeEphemeralInput } from "./writeInput";

export async function completeByTask(options: { config: string; task: string; summary?: string; requestFile: string }) {
  const state = reviewResultSchemas.state.parse(await reviewState({ config: resolve(options.config), task: options.task }));
  const input = scaffoldComplete(state, options.summary ?? "Task completed.");
  const inputPath = writeEphemeralInput("complete", input);
  return sendReview("complete", { config: options.config, input: inputPath, requestFile: options.requestFile });
}
