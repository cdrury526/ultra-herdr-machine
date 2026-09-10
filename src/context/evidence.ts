import { ContextError } from "./errors";
import { localLifetime, readStableProcess, type ProcessObservation } from "./linux";

export const MAX_PROCESS_IDENTITIES = 64;
export const MAX_EVIDENCE_BYTES = 16 * 1024;
export interface CallerEvidence {
  revision: 1;
  bootId: string;
  pidNamespace: string;
  launchContextId?: string;
  inheritedPaneId?: string;
  processes: { pid: number; startIdentity: string }[];
  chainStatus: "complete" | "truncated" | "unavailable" | "changed";
}
function optionalContext(name: string) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!value || Buffer.byteLength(value, "utf8") > 128 || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw new ContextError("UNSUPPORTED_CONTEXT", "Inherited product context is malformed. Re-establish the launch context before retrying.");
  }
  return value;
}
/** Evidence only: no Herdr I/O, identity selection, role assignment or authorization. */
export function collectCallerEvidence(): CallerEvidence {
  const lifetime = localLifetime();
  const launchContextId = optionalContext("ULTRA_HERDR_LAUNCH_CONTEXT");
  const inheritedPaneId = optionalContext("HERDR_PANE_ID");
  let chainStatus: CallerEvidence["chainStatus"] = "complete";
  const observations: ProcessObservation[] = [];
  const seen = new Set<number>();
  let pid = process.pid;
  while (pid > 0 && observations.length < MAX_PROCESS_IDENTITIES) {
    try {
      if (seen.has(pid)) throw new Error("Process cycle");
      seen.add(pid);
      const observation = readStableProcess(pid);
      if (observation.pidNamespace !== lifetime.pidNamespace) throw new Error("Namespace mismatch");
      observations.push(observation);
      pid = observation.parentPid;
    } catch { chainStatus = "unavailable"; break; }
  }
  if (chainStatus === "complete" && pid > 0) chainStatus = "truncated";
  try {
    const after = localLifetime();
    if (after.bootId !== lifetime.bootId || after.pidNamespace !== lifetime.pidNamespace) throw new Error("Lifetime changed");
    for (const before of observations) {
      const current = readStableProcess(before.pid);
      if (current.startIdentity !== before.startIdentity || current.parentPid !== before.parentPid ||
          current.pidNamespace !== before.pidNamespace) throw new Error("Process chain changed");
    }
  } catch { chainStatus = "changed"; observations.length = 0; }
  const evidence: CallerEvidence = { revision: 1, ...lifetime,
    ...(launchContextId !== undefined ? { launchContextId } : {}),
    ...(inheritedPaneId !== undefined ? { inheritedPaneId } : {}),
    processes: observations.map(({ pid, startIdentity }) => ({ pid, startIdentity })), chainStatus };
  if (Buffer.byteLength(JSON.stringify(evidence), "utf8") > MAX_EVIDENCE_BYTES) {
    throw new ContextError("UNSUPPORTED_CONTEXT", "Caller evidence exceeds the supported verification bound.");
  }
  return evidence;
}
