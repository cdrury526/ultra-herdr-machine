import { resolve } from "node:path";
import { ConvexError } from "convex/values";
import { receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
export async function readInbox(options: { config: string; cursor?: string; limit?: string }) {
  try {
    if (options.limit !== undefined && (!/^[1-9][0-9]*$/.test(options.limit) || !Number.isSafeInteger(Number(options.limit)))) throw new Error();
    const config = resolve(options.config), profile = await loadProfile(config, "machine"), caller = await resolveCaller(config);
    if (caller.machineId !== profile.machineId) throw new Error();
    const client = clientFor(profile, (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
    return receiveResultSchemas.inbox.parse(await client.query(receiveApi.inbox, { verificationId: caller.verificationRequestId,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }), ...(options.limit === undefined ? {} : { limit: Number(options.limit) }) }));
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data && error.data.code === "STALE_CURSOR")
      throw new Error("Inbox changed. Restart the inbox command without --cursor.");
    throw new Error("Inbox read failed. Check the machine profile, current caller authorization and page size. No messages were returned.");
  }
}
