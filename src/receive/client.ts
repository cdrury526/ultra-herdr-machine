import { resolve } from "node:path";
import { receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { receiveMessage } from "./transaction";
import { ReceiveError } from "./artifact";
/** No Herdr calls or task state logic. Current caller and authorization are checked by Convex. */
async function receive(configPath: string, input: string | { deliveryId: string; generation: number }) {
  try {
    if (typeof input === "string" && !/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(input)) throw new ReceiveError();
    const config = resolve(configPath), profile = await loadProfile(config, "machine");
    const caller = await resolveCaller(config);
    if (caller.machineId !== profile.machineId) throw new ReceiveError();
    const client = clientFor(profile, (input, init) => {
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
    });
    const ticket = typeof input === "string" ? input : receiveResultSchemas.resolve.parse(await client.query(receiveApi.resolve, {
      verificationId: caller.verificationRequestId, ...input })).ticket;
    if (!/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ReceiveError();
    const authority = { verificationId: caller.verificationRequestId, ticket };
    return await receiveMessage({
      exchange: async () => receiveResultSchemas.exchange.parse(await client.query(receiveApi.exchange, authority)),
      confirm: async confirmation => {
        const freshProfile = await loadProfile(config, "machine"), fresh = await resolveCaller(config);
        if (freshProfile.convexUrl !== profile.convexUrl || freshProfile.machineId !== profile.machineId || fresh.machineId !== profile.machineId || fresh.sessionId !== caller.sessionId || fresh.bindingEpoch !== caller.bindingEpoch) throw new ReceiveError();
        return receiveResultSchemas.confirm.parse(await clientFor(freshProfile, (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) })).mutation(receiveApi.confirm,
          { ticket, verificationId: fresh.verificationRequestId, confirmation }));
      },
    }, `${config}.messages`, caller);
  } catch { throw new ReceiveError(); }
}

export const receiveTicket = (configPath: string, ticket: string) => receive(configPath, ticket);
export const receiveDelivery = (configPath: string, deliveryId: string, generation: number) => receive(configPath, { deliveryId, generation });
