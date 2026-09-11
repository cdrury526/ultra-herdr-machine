import { historyApi, historyResultSchemas } from "@ultra-herdr/api";
import { ConvexError } from "convex/values";
import { historyConnection, HistoryError, type HistoryScopeOptions } from "./client";
export interface HistoryListOptions extends HistoryScopeOptions { cursor?: string; limit?: string }
/** One bounded metadata page. The message command separately retrieves and verifies bodies. */
export async function listMessageHistory(options: HistoryListOptions) {
  try {
    if (options.limit !== undefined && !/^[1-9][0-9]*$/.test(options.limit)) throw new HistoryError();
    const { client, actor } = await historyConnection(options);
    return historyResultSchemas.list.parse(await client.query(historyApi.list, { actor, taskId: options.task,
      ...(options.ancestryCheck === undefined ? {} : { ancestryCheckId: options.ancestryCheck }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.limit === undefined ? {} : { limit: Number(options.limit) }) }));
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null &&
        "code" in error.data && error.data.code === "STALE_CURSOR")
      throw new Error("History listing changed. Restart the history list command without --cursor.");
    throw new HistoryError();
  }
}
