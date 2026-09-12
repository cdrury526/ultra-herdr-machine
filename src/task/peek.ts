import { resolve } from "node:path";
import { parseJson, receiveApi, receiveResultSchemas } from "@ultra-herdr/api";
import { clientFor, loadProfile } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { reportLimits } from "../reports/input";

export type TicketAnchor = {
  taskId: string; messageId: string; kind: string; deliveryId: string; generation: number;
  alreadyReceived: boolean; digest: string;
};

const ticketPattern = /^ht1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{43}$/;

/** Read-only ticket metadata via exchange; does not confirm receipt. */
export async function peekTicket(configPath: string, ticket: string): Promise<TicketAnchor> {
  if (!ticketPattern.test(ticket)) throw new Error("Invalid ticket syntax.");
  const config = resolve(configPath), profile = await loadProfile(config, "machine");
  const caller = await resolveCaller(config);
  if (caller.machineId !== profile.machineId) throw new Error("Machine profile changed during verification; retry.");
  const client = clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  const exchanged = receiveResultSchemas.exchange.parse(await client.query(receiveApi.exchange,
    { verificationId: caller.verificationRequestId, ticket }));
  const envelope = parseJson(exchanged.canonical, reportLimits, "task.context") as { taskId?: string; kind?: string };
  if (!envelope?.taskId || typeof envelope.kind !== "string") throw new Error("Ticket exchange returned no task anchor.");
  return { taskId: envelope.taskId, messageId: exchanged.messageId, kind: envelope.kind, deliveryId: exchanged.deliveryId,
    generation: exchanged.generation, alreadyReceived: exchanged.alreadyReceived, digest: exchanged.digest };
}

export async function peekDelivery(configPath: string, deliveryId: string, generation: number): Promise<TicketAnchor & { ticket: string }> {
  const config = resolve(configPath), profile = await loadProfile(config, "machine");
  const caller = await resolveCaller(config);
  const client = clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }));
  const { ticket } = receiveResultSchemas.resolve.parse(await client.query(receiveApi.resolve,
    { verificationId: caller.verificationRequestId, deliveryId, generation }));
  return { ...(await peekTicket(config, ticket)), ticket };
}
