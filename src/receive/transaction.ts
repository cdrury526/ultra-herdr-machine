import { z } from "zod";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { verifyEnvelope, messageArtifactId } from "@ultra-herdr/api";
import { saveArtifact, ReceiveError } from "./artifact";
const identity = z.string().min(1).max(256), positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const common = { deploymentId: identity, deliveryId: identity, generation: positive, messageId: identity,
  canonical: z.string().max(1048576), artifactId: hash, digest: hash, byteLength: positive, alreadyReceived: z.boolean() };
const exchange = z.object({ ...common, bindingEpoch: positive }).strict();
const operatorExchange = z.object({ ...common, operatorId: identity }).strict();
const receipt = z.object({ receiptId: identity, artifactId: hash,
  receivedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
interface ConfirmationBase { requestId: string; deliveryId: string; generation: number; artifactId: string; digest: string; byteLength: number }
export interface Confirmation extends ConfirmationBase { bindingEpoch: number }
export interface OperatorConfirmation extends ConfirmationBase { operatorId: string }
export interface ReceiveTransport { exchange(): Promise<unknown>; confirm(input: Confirmation): Promise<unknown> }
export interface OperatorReceiveTransport { exchange(): Promise<unknown>; confirm(input: OperatorConfirmation): Promise<unknown> }
async function artifact(value: z.infer<typeof exchange> | z.infer<typeof operatorExchange>, directory: string,
  recipient: { kind: "session" | "operator"; id: string }) {
  const envelope = await verifyEnvelope(value.canonical);
  if (envelope.messageId !== value.messageId || envelope.digest !== value.digest || envelope.byteLength !== value.byteLength ||
      envelope.recipient.kind !== recipient.kind || envelope.recipient.id !== recipient.id ||
      await messageArtifactId(value.deploymentId, envelope) !== value.artifactId) throw new ReceiveError();
  return { path: await saveArtifact(directory, value.deploymentId, value.artifactId, envelope), envelope };
}
async function finish<T extends ConfirmationBase>(domain: string, input: Omit<T, "requestId">, confirm: (input: T) => Promise<unknown>) {
  const requestId = createHash("sha256").update(canonicalize([domain, 1, input])!).digest("hex");
  const confirmed = receipt.parse(await confirm({ ...input, requestId } as T));
  if (confirmed.artifactId !== input.artifactId) throw new ReceiveError();
  return confirmed;
}
/** Thin client sequencing only. Backend owns authorization and all receipt effects. */
export async function receiveMessage(transport: ReceiveTransport, directory: string, caller: { sessionId: string; bindingEpoch: number }) {
  try {
    const value = exchange.parse(await transport.exchange());
    if (value.bindingEpoch !== caller.bindingEpoch) throw new ReceiveError();
    const saved = await artifact(value, directory, { kind: "session", id: caller.sessionId });
    const confirmed = await finish<Confirmation>("ultra-herdr-receive-confirm", { deliveryId: value.deliveryId,
      generation: value.generation, bindingEpoch: value.bindingEpoch, artifactId: value.artifactId, digest: value.digest, byteLength: value.byteLength },
      input => transport.confirm(input));
    return { ...saved, ...confirmed };
  } catch { throw new ReceiveError(); }
}
/** Operator identity replaces pane binding. Stable requests survive process interruption and credential renewal. */
export async function receiveOperatorMessage(transport: OperatorReceiveTransport, directory: string, operatorId: string) {
  try {
    const value = operatorExchange.parse(await transport.exchange());
    if (value.operatorId !== operatorId) throw new ReceiveError();
    const saved = await artifact(value, directory, { kind: "operator", id: operatorId });
    const confirmed = await finish<OperatorConfirmation>("ultra-herdr-operator-receive-confirm", { operatorId,
      deliveryId: value.deliveryId, generation: value.generation, artifactId: value.artifactId, digest: value.digest, byteLength: value.byteLength },
      input => transport.confirm(input));
    return { ...saved, ...confirmed };
  } catch { throw new ReceiveError(); }
}
