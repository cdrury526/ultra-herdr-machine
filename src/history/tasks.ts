import { historyApi, historyResultSchemas } from "@ultra-herdr/api";
import { ConvexError } from "convex/values";
import { historyConnection, HistoryError, type HistoryScopeOptions } from "./client";
export interface HierarchyOptions extends HistoryScopeOptions { scope: string; cursor?: string; limit?: string; verificationId?: string }
/** The backend owns lineage, current authority and bounded effective-state reads. */
export async function listTaskHierarchy(options: HierarchyOptions) {
  try {
    if ((options.scope !== "children" && options.scope !== "descendants") || options.releasedSession ||
        (options.limit !== undefined && !/^[1-9][0-9]*$/.test(options.limit))) throw new HistoryError();
    const { client, actor } = await historyConnection(options);
    if (actor.kind === "releasedSession") throw new HistoryError();
    return historyResultSchemas.tasks.parse(await client.query(historyApi.tasks, { actor, taskId: options.task, scope: options.scope,
      ...(options.ancestryCheck === undefined ? {} : { ancestryCheckId: options.ancestryCheck }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.limit === undefined ? {} : { limit: Number(options.limit) }) }));
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null &&
        "code" in error.data && error.data.code === "STALE_CURSOR")
      throw new Error("Hierarchy or authority changed. Restart history tasks without --cursor.");
    throw new HistoryError();
  }
}
