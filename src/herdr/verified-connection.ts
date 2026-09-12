import { lstatSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { ContextError } from "../context/errors";
import { localLifetime, readStableProcess } from "../context/linux";
import { LinuxSocket } from "./linux-socket";

export interface VerificationTarget {
  socketPath: string;
  sessionName: string;
  uid: number;
  timeoutMs: number;
  maxResponseBytes: number;
}
const pongSchema = z.object({ type: z.literal("pong"), version: z.literal("0.9.0"), protocol: z.literal(22) });
const responseSchema = z.object({ id: z.string(), result: z.unknown().optional(), error: z.unknown().optional() });
function stale(): never { throw new ContextError("STALE_BINDING", "Herdr server identity changed or is unavailable; reverify the enrolled session."); }
function socketIdentity(target: VerificationTarget) {
  let stat;
  try { stat = lstatSync(target.socketPath, { bigint: true }); } catch { stale(); }
  if (!stat.isSocket() || stat.uid !== BigInt(target.uid) || (stat.mode & 0o022n) !== 0n) stale();
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}
/** Runtime/setup component only. Task CLI modules must not import this transport. */
export async function withVerifiedHerdr<T>(target: VerificationTarget,
  operation: (connection: { read: (method: "session.snapshot" | "pane.process_info", paneId?: string) => Promise<unknown>; openSystemPane: (params: { plugin_id: string; entrypoint: string; placement: "tab"; focus: false; env: Record<string, string> }) => Promise<unknown> },
    server: ServerObservation) => Promise<T>) {
  if (!Number.isSafeInteger(target.uid) || target.uid !== process.getuid?.() ||
      !target.sessionName || target.sessionName.length > 128 ||
      !Number.isSafeInteger(target.timeoutMs) || target.timeoutMs < 1 || target.timeoutMs > 30_000 ||
      !Number.isSafeInteger(target.maxResponseBytes) || target.maxResponseBytes < 1024 || target.maxResponseBytes > 16 * 1024 * 1024) {
    throw new ContextError("UNSUPPORTED_CONTEXT", "Enrolled Herdr verification settings are invalid.");
  }
  const deadline = performance.now() + target.timeoutMs;
  const lifetime = localLifetime(), socket = socketIdentity(target);
  const connection = await LinuxSocket.connect(target.socketPath, deadline);
  try {
    const peer = connection.peer();
    if (peer.uid !== target.uid) stale();
    const process = readStableProcess(peer.pid);
    if (process.pidNamespace !== lifetime.pidNamespace) stale();
    function recheck() {
      const now = localLifetime(), path = socketIdentity(target), actual = connection.peer();
      const running = readStableProcess(peer.pid);
      if (now.bootId !== lifetime.bootId || now.pidNamespace !== lifetime.pidNamespace ||
          path.device !== socket.device || path.inode !== socket.inode ||
          actual.pid !== peer.pid || actual.uid !== peer.uid || actual.gid !== peer.gid ||
          running.startIdentity !== process.startIdentity || running.pidNamespace !== process.pidNamespace) stale();
    }
    async function rpc(method: string, params: Record<string, unknown>) {
      recheck();
      const id = randomUUID();
      // Herdr may close after each response. Authenticate each actual RPC connection.
      const requestConnection = await LinuxSocket.connect(target.socketPath, deadline);
      try {
        const actual = requestConnection.peer();
        if (actual.pid !== peer.pid || actual.uid !== peer.uid || actual.gid !== peer.gid) stale();
        recheck();
        const wire = await requestConnection.exchange(JSON.stringify({ id, method, params }) + "\n", deadline, target.maxResponseBytes);
        let response: z.infer<typeof responseSchema>;
        try { response = responseSchema.parse(JSON.parse(wire)); } catch { stale(); }
        if (response.id !== id || response.error !== undefined || response.result === undefined) stale();
        const after = requestConnection.peer();
        if (after.pid !== actual.pid || after.uid !== actual.uid || after.gid !== actual.gid) stale();
        recheck();
        return response.result;
      } finally { requestConnection.close(); }
    }

    const pong = pongSchema.safeParse(await rpc("ping", {}));
    if (!pong.success) throw new ContextError("UNSUPPORTED_CONTEXT", "Herdr version/protocol does not match the supported installation.");
    const observation = { ...lifetime, ...socket, peerUid: peer.uid, peerPid: peer.pid,
      peerStartIdentity: process.startIdentity, sessionName: target.sessionName,
      version: pong.data.version, protocol: pong.data.protocol };
    const server: ServerObservation = { ...observation,
      fingerprint: createHash("sha256").update(JSON.stringify(observation)).digest("hex") };
    let busy = false;
    const result = await operation({ openSystemPane: async params => {
      if (busy || params.plugin_id !== "ultra-herdr.machine" || params.entrypoint !== "agent" || params.focus !== false) stale();
      busy = true; try { return await rpc("plugin.pane.open", params); } finally { busy = false; }
    }, read: async (method, paneId) => {
      if (busy || (method !== "session.snapshot" && method !== "pane.process_info") ||
          (method === "pane.process_info" && (!paneId || paneId.length > 128))) {
        throw new ContextError("UNSUPPORTED_CONTEXT", "Herdr verification requires one explicit read at a time.");
      }
      busy = true;
      try { return await rpc(method, method === "pane.process_info" ? { pane_id: paneId! } : {}); }
      finally { busy = false; }
    } }, server);
    if (busy) stale();
    recheck();
    return result;
  } finally { connection.close(); }
}
export interface ServerObservation {
  bootId: string; pidNamespace: string; device: string; inode: string;
  peerUid: number; peerPid: number; peerStartIdentity: string;
  sessionName: string; version: string; protocol: number; fingerprint: string;
}
