import { readFileSync, readlinkSync } from "node:fs";
import { ContextError } from "./errors";

export interface ProcessIdentity { pid: number; startIdentity: string }
export interface ProcessObservation extends ProcessIdentity { parentPid: number; pidNamespace: string }

function unavailable(): never {
  throw new ContextError("UNSUPPORTED_CONTEXT", "Stable local process identity is unavailable; retry from a supported local session.");
}
export function localLifetime() {
  if (process.platform !== "linux") unavailable();
  try {
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const pidNamespace = readlinkSync("/proc/self/ns/pid");
    if (!/^[a-f0-9-]{36}$/.test(bootId) || !/^pid:\[\d+\]$/.test(pidNamespace)) unavailable();
    return { bootId, pidNamespace };
  } catch { return unavailable(); }
}
function inspect(pid: number): ProcessObservation {
  const value = readFileSync(`/proc/${pid}/stat`, "utf8");
  // comm is parenthesized and may itself contain spaces or parentheses.
  const split = value.lastIndexOf(")");
  if (!value.startsWith(`${pid} (`) || split < 0) unavailable();
  const fields = value.slice(split + 1).trim().split(/\s+/);
  if (fields.length < 20 || ["Z", "X", "x"].includes(fields[0]) ||
      !/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[19])) unavailable();
  const parentPid = Number(fields[1]);
  if (!Number.isSafeInteger(parentPid) || parentPid < 0) unavailable();
  const pidNamespace = readlinkSync(`/proc/${pid}/ns/pid`);
  if (!/^pid:\[\d+\]$/.test(pidNamespace)) unavailable();
  return { pid, parentPid, startIdentity: BigInt(fields[19]).toString(), pidNamespace };
}
export function readStableProcess(pid: number): ProcessObservation {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) unavailable();
  try {
    const first = inspect(pid), second = inspect(pid);
    if (first.startIdentity !== second.startIdentity || first.parentPid !== second.parentPid ||
        first.pidNamespace !== second.pidNamespace) unavailable();
    return first;
  } catch { return unavailable(); }
}
export function matchesProcess(identity: ProcessIdentity, pidNamespace: string) {
  try {
    const current = readStableProcess(identity.pid);
    return current.startIdentity === identity.startIdentity && current.pidNamespace === pidNamespace;
  } catch { return false; }
}
