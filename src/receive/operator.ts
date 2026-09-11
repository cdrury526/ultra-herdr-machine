import { resolve } from "node:path";
import { ConvexError } from "convex/values";
import { receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { receiveOperatorMessage } from "./transaction";
import { ReceiveError } from "./artifact";
async function selected(path: string) {
  const config = resolve(path), profile = await loadProfile(config, "operator"), deadline = performance.now() + 20_000;
  const client = clientFor(profile, (input, init) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new ReceiveError();
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(Math.ceil(remaining)) });
  });
  return { config, profile, client };
}
type ListingOptions = { profile: string; cursor?: string; limit?: string };
export const readOperatorInbox = (options: ListingOptions) => readOperatorListing(options, "inbox");
export const readOperatorEscalations = (options: ListingOptions) => readOperatorListing(options, "escalations");
async function readOperatorListing(options: ListingOptions, mode: "inbox" | "escalations") {
  try {
    if (options.limit !== undefined && (!/^[1-9][0-9]*$/.test(options.limit) || !Number.isSafeInteger(Number(options.limit)))) throw new Error();
    const { profile, client } = await selected(options.profile);
    const input = { ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.limit === undefined ? {} : { limit: Number(options.limit) }) };
    const result = mode === "inbox"
      ? receiveResultSchemas.operatorInbox.parse(await client.query(receiveApi.operatorInbox, input))
      : receiveResultSchemas.operatorEscalations.parse(await client.query(receiveApi.operatorEscalations, input));
    if (result.operatorId !== profile.principalId) throw new Error();
    return result;
  } catch (error) {
    if (error instanceof ConvexError && error.data?.code === "STALE_CURSOR") throw new Error("Listing changed. Restart without --cursor.");
    throw new Error("Operator listing read failed. Check the selected profile, inbox.review capability and page size.");
  }
}
export async function receiveOperator(profilePath: string, input: string | { deliveryId: string; generation: number }) {
  try {
    const { config, profile, client } = await selected(profilePath);
    const ticket = typeof input === "string" ? input : receiveResultSchemas.operatorResolve.parse(await client.query(receiveApi.operatorResolve, input)).ticket;
    if (!/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ReceiveError();
    return await receiveOperatorMessage({
      exchange: async () => receiveResultSchemas.operatorExchange.parse(await client.query(receiveApi.operatorExchange, { ticket })),
      confirm: async confirmation => receiveResultSchemas.operatorConfirm.parse(await client.mutation(receiveApi.operatorConfirm, { ticket, confirmation })),
    }, `${config}.messages`, profile.principalId);
  } catch { throw new ReceiveError(); }
}
