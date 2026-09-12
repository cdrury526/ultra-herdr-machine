import type { ConvexClient } from "convex/browser";
import { contextApi as api, contextResultSchemas } from "@ultra-herdr/api";
import type { MachineObservation } from "../herdr/observations";
export async function answerCaller(client: ConvexClient, fence: { runtimeEpoch: number; recoveryEpoch: number },
  requestId: string, observation: MachineObservation, discoveryId: string) {
  const snapshotId = crypto.randomUUID();
  const terminals = observation.terminals.map(t => ({ ...t, discoveryProfileId: discoveryId }));
  let offset = 0;
  do {
    const page: typeof terminals = [];
    while (offset + page.length < terminals.length && page.length < 128) {
      const next = terminals[offset + page.length];
      if (Buffer.byteLength(JSON.stringify([...page, next])) > 60 * 1024) break;
      page.push(next);
    }
    if (!page.length && offset < terminals.length) throw new Error("Caller observation exceeds page bound.");
    const done = offset + page.length === terminals.length;
    const args = { ...fence, verificationRequestId: requestId, snapshotId, offset, done, terminals: page };
    // Repeat only the same read-only observation page after an ambiguous response.
    let reply;
    try { reply = await client.mutation(api.acceptCallerPage, args); }
    catch { reply = await client.mutation(api.acceptCallerPage, args); }
    contextResultSchemas.acceptCallerPage.parse(reply);
    offset += page.length;
    if (done) return;
  } while (offset < terminals.length);
}
