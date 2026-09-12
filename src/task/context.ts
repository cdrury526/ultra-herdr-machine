import { resolve } from "node:path";
import { taskContextApi, taskContextResultSchemas } from "@ultra-herdr/api";
import { messageContext } from "../reports/context";

export type TaskAction = { command: string; ready: boolean; reason?: string; argv: string[] };

export async function readTaskContext(options: {
  config: string; task?: string; ticket?: string; delivery?: string; generation?: number; childLimit?: number;
}) {
  const { caller, client } = await messageContext(resolve(options.config));
  if (options.task && options.ticket) throw new Error("Use exactly one of --task, --ticket, or --delivery with --generation.");
  if (options.delivery !== undefined && options.generation === undefined) throw new Error("--delivery requires --generation from inbox metadata.");
  return taskContextResultSchemas.read.parse(await client.query(taskContextApi.read, {
    verificationId: caller.verificationRequestId,
    ...(options.task ? { taskId: options.task } : {}),
    ...(options.ticket ? { ticket: options.ticket } : {}),
    ...(options.delivery !== undefined && options.generation !== undefined
      ? { deliveryId: options.delivery, generation: options.generation } : {}),
    ...(options.childLimit !== undefined ? { childLimit: options.childLimit } : {}),
  }));
}
