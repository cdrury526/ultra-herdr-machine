import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeLocked, withCredentialLock } from "../auth/storage";
import { runtimeApi, runtimeResultSchemas } from "@ultra-herdr/api";
import { clientFor, machineProfileSchema } from "../auth/client";
import { readStableProcess } from "../context/linux";
import { withVerifiedHerdr } from "../herdr/verified-connection";
import { installation, protectedDirectory, sessionGuard } from "./config";
import { observe, processOwner } from "./observation";
import { runtimeLock } from "./lock";
const id = z.string().min(1), epoch = z.number().int().positive();
const processRef = z.object({ pid: epoch, startIdentity: id }).strict();
const runtimeRef = z.object({ instanceId: id, registration: z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }), z.object({ state: z.literal("registered"), epoch }),
]) }).strict();
export const reservationSchema = z.object({ version: z.literal(1), generation: epoch, recordGeneration: epoch,
  deploymentId: id, machineId: id, enrolledSession: id, serverBindingId: id,
  serverProcess: processRef, launchAttemptId: id, launchNonce: id, createdAt: z.number(),
  state: z.enum(["reserved", "open_intent", "pane_observed", "runtime_observed", "uncertain", "retired"]),
  paneId: id.optional(), runtime: runtimeRef.optional(), observation: z.object({ observationId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict().superRefine((r, ctx) => {
  if ((r.state === "pane_observed" && !r.paneId) ||
      (r.state === "runtime_observed" && (!r.paneId || !r.runtime || !r.observation)) ||
      (["uncertain", "retired"].includes(r.state) && !r.observation))
    ctx.addIssue({ code: "custom", message: "Startup state is missing its required evidence." });
});
export const ackSchema = z.object({ version: z.literal(1), recordGeneration: epoch, launchAttemptId: id, launchNonce: id,
  reservationGeneration: epoch, serverBindingId: id, runtime: runtimeRef, process: processRef,
  paneId: id, terminalId: id, recordedAt: z.number() }).strict();
export type StartupAck = z.infer<typeof ackSchema>;
export function ackPath(directory: string, attempt: string) {
  if (!/^[0-9a-f-]{36}$/.test(attempt)) throw new Error("Invalid startup attempt.");
  return join(protectedDirectory(join(directory, "startup-acks")), `${attempt}.json`);
}
export function matchingAck(a: StartupAck, r: z.infer<typeof reservationSchema>) {
  return a.launchAttemptId === r.launchAttemptId && a.launchNonce === r.launchNonce && a.reservationGeneration === r.generation;
}
function alive(p: { pid: number; startIdentity: string }) {
  try { return readStableProcess(p.pid).startIdentity === p.startIdentity; } catch { return false; }
}
export async function ensureRuntime(directory: string) {
  const i = installation(directory);
  if (!sessionGuard(i)) return { state: "other_session", installation: "installed" };
  const profile = machineProfileSchema.parse(readJson(i.config));
  if (profile.herdrSession !== i.sessionName) throw new Error("Enrollment/session mismatch.");
  const file = join(directory, "startup-reservation.json");
  return withCredentialLock(file, async path => {
    // Reload live setup policy when reachable. Offline startup uses the enrollment's
    // last validated bounds only to establish a local TUI; cloud readiness is separate.
    try {
      const client = clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(i.policy.inspectionTimeoutMs) }));
      i.policy = runtimeResultSchemas.settings.parse(await client.query(runtimeApi.settings, {}));
    } catch { /* A local offline TUI is permitted; this does not grant execution authority. */ }
    let observation = await observe(i);
    let r = existsSync(path) ? reservationSchema.parse(readJson(path)) : undefined;
    if (r && (r.machineId !== profile.machineId || r.deploymentId !== profile.convexUrl || r.enrolledSession !== i.sessionName))
      throw new Error("Startup reservation belongs to another enrollment.");
    const recordObservation = (reason: string) => {
      const observationId = crypto.randomUUID();
      const body = { version: 1, machineId: profile.machineId, launchAttemptId: r!.launchAttemptId,
        generation: r!.generation, recordedAt: Date.now(), reason, server: observation.server };
      const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      writeLocked(join(protectedDirectory(join(directory, "startup-observations")), `${observationId}.json`), body);
      return { observationId, digest };
    };
    if (r?.observation) {
      const body: any = readJson(join(directory, "startup-observations", `${r.observation.observationId}.json`));
      if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== r.observation.digest ||
          body.machineId !== r.machineId || body.launchAttemptId !== r.launchAttemptId || body.generation !== r.generation)
        throw new Error("Startup observation identity/digest mismatch.");
    }
    const save = () => { r!.recordGeneration++; writeLocked(path, reservationSchema.parse(r)); };
    async function running() {
      if (!r) return null;
      const lock = runtimeLock(join(directory, "runtime.lock"));
      try {
        if (lock.held) return null;
        const file = ackPath(directory, r.launchAttemptId);
        if (!existsSync(file)) return null;
        const a = ackSchema.parse(readJson(file));
        if (!matchingAck(a, r) || !lock.heldBy(a.process.pid) || !alive(a.process)) return null;
        observation = await observe(i);
        const actual = processOwner(observation, a.process.pid, a.process.startIdentity);
        if (actual.terminalId !== a.terminalId && observation.server.fingerprint === a.serverBindingId) return null;
        r.paneId = actual.paneId; r.runtime = a.runtime; r.state = "runtime_observed";
        r.observation = recordObservation(`verified-lock-and-process:${a.process.pid}:${a.process.startIdentity}`);
        save(); return { state: "running", paneId: actual.paneId, machineId: profile.machineId, registration: a.runtime.registration.state };
      } finally { lock.close(); }
    }
    const existing = await running(); if (existing) return existing;
    const lock = runtimeLock(join(directory, "runtime.lock"));
    if (!lock.held) { lock.close(); return { state: "blocked", reason: "Runtime lock held without a verified acknowledgement." }; }
    lock.close();
    if (r && r.state !== "retired" && r.state !== "reserved") {
      const ackFile = ackPath(directory, r.launchAttemptId);
      const ack = existsSync(ackFile) ? ackSchema.parse(readJson(ackFile)) : undefined;
      const oldServerGone = !alive(r.serverProcess);
      const terminalGone = ack && matchingAck(ack, r) && !alive(ack.process) &&
        !observation.terminals.some(t => t.terminalId === ack.terminalId);
      // An old server must really be dead; a new socket name alone is not quiescence.
      if (!oldServerGone && !terminalGone) return { state: "blocked", reason: "Prior startup may still exist; preserve it for reconciliation." };
      r.state = "retired"; r.observation = recordObservation(oldServerGone ? "original-server-process-absent" : "acknowledged-runtime-and-terminal-absent"); save();
      writeLocked(join(directory, `startup-retired-${r.launchAttemptId}.json`), r);
    }
    if (!r || r.state === "retired") {
      r = { version: 1, generation: (r?.generation ?? 0) + 1, recordGeneration: (r?.recordGeneration ?? 0) + 1,
        deploymentId: profile.convexUrl, machineId: profile.machineId, enrolledSession: i.sessionName,
        serverBindingId: observation.server.fingerprint, serverProcess: { pid: observation.server.peerPid,
          startIdentity: observation.server.peerStartIdentity }, launchAttemptId: crypto.randomUUID(), launchNonce: crypto.randomUUID(),
        createdAt: Date.now(), state: "reserved" };
      writeLocked(path, r);
    }
    r.state = "open_intent"; save();
    try {
      const result: any = await withVerifiedHerdr({ socketPath: i.socketPath, sessionName: i.sessionName, uid: process.getuid!(),
        timeoutMs: i.policy.inspectionTimeoutMs, maxResponseBytes: i.policy.maxResponseBytes }, async (connection, server) => {
        if (server.fingerprint !== r!.serverBindingId) throw new Error("Server changed before pane open.");
        return connection.openSystemPane({ plugin_id: "ultra-herdr.machine", entrypoint: "agent", placement: "tab", focus: false,
          env: { ULTRA_START_ATTEMPT: r!.launchAttemptId, ULTRA_START_NONCE: r!.launchNonce } });
      });
      r.paneId = z.string().min(1).parse(result.plugin_pane?.pane?.pane_id); r.state = "pane_observed"; save();
    } catch { r.state = "uncertain"; r.observation = recordObservation("pane-open-outcome-unconfirmed"); save(); }
    const deadline = performance.now() + i.policy.ensureWaitMs;
    do {
      const result = await running(); if (result) return result;
      await new Promise(done => setTimeout(done, i.policy.retryIntervalMs));
    } while (performance.now() < deadline);
    return { state: "pending", reason: "Startup acknowledgement not yet verified; retry ensure without reopening." };
  });
}
