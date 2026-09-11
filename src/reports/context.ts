import { loadProfile, clientFor } from "../auth/client";
import { resolveCaller } from "../context/resolve";
import { ReportError } from "./input";
/** Shared authenticated caller boundary for typed task-message clients. */
export async function messageContext(config: string) {
  const profile = await loadProfile(config, "machine"), caller = await resolveCaller(config);
  if (profile.machineId !== caller.machineId) throw new ReportError("Machine profile changed during verification; retry.");
  return { profile, caller, client: clientFor(profile, (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) })) };
}
