import { collectMachineObservation, type MachineObservation } from "../herdr/observations";
import { readStableProcess } from "../context/linux";
import type { Installation } from "./config";
export function observe(i: Installation) {
  return collectMachineObservation({ socketPath: i.socketPath, sessionName: i.sessionName, uid: process.getuid!(),
    timeoutMs: i.policy.inspectionTimeoutMs, maxResponseBytes: i.policy.maxResponseBytes },
    { maxTerminals: i.policy.maxTerminals, maxForegroundProcesses: 64 });
}
export function processOwner(observation: MachineObservation, pid: number, startIdentity: string) {
  const process = readStableProcess(pid);
  if (process.startIdentity !== startIdentity || process.pidNamespace !== observation.server.pidNamespace)
    throw new Error("Runtime process lifetime changed.");
  const matches = observation.terminals.filter(t => t.state === "observed" &&
    [t.shell, ...t.foreground].some(p => p?.pid === pid && p.startIdentity === startIdentity));
  if (matches.length !== 1) throw new Error("Runtime must own exactly one verified Herdr terminal.");
  return { terminalId: matches[0].terminalId, paneId: matches[0].paneId, process: { pid, startIdentity } };
}
