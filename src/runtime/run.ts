import { ConvexError } from "convex/values";
import { ConvexClient } from "convex/browser";
import { contextApi as api, contextResultSchemas as result, runtimeApi, runtimeResultSchemas } from "@ultra-herdr/api";
import { join } from "node:path";
import { readJson, writeLocked } from "../auth/storage";
import { loadProfile, machineProfileSchema } from "../auth/client";
import { readStableProcess } from "../context/linux";
import { installation, sessionGuard } from "./config";
import { runtimeLock } from "./lock";
import { observe, processOwner } from "./observation";
import { reservationSchema, ackSchema, ackPath, type StartupAck } from "./startup";
import { answerCaller } from "./callers";
export interface RuntimeStatus { machine: string; cloud: string; auth: string; herdr: string; state: string; commands: string; operator: string }
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(done => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); done(); };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish(); else signal.addEventListener("abort", finish, { once: true });
  });
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cloud operation timed out.")), ms); })]); }
  finally { clearTimeout(timer!); }
}
/** Owns state and subscriptions; Ink only renders onStatus. No command execution before target 2. */
export async function runAgent(directory: string, onStatus: (status: RuntimeStatus) => void, signal: AbortSignal) {
  const settings = installation(directory);
  if (!sessionGuard(settings)) throw new Error("Wrong enrolled Herdr session.");
  const lock = runtimeLock(join(directory, "runtime.lock"));
  if (!lock.held) { lock.close(); throw new Error("A system runtime already holds the local lock."); }
  let client: ConvexClient | undefined, fence: { runtimeEpoch: number; recoveryEpoch: number } | undefined;
  let server: { serverBindingId: string; serverEpoch: number; fingerprint: string } | undefined;
  const subscriptions: (() => void)[] = [];
  try {
    const profile = machineProfileSchema.parse(readJson(settings.config));
    const r = reservationSchema.parse(readJson(join(directory, "startup-reservation.json")));
    if (r.machineId !== profile.machineId || r.deploymentId !== profile.convexUrl || r.enrolledSession !== settings.sessionName ||
        r.launchAttemptId !== process.env.ULTRA_START_ATTEMPT || r.launchNonce !== process.env.ULTRA_START_NONCE ||
        !["open_intent", "pane_observed", "uncertain"].includes(r.state)) throw new Error("No matching authorized startup reservation.");
    const self = readStableProcess(process.pid), first = await observe(settings);
    if (first.server.fingerprint !== r.serverBindingId) throw new Error("Startup server changed.");
    let ownership = processOwner(first, self.pid, self.startIdentity);
    let observedServer = first.server.fingerprint;
    const ack: StartupAck = { version: 1, recordGeneration: 1, launchAttemptId: r.launchAttemptId, launchNonce: r.launchNonce,
      reservationGeneration: r.generation, serverBindingId: first.server.fingerprint, runtime: { instanceId: crypto.randomUUID(), registration: { state: "pending" } },
      process: ownership.process, paneId: ownership.paneId, terminalId: ownership.terminalId, recordedAt: Date.now() };
    let savedAck = "";
    const saveAck = () => {
      const content = JSON.stringify({ ...ack, recordGeneration: 0, recordedAt: 0 });
      if (content === savedAck) return;
      ack.recordGeneration++; ack.recordedAt = Date.now();
      writeLocked(ackPath(directory, r.launchAttemptId), ackSchema.parse(ack)); savedAck = content;
    };
    saveAck();
    const status: RuntimeStatus = { machine: `${profile.name}  ${profile.machineId}`, cloud: "connecting", auth: "pending", herdr: "connected", state: "registering", commands: "connecting", operator: "connecting" };
    const publish = () => onStatus({ ...status }); publish();
    client = new ConvexClient(profile.convexUrl.replace(/\/$/, ""), { logger: false });
    client.setAuth(async () => {
      try { const refreshed = await loadProfile(settings.config, "machine"); status.auth = "authenticating"; publish(); return refreshed.token; }
      catch { status.auth = "unavailable"; publish(); return null; }
    }, authenticated => { status.auth = authenticated ? "authenticated" : "unavailable"; publish(); });
    subscriptions.push(client.subscribeToConnectionState(connection => {
      status.cloud = connection.isWebSocketConnected ? "connected" : "disconnected"; publish();
    }));
    let intent: { runtimeInstanceId: string; requestId: string; expectedRuntimeEpoch: number; recoveryEpoch: number } | undefined;
    let serverIntent: { requestId: string; expectedServerEpoch: number } | undefined;
    let pending: { verificationRequestId: string; serverBindingId: string; expiresAt: number }[] = [];
    let subscribed = false, delay = settings.policy.retryIntervalMs;
    while (!signal.aborted) {
      try {
        // Observe locally even when the cloud is offline, retaining a verifiable local TUI acknowledgement.
        const observation = await observe(settings), actual = processOwner(observation, self.pid, self.startIdentity);
        if (actual.terminalId !== ownership.terminalId && observation.server.fingerprint === observedServer) throw new Error("Runtime terminal changed without a server handoff.");
        ownership = actual; observedServer = observation.server.fingerprint; ack.terminalId = actual.terminalId;
        status.herdr = "connected"; ack.paneId = actual.paneId; ack.serverBindingId = observation.server.fingerprint; saveAck();
        settings.policy = runtimeResultSchemas.settings.parse(await bounded(client.query(runtimeApi.settings, {}), settings.policy.inspectionTimeoutMs));
        if (!fence) {
          if (!intent) {
            const current = result.runtimeCurrent.parse(await bounded(client.query(api.runtimeCurrent, {}), settings.policy.inspectionTimeoutMs));
            intent = { runtimeInstanceId: ack.runtime.instanceId, requestId: crypto.randomUUID(), expectedRuntimeEpoch: current.runtimeEpoch, recoveryEpoch: profile.recoveryEpoch };
            writeLocked(join(directory, `registration-${r.launchAttemptId}.json`), intent);
          }
          fence = result.registerRuntime.parse(await bounded(client.mutation(api.registerRuntime, intent), settings.policy.inspectionTimeoutMs));
          ack.runtime.registration = { state: "registered", epoch: fence.runtimeEpoch }; saveAck();
        }
        if (!server || server.fingerprint !== observation.server.fingerprint) {
          if (!serverIntent) {
            const current = result.runtimeCurrent.parse(await bounded(client.query(api.runtimeCurrent, {}), settings.policy.inspectionTimeoutMs));
            serverIntent = { requestId: crypto.randomUUID(), expectedServerEpoch: current.serverEpoch };
          }
          const reservation = result.beginServerVerification.parse(await bounded(client.mutation(api.beginServerVerification, { ...fence, ...serverIntent }), settings.policy.inspectionTimeoutMs));
          const fresh = await observe(settings), { fingerprint, ...identity } = fresh.server;
          processOwner(fresh, self.pid, self.startIdentity);
          server = result.finishServerVerification.parse(await bounded(client.mutation(api.finishServerVerification,
            { ...fence, verificationId: reservation.verificationId, identity, fingerprint }), settings.policy.inspectionTimeoutMs));
          serverIntent = undefined;
        }
        // A handoff between the first capture and binding verification needs a new
        // ownership capture before reporting health against that new server.
        if (server.fingerprint !== observation.server.fingerprint) continue;
        const health = result.reportHealth.parse(await bounded(client.mutation(api.reportHealth,
          { ...fence, state: "ready", serverBindingId: server.serverBindingId, ownership: actual }), settings.policy.inspectionTimeoutMs));
        status.auth = "authenticated";
        delay = health.heartbeatIntervalMs;
        if (!subscribed) {
          const unavailable = () => { status.commands = "unavailable"; status.operator = "unavailable"; publish(); };
          subscriptions.push(client.onUpdate(runtimeApi.inbox, fence, value => {
            const inbox = runtimeResultSchemas.inbox.parse(value);
            status.commands = `${inbox.items.length}${inbox.more ? "+" : ""} pending (execution not installed yet)`; publish();
          }, unavailable));
          subscriptions.push(client.onUpdate(runtimeApi.operatorStatus, fence, value => {
            const inbox = runtimeResultSchemas.operatorStatus.parse(value);
            status.operator = `${inbox.pending}${inbox.partial ? "+ (partial)" : ""} pending, ${inbox.blocked} blocked`; publish();
          }, unavailable));
          subscriptions.push(client.onUpdate(api.pendingCallers, fence, value => { pending = value; }, unavailable));
          subscribed = true;
        }
        for (const request of pending) {
          if (request.expiresAt <= Date.now() || request.serverBindingId !== server.serverBindingId) continue;
          const observation = await observe(settings);
          if (observation.server.fingerprint !== server.fingerprint) break;
          await answerCaller(client, fence, request.verificationRequestId, observation, settings.policy.defaultDiscoveryProfileId);
        }
        status.state = "ready"; publish();
      } catch (error) {
        if (error instanceof ConvexError && error.data && typeof error.data === "object" &&
            "code" in error.data && ["UNAUTHENTICATED", "FORBIDDEN"].includes(String(error.data.code))) status.auth = "unavailable — renew or recover credentials";
        status.state = "blocked — retrying verification";
        try { await observe(settings); } catch { status.herdr = "unavailable"; }
        if (fence) await bounded(client.mutation(api.reportHealth, { ...fence, state: "blocked" }), settings.policy.inspectionTimeoutMs).catch(() => undefined);
        delay = settings.policy.retryIntervalMs; publish();
      }
      await pause(delay, signal);
    }
  } finally {
    subscriptions.forEach(stop => stop());
    if (client && fence) await bounded(client.mutation(api.reportHealth, { ...fence, state: "offline" }), 2000).catch(() => undefined);
    await client?.close(); lock.close();
  }
}
