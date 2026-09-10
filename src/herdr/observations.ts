import { z } from "zod";
import { ContextError } from "../context/errors";
import { readStableProcess, matchesProcess, type ProcessIdentity } from "../context/linux";
import { withVerifiedHerdr, type VerificationTarget, type ServerObservation } from "./verified-connection";

const id = z.string().min(1).max(128);
const pid = z.number().int().positive().max(0x7fffffff);
const snapshotSchema = z.object({ type: z.literal("session_snapshot"), snapshot: z.object({
  version: z.literal("0.9.0"), protocol: z.literal(22),
  panes: z.array(z.object({ pane_id: id, terminal_id: id })).max(4096),
}) });
const processSchema = z.object({ type: z.literal("pane_process_info"), process_info: z.object({
  pane_id: id, shell_pid: pid.nullish(), foreground_process_group_id: pid.nullish(),
  foreground_processes: z.array(z.object({ pid })).max(256).optional(),
}) });
export interface ObservationPolicy { maxTerminals: number; maxForegroundProcesses: number }
export interface TerminalObservation {
  terminalId: string; paneId: string; state: "observed" | "unavailable";
  shell?: ProcessIdentity; foreground: ProcessIdentity[];
}
export interface MachineObservation { server: ServerObservation; terminals: TerminalObservation[] }
export interface ObservationReader {
  read(method: "session.snapshot" | "pane.process_info", paneId?: string): Promise<unknown>;
}
function stale(message = "Terminal mapping or processes changed during verification; retry with fresh caller evidence."): never {
  throw new ContextError("STALE_BINDING", message);
}
function snapshot(value: unknown, policy: ObservationPolicy) {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.snapshot.panes.length > policy.maxTerminals) stale("Herdr snapshot is unsupported or exceeds the configured terminal bound.");
  const panes = parsed.data.snapshot.panes;
  if (new Set(panes.map(p => p.pane_id)).size !== panes.length ||
      new Set(panes.map(p => p.terminal_id)).size !== panes.length) stale("Herdr terminal mapping is ambiguous; retry after resolving the local layout.");
  return panes.sort((a, b) => a.terminal_id.localeCompare(b.terminal_id));
}
async function processInfo(reader: ObservationReader, paneId: string, policy: ObservationPolicy) {
  const parsed = processSchema.safeParse(await reader.read("pane.process_info", paneId));
  if (!parsed.success || parsed.data.process_info.pane_id !== paneId) stale();
  const info = parsed.data.process_info;
  if ((info.foreground_processes?.length ?? 0) > policy.maxForegroundProcesses) stale();
  const foreground = info.foreground_processes?.map(p => p.pid).sort((a, b) => a - b);
  if (foreground && new Set(foreground).size !== foreground.length) stale();
  return { shellPid: info.shell_pid ?? null, groupId: info.foreground_process_group_id ?? null, foreground };
}
function identity(processId: number, namespace: string): ProcessIdentity {
  const process = readStableProcess(processId);
  if (process.pidNamespace !== namespace) stale();
  return { pid: process.pid, startIdentity: process.startIdentity };
}
/** Normalize only identity fields; never persist titles, argv, cwd or detected agents. */
export async function observeTerminals(reader: ObservationReader, server: ServerObservation,
  policy: ObservationPolicy): Promise<MachineObservation> {
  if (!Number.isSafeInteger(policy.maxTerminals) || policy.maxTerminals < 1 || policy.maxTerminals > 4096 ||
      !Number.isSafeInteger(policy.maxForegroundProcesses) || policy.maxForegroundProcesses < 1 || policy.maxForegroundProcesses > 256) {
    throw new ContextError("UNSUPPORTED_CONTEXT", "Terminal observation bounds are invalid.");
  }
  const before = snapshot(await reader.read("session.snapshot"), policy);
  const terminals: TerminalObservation[] = [];
  const captured: Awaited<ReturnType<typeof processInfo>>[] = [];
  for (const pane of before) {
    const info = await processInfo(reader, pane.pane_id, policy); captured.push(info);
    const terminal: TerminalObservation = { terminalId: pane.terminal_id, paneId: pane.pane_id, state: "unavailable", foreground: [] };
    if (info.shellPid && info.foreground !== undefined) {
      try {
        terminal.shell = identity(info.shellPid, server.pidNamespace);
        terminal.foreground = info.foreground.map(p => identity(p, server.pidNamespace));
        terminal.state = "observed";
      } catch { delete terminal.shell; terminal.foreground = []; }
    }
    terminals.push(terminal);
  }
  for (let index = 0; index < terminals.length; index++) {
    const terminal = terminals[index];
    const after = await processInfo(reader, terminal.paneId, policy);
    if (JSON.stringify(after) !== JSON.stringify(captured[index])) stale();
    if (terminal.state === "observed" && [terminal.shell!, ...terminal.foreground]
      .some(p => !matchesProcess(p, server.pidNamespace))) stale();
  }
  if (JSON.stringify(snapshot(await reader.read("session.snapshot"), policy)) !== JSON.stringify(before)) stale();
  // Recheck after the final snapshot as well: it is another asynchronous observation.
  for (const terminal of terminals) {
    if (terminal.state === "observed" && [terminal.shell!, ...terminal.foreground]
      .some(p => !matchesProcess(p, server.pidNamespace))) stale();
  }
  return { server, terminals };
}
export function collectMachineObservation(target: VerificationTarget, policy: ObservationPolicy) {
  return withVerifiedHerdr(target, (reader, server) => observeTerminals(reader, server, policy));
}
