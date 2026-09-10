/** Developer-only Phase 02 driver. Finite lived; not the shipped command inbox/runtime. */
import { resolve } from "node:path";
import { z } from "zod";
import { authApi, contextApi as api, contextResultSchemas as result, PROTOCOL_VERSION } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../src/auth/client";
import { readJson, withCredentialLock, writeLocked } from "../src/auth/storage";
import { collectMachineObservation, type MachineObservation } from "../src/herdr/observations";
import { readStableProcess } from "../src/context/linux";
import { ContextError } from "../src/context/errors";

const settingsSchema = z.object({
  config: z.string().min(1), socketPath: z.string().min(1), sessionName: z.string().min(1),
  defaultProfileId: z.string().min(1), terminalProfiles: z.record(z.string(), z.string().min(1)),
  durationMs: z.number().int().min(1000).max(3_600_000),
  pollMs: z.number().int().min(100).max(5000),
  timeoutMs: z.number().int().min(100).max(10_000),
  observationRetryDelayMs: z.number().int().min(10).max(1000),
  maxResponseBytes: z.number().int().min(1024).max(16 * 1024 * 1024),
  maxTerminals: z.number().int().min(1).max(4096),
}).strict();
const settingsFile = resolve(process.argv[2] ?? "");
const settings = () => settingsSchema.parse(readJson(settingsFile));
const initial = settings();
const config = resolve(initial.config);
const statusFile = `${config}.verifier`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

function owned(observation: MachineObservation) {
  const current = readStableProcess(process.pid);
  if (current.pidNamespace !== observation.server.pidNamespace) throw new Error("Namespace mismatch");
  const matches = observation.terminals.filter(t => t.state === "observed" &&
    [t.shell!, ...t.foreground].some(p => p.pid === current.pid && p.startIdentity === current.startIdentity));
  if (matches.length !== 1) throw new Error("Driver must own exactly one observed Herdr terminal");
  return { terminalId: matches[0].terminalId, paneId: matches[0].paneId,
    process: { pid: current.pid, startIdentity: current.startIdentity } };
}

await withCredentialLock(statusFile, async () => {
  const profile = await loadProfile(config, "machine");
  if (profile.herdrSession !== initial.sessionName) throw new Error("Session mismatch");
  const client = clientFor(profile, (input, init) => fetch(input, { ...init,
    redirect: "error", signal: AbortSignal.timeout(10_000) }));
  const deployment = await client.query(authApi.deploymentInfo, {});
  if (deployment.protocolVersion !== PROTOCOL_VERSION) throw new Error("Protocol mismatch");
  const observe = async () => {
    const s = settings();
    if (resolve(s.config) !== config || s.sessionName !== initial.sessionName || s.socketPath !== initial.socketPath)
      throw new Error("Driver identity settings changed");
    const deadline = performance.now() + s.timeoutMs;
    while (true) {
      try {
        return await collectMachineObservation({ socketPath: s.socketPath, sessionName: s.sessionName,
          uid: process.getuid!(), timeoutMs: Math.max(1, Math.floor(deadline - performance.now())), maxResponseBytes: s.maxResponseBytes },
        { maxTerminals: s.maxTerminals, maxForegroundProcesses: 64 });
      } catch (error) {
        // A changing process invalidates that read-only capture, not necessarily the server.
        // Retry a wholly new capture within one deadline; never publish a partial snapshot.
        if (!(error instanceof ContextError) || error.code !== "STALE_BINDING" ||
            deadline - performance.now() <= s.observationRetryDelayMs) throw error;
        await pause(s.observationRetryDelayMs);
      }
    }
  };
  const first = await observe();
  const ownership = owned(first); // No registration/ready claim without real local ownership.
  const current = result.runtimeCurrent.parse(await client.query(api.runtimeCurrent, {}));
  const intent = { runtimeInstanceId: crypto.randomUUID(), requestId: crypto.randomUUID(),
    expectedRuntimeEpoch: current.runtimeEpoch, recoveryEpoch: profile.recoveryEpoch };
  writeLocked(statusFile, { state: "registering", intent, ownership });
  // A lost response retries the persisted intent within this locked process lifetime.
  let fence;
  try { fence = result.registerRuntime.parse(await client.mutation(api.registerRuntime, intent)); }
  catch { fence = result.registerRuntime.parse(await client.mutation(api.registerRuntime, intent)); }
  const until = performance.now() + initial.durationMs;
  let accepted = 0;
  try {
    const reservation = result.beginServerVerification.parse(await client.mutation(api.beginServerVerification,
      { ...fence, requestId: crypto.randomUUID(), expectedServerEpoch: current.serverEpoch }));
    const { fingerprint, ...identity } = (await observe()).server;
    const server = result.finishServerVerification.parse(await client.mutation(api.finishServerVerification,
      { ...fence, verificationId: reservation.verificationId, identity, fingerprint }));
    let nextHeartbeat = 0;
    while (!stopping && performance.now() < until) {
      if (performance.now() >= nextHeartbeat) {
        const observation = await observe();
        if (observation.server.fingerprint !== server.fingerprint) throw new Error("Server changed");
        const actual = owned(observation);
        if (actual.terminalId !== ownership.terminalId || actual.process.startIdentity !== ownership.process.startIdentity)
          throw new Error("Ownership changed");
        const started = performance.now();
        const health = result.reportHealth.parse(await client.mutation(api.reportHealth,
          { ...fence, state: "ready", serverBindingId: server.serverBindingId, ownership: actual }));
        nextHeartbeat = started + health.heartbeatIntervalMs;
        writeLocked(statusFile, { state: "ready", fence, server, ownership: actual, accepted });
      }
      const pending = result.pendingCallers.parse(await client.query(api.pendingCallers, fence));
      for (const request of pending) {
        if (request.serverBindingId !== server.serverBindingId) throw new Error("Request server changed");
        const observation = await observe();
        if (observation.server.fingerprint !== server.fingerprint) throw new Error("Server changed");
        owned(observation);
        const s = settings(), snapshotId = crypto.randomUUID();
        const terminals = observation.terminals.map(t => ({ ...t,
          discoveryProfileId: s.terminalProfiles[t.terminalId] ?? s.defaultProfileId }));
        let offset = 0;
        do {
          const base = { ...fence, verificationRequestId: request.verificationRequestId, snapshotId, offset };
          const page: typeof terminals = [];
          while (offset + page.length < terminals.length && page.length < 128) {
            const next = terminals[offset + page.length];
            if (Buffer.byteLength(JSON.stringify({ ...base, done: false, terminals: [...page, next] })) > 64 * 1024) break;
            page.push(next);
          }
          if (!page.length && offset < terminals.length) throw new Error("Observation exceeds page bound");
          const done = offset + page.length === terminals.length;
          const args = { ...base, done, terminals: page };
          let reply;
          try { reply = result.acceptCallerPage.parse(await client.mutation(api.acceptCallerPage, args)); }
          catch { reply = result.acceptCallerPage.parse(await client.mutation(api.acceptCallerPage, args)); }
          offset += page.length;
          if (done) {
            accepted++;
            console.log(JSON.stringify({ event: "caller.checked", status: reply.status, accepted }));
            break;
          }
        } while (offset < terminals.length);
      }
      await pause(Math.min(settings().pollMs, Math.max(0, until - performance.now())));
    }
  } finally {
    await client.mutation(api.reportHealth, { ...fence, state: "offline" }).catch(() => undefined);
    writeLocked(statusFile, { state: "offline", fence, ownership, accepted });
  }
}).catch(() => {
  // Raw transport/validator errors can include arguments. Keep terminal output secret-safe.
  console.error("Live verifier stopped: check protected configuration, local ownership and current backend state.");
  process.exitCode = 1;
});
