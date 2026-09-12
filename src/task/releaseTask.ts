import { resolve } from "node:path";
import { releaseResultSchemas } from "@ultra-herdr/api";
import { releaseState, requestRelease } from "../release/client";
import { scaffoldRelease } from "./scaffold";
import { writeEphemeralInput } from "./writeInput";

export async function releaseByTask(options: { config: string; task: string; reason?: string; requestFile: string }) {
  const state = releaseResultSchemas.state.parse(await releaseState({ config: resolve(options.config), task: options.task }));
  const input = scaffoldRelease(state, options.reason ?? "Routine release after task completion.");
  const inputPath = writeEphemeralInput("release", input);
  return requestRelease({ config: options.config, input: inputPath, requestFile: options.requestFile });
}
