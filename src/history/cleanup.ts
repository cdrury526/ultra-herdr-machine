import { resolve } from "node:path";
import { ConvexError } from "convex/values";
import { historyApi, historyResultSchemas, jsonDigest } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { reportRequest } from "../reports/journal";
import { reportLimits } from "../reports/input";
type Options = { operatorProfile: string; task?: string; cleanup?: string; reason?: string; early?: boolean; requestFile?: string };
/** Cloud-only disposal. Local receipt artifacts and credentials are never touched. */
export async function cleanupHistory(mode: "begin" | "status" | "resume" | "cancel" | "list", options: Options) {
  try {
    const selected = resolve(options.operatorProfile), profile = await loadProfile(selected, "operator"), client = clientFor(profile);
    if (mode === "begin") {
      if (!options.task || !options.reason?.trim() || !options.requestFile || resolve(options.requestFile) === selected)
        throw new Error("Provide task, reason and a separate protected retry journal.");
      const input = { taskId: options.task, reason: options.reason, early: options.early ?? false };
      const requestId = await reportRequest(resolve(options.requestFile), { deploymentUrl: profile.convexUrl,
        operatorId: profile.principalId, kind: "history_cleanup", inputDigest: (await jsonDigest(input, reportLimits, "history.cleanup")).value });
      return historyResultSchemas.cleanupBegin.parse(await client.mutation(historyApi.cleanupBegin, { ...input, requestId }));
    }
    if (mode === "list") {
      if (!options.task) throw new Error("Provide the task identity.");
      return historyResultSchemas.cleanupList.parse(await client.query(historyApi.cleanupList, { taskId: options.task }));
    }
    if (!options.cleanup) throw new Error("Provide the cleanup identity.");
    const input = { cleanupId: options.cleanup };
    if (mode === "status") return historyResultSchemas.cleanupStatus.parse(await client.query(historyApi.cleanupStatus, input));
    if (mode === "cancel") return historyResultSchemas.cleanupCancel.parse(await client.mutation(historyApi.cleanupCancel, input));
    return historyResultSchemas.cleanupStep.parse(await client.mutation(historyApi.cleanupStep, input));
  } catch (error) {
    const code = error instanceof ConvexError && typeof error.data?.code === "string" && /^[A-Z_]{1,64}$/.test(error.data.code)
      ? error.data.code : "CLEANUP_NOT_CONFIRMED";
    throw new Error(`${code}. Check the operator profile and cleanup inputs. Retry an unchanged request with the same request file, or inspect cleanup status.`);
  }
}
