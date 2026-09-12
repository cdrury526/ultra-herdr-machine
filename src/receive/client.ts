import { resolve } from "node:path";
import { receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { holdTicket, setCallerHint } from "../context/heldTickets";
import { receiveMessage } from "./transaction";
import { ReceiveError, receiveFailure, receiveStage } from "./errors";
/** No Herdr calls or task state logic. Current caller and authorization are checked by Convex. */
async function receive(configPath: string, input: string | { deliveryId: string; generation: number }) {
  try {
    if (typeof input === "string" && !/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(input)) throw new ReceiveError("input");
    const config = resolve(configPath), profile = await receiveStage("profile", () => loadProfile(config, "machine"));
    if (typeof input === "string") setCallerHint({ ticket: input });
    const caller = await receiveStage("caller", () => resolveCaller(config));
    if (caller.machineId !== profile.machineId) throw new ReceiveError("caller");
    const client = clientFor(profile, (input, init) => {
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
    });
    const ticket = typeof input === "string" ? input : (await receiveStage("resolve-delivery", async () => receiveResultSchemas.resolve.parse(await client.query(receiveApi.resolve, {
      verificationId: caller.verificationRequestId, ...input })))).ticket;
    if (!/^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ReceiveError();
    const authority = { verificationId: caller.verificationRequestId, ticket };
    const received = await receiveMessage({
      exchange: async () => receiveResultSchemas.exchange.parse(await client.query(receiveApi.exchange, authority)),
      confirm: async confirmation => {
        const freshProfile = await receiveStage("profile", () => loadProfile(config, "machine")), fresh = await receiveStage("confirm-caller", () => resolveCaller(config));
        if (freshProfile.convexUrl !== profile.convexUrl || freshProfile.machineId !== profile.machineId || fresh.machineId !== profile.machineId || fresh.sessionId !== caller.sessionId || fresh.bindingEpoch !== caller.bindingEpoch) throw new ReceiveError();
        return receiveResultSchemas.confirm.parse(await clientFor(freshProfile, (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) })).mutation(receiveApi.confirm,
          { ticket, verificationId: fresh.verificationRequestId, confirmation }));
      },
    }, `${config}.messages`, caller);
    const envelope = (received as { envelope?: { kind?: string; taskId?: string } }).envelope;
    if (envelope?.kind && envelope.taskId) holdTicket(config, { kind: envelope.kind, taskId: envelope.taskId }, ticket);
    return received;
  } catch (error) { throw receiveFailure(error, "input"); }
}

export const receiveTicket = (configPath: string, ticket: string) => receive(configPath, ticket);
export const receiveDelivery = (configPath: string, deliveryId: string, generation: number) => receive(configPath, { deliveryId, generation });
