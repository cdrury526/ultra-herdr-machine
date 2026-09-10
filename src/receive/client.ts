import { resolve } from "node:path";
import { receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { receiveMessage } from "./transaction";
import { ReceiveError } from "./artifact";
/** No Herdr calls or task state logic. Current caller and authorization are checked by Convex. */
export async function receiveTicket(configPath: string, ticket: string) {
  try {
    if (!/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ReceiveError();
    const config = resolve(configPath), profile = await loadProfile(config, "machine");
    const caller = await resolveCaller(config);
    if (caller.machineId !== profile.machineId) throw new ReceiveError();
    const deadline = performance.now() + 20_000;
    const client = clientFor(profile, (input, init) => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new ReceiveError();
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(Math.ceil(remaining)) });
    });
    const authority = { verificationId: caller.verificationRequestId, ticket };
    return await receiveMessage({
      exchange: async () => receiveResultSchemas.exchange.parse(await client.query(receiveApi.exchange, authority)),
      confirm: async confirmation => receiveResultSchemas.confirm.parse(await client.mutation(receiveApi.confirm, { ...authority, confirmation })),
    }, `${config}.messages`, caller);
  } catch { throw new ReceiveError(); }
}
