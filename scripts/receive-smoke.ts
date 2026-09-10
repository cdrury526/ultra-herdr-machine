import { strictEqual, deepStrictEqual, rejects } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sealEnvelope, messageArtifactId, verifyEnvelope } from "@ultra-herdr/api";
import { receiveMessage, type Confirmation } from "../src/receive/transaction";
import { ReceiveError } from "../src/receive/artifact";
const root = mkdtempSync(join(tmpdir(), "ultra-receive-smoke-"));
let checks = 0;
const equal = (actual: unknown, expected: unknown) => { deepStrictEqual(actual, expected); checks++; };
async function reject(call: () => Promise<unknown>) {
  await rejects(call, e => e instanceof ReceiveError && !e.message.includes(root)); checks++;
}
try {
  const envelope = await sealEnvelope({ protocolVersion: 4, messageId: "message-1", taskId: "task-1", taskEventSequence: 1,
    assignmentRevision: 1, assignmentEpoch: 1, ownerEpoch: 1, sender: { kind: "session", id: "manager" },
    recipient: { kind: "session", id: "worker" }, createdAt: 1000, catalogReleaseId: "release",
    templateKey: "assignment", templateRevision: 1, slotSchemaRevision: 1, payloadSchemaRevision: 1,
    composition: { selected: [], reasons: [] }, payload: { text: "message é😀" }, readableContent: "message é😀",
    digestAlgorithm: "sha256", digestEncodingRevision: 1, kind: "assignment",
    context: { timing: { allowanceMs: 1000, spentMs: 0, clockGeneration: 1 }, replyContracts: {} } });
  const artifactId = await messageArtifactId("deployment", envelope);
  const value = { deploymentId: "deployment", deliveryId: "delivery", generation: 1, messageId: envelope.messageId,
    canonical: JSON.stringify(envelope), artifactId, digest: envelope.digest, byteLength: envelope.byteLength,
    bindingEpoch: 1, alreadyReceived: false };
  const caller = { sessionId: "worker", bindingEpoch: 1 }, directory = join(root, "messages");
  const requests: Confirmation[] = []; let committed = false, effects = 0, mode = "before";
  const transport = { exchange: async () => value, confirm: async (input: Confirmation) => {
    requests.push(input);
    // Confirmation is never attempted until a complete, protected, verified artifact exists.
    const path = join(directory, `${artifactId}.json`);
    strictEqual(statSync(path).mode & 0o777, 0o600);
    deepStrictEqual(await verifyEnvelope(readFileSync(path, "utf8")), envelope);
    if (mode === "before") throw new Error("Interrupted before server commit");
    if (!committed) { committed = true; effects++; }
    if (mode === "after") throw new Error("Lost response after server commit");
    return { receiptId: "receipt", artifactId, receivedAt: 2000 };
  } };
  await reject(() => receiveMessage(transport, directory, caller));
  equal(effects, 0); equal(readdirSync(directory), [`${artifactId}.json`]);
  mode = "after"; await reject(() => receiveMessage(transport, directory, caller)); equal(effects, 1);
  mode = "ok";
  const [first, second] = await Promise.all([receiveMessage(transport, directory, caller), receiveMessage(transport, directory, caller)]);
  equal(first, second); equal(first.envelope, envelope); equal(effects, 1);
  equal(new Set(requests.map(x => x.requestId)).size, 1);
  equal(readdirSync(directory), [`${artifactId}.json`]); equal(statSync(directory).mode & 0o777, 0o700);
  value.generation++; await receiveMessage(transport, directory, caller);
  equal(new Set(requests.map(x => x.requestId)).size, 2); equal(effects, 1);
  equal(readdirSync(directory), [`${artifactId}.json`]);
  const count = requests.length;
  for (const patch of [{ canonical: value.canonical.replace("message é😀", "tampered") }, { artifactId: "a".repeat(64) },
    { digest: "b".repeat(64) }, { byteLength: value.byteLength + 1 }, { bindingEpoch: 2 }, { extra: true }])
    await reject(() => receiveMessage({ ...transport, exchange: async () => ({ ...value, ...patch }) }, directory, caller));
  await reject(() => receiveMessage(transport, directory, { ...caller, sessionId: "other" }));
  equal(requests.length, count);
  const file = first.path;
  writeFileSync(file, "corrupt"); await reject(() => receiveMessage(transport, directory, caller)); equal(readFileSync(file, "utf8"), "corrupt");
  rmSync(file); symlinkSync(join(root, "absent"), file);
  await reject(() => receiveMessage(transport, directory, caller)); rmSync(file);
  writeFileSync(file, JSON.stringify(envelope) + "\n", { mode: 0o644 });
  await reject(() => receiveMessage(transport, directory, caller)); chmodSync(file, 0o600);
  chmodSync(directory, 0o755); await reject(() => receiveMessage(transport, directory, caller)); chmodSync(directory, 0o700);
  const alias = join(root, "alias"); symlinkSync(directory, alias);
  await reject(() => receiveMessage(transport, alias, caller));
  rmSync(file); mkdirSync(file, { mode: 0o700 }); await reject(() => receiveMessage(transport, directory, caller));
  equal(requests.length, count);
  equal(readdirSync(directory), [`${artifactId}.json`]);
  console.log(`Receive artifact smoke passed (${checks} checks). Transport interruption is simulated; no public endpoint or CLI acceptance claimed.`);
} finally { rmSync(root, { recursive: true, force: true }); }
