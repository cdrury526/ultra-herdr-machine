import { z } from "zod";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { verifyEnvelope, messageArtifactId } from "@ultra-herdr/api";
import { saveArtifact, ReceiveError } from "./artifact";
const identity = z.string().min(1).max(256), positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const exchange = z.object({ deploymentId: identity, deliveryId: identity, generation: positive, messageId: identity,
  canonical: z.string().max(1048576), artifactId: hash, digest: hash, byteLength: positive,
  bindingEpoch: positive, alreadyReceived: z.boolean() }).strict();
const receipt = z.object({ receiptId: identity, artifactId: hash,
  receivedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
export interface Confirmation {
  requestId: string; deliveryId: string; generation: number; bindingEpoch: number;
  artifactId: string; digest: string; byteLength: number;
}
export interface ReceiveTransport {
  exchange(): Promise<unknown>;
  confirm(input: Confirmation): Promise<unknown>;
}
/** Thin client sequencing only. Transport owns authenticated calls; the backend owns all receipt effects. */
export async function receiveMessage(transport: ReceiveTransport, directory: string,
  caller: { sessionId: string; bindingEpoch: number }) {
  try {
    const value = exchange.parse(await transport.exchange());
    const envelope = await verifyEnvelope(value.canonical);
    if (envelope.messageId !== value.messageId || envelope.digest !== value.digest || envelope.byteLength !== value.byteLength ||
        envelope.recipient.kind !== "session" || envelope.recipient.id !== caller.sessionId || value.bindingEpoch !== caller.bindingEpoch ||
        await messageArtifactId(value.deploymentId, envelope) !== value.artifactId) throw new ReceiveError();
    const path = await saveArtifact(directory, value.deploymentId, value.artifactId, envelope);
    const input = { deliveryId: value.deliveryId, generation: value.generation, bindingEpoch: value.bindingEpoch,
      artifactId: value.artifactId, digest: value.digest, byteLength: value.byteLength };
    // Stable across process interruptions, with no ticket/body journal. A changed binding/generation is a new attempt.
    const requestId = createHash("sha256").update(canonicalize(["ultra-herdr-receive-confirm", 1, input])!).digest("hex");
    const confirmed = receipt.parse(await transport.confirm({ ...input, requestId }));
    if (confirmed.artifactId !== value.artifactId) throw new ReceiveError();
    return { path, envelope, ...confirmed };
  } catch { throw new ReceiveError(); }
}
