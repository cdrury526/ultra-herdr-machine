import { z } from "zod";
import { existsSync } from "node:fs";
import { authApi, operatorProfileSchema } from "@ultra-herdr/api";
import { clientFor, loadProfile, renewProfile } from "./client";
import { readJson, withCredentialLock, writeLocked } from "./storage";

export async function importOperator(source: string, destination: string) {
  // Explicitly selected input only. Machine/task operations never search operator profiles.
  const profile = operatorProfileSchema.parse(await renewProfile(operatorProfileSchema.parse(readJson(source))));
  const identity = await clientFor(profile).query(authApi.operator, {});
  if (identity.operatorId !== profile.principalId) throw new Error("Operator profile identity mismatch.");
  await withCredentialLock(destination, async path => {
    if (existsSync(path)) throw new Error("Profile already exists; select a new output path.");
    writeLocked(path, profile);
  });
  return { operatorId: identity.operatorId, capabilities: identity.capabilities };
}
export async function operatorClient(path: string) { return clientFor(await loadProfile(path, "operator")); }
export async function issuePermit(profile: string, output: string, machineId?: string) {
  const selected = await loadProfile(profile, "operator");
  const client = clientFor(selected);
  return withCredentialLock(output, async path => {
    const kind = machineId ? "recovery" as const : "setup" as const;
    const intentSchema = z.object({ requestId: z.string().uuid(), kind: z.enum(["recovery", "setup"]),
      machineId: z.string().optional(), operatorId: z.string(), convexUrl: z.url() });
    let request: z.infer<typeof intentSchema>;
    if (existsSync(path)) {
      throw new Error("Setup-key output exists; preserve it or select a new output path.");
    }
    const intent = `${path}.request`;
    if (existsSync(intent)) {
      const saved = intentSchema.parse(readJson(intent));
      if (saved.kind !== kind || saved.machineId !== machineId || saved.operatorId !== selected.principalId || saved.convexUrl !== selected.convexUrl) {
        throw new Error("Saved permit request differs from this command.");
      }
      request = saved;
    } else {
      request = { requestId: crypto.randomUUID(), kind, operatorId: selected.principalId, convexUrl: selected.convexUrl, ...(machineId ? { machineId } : {}) };
      writeLocked(intent, request);
    }
    const result = await client.action(authApi.createPermit, { requestId: request.requestId, kind: request.kind,
      ...(request.machineId ? { machineId: request.machineId } : {}) });
    writeLocked(path, { ...result, convexUrl: selected.convexUrl, kind, requestId: request.requestId, ...(machineId ? { machineId } : {}) });
    return { permitId: result.permitId, expiresAt: result.expiresAt, deployment: selected.convexUrl };
  });
}
