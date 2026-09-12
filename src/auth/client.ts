import { ConvexHttpClient } from "convex/browser";
import { authApi, credentialSchema, operatorProfileSchema, type Credential, type OperatorProfile } from "@ultra-herdr/api";
import { z } from "zod";
import { readJson, writeLocked, withCredentialLock } from "./storage";

export const machineProfileSchema = credentialSchema.extend({
  version: z.literal(1), convexUrl: z.url(), principalKind: z.literal("machine"),
  machineId: z.string().min(1), name: z.string().min(1), herdrSession: z.string().min(1),
  recoveryEpoch: z.number().int().nonnegative(),
  registrationRequestId: z.string().optional(),
  pendingSaveAcknowledgement: z.string().optional(),
}).refine(p => p.machineId === p.principalId, { message: "Machine identity conflicts with its credential." });
export type MachineProfile = z.infer<typeof machineProfileSchema>;
export type Profile = OperatorProfile | MachineProfile;
export function secureUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error("Credential endpoints require HTTPS, or HTTP on loopback for local hosting.");
  }
  return url.toString();
}
/** Convex answers 503 when a mutation keeps losing write conflicts (e.g. to the task's own background
 * workflow steps). Nothing was committed, and task mutations carry journaled request ids, so a short retry is safe. */
export function retryingFetch(base: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const response = await base(input, init);
      if (response.status !== 503 || attempt >= 4) return response;
      await new Promise(done => setTimeout(done, 200 * 2 ** attempt + Math.floor(Math.random() * 150)));
    }
  }) as typeof globalThis.fetch;
}
export function clientFor(profile: Profile, fetchOverride?: typeof globalThis.fetch) {
  const client = new ConvexHttpClient(secureUrl(profile.convexUrl), { logger: false, fetch: retryingFetch(fetchOverride) });
  client.setAuth(profile.token);
  return client;
}
export async function postCredential(url: string, token: string, requestId: string, body?: unknown) {
  const response = await fetch(secureUrl(url), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, 'X-Ultra-Request-Id': requestId,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Credential request rejected. Retry the saved request or obtain a recovery key if revoked.");
  return response.json();
}
export async function renewProfile(profile: Profile): Promise<Profile> {
  if (profile.expiresAt - Math.floor(Date.now() / 1000) >= 24 * 60 * 60) return profile;
  const replacement: Credential = credentialSchema.parse(await postCredential(profile.renewalUrl,
    profile.token, crypto.randomUUID()));
  if (replacement.principalId !== profile.principalId || replacement.principalKind !== profile.principalKind ||
      replacement.renewalUrl !== profile.renewalUrl || replacement.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("Renewal returned inconsistent identity or expired credentials.");
  }
  return { ...profile, ...replacement } as Profile;
}
export async function loadProfile(path: string, kind: "operator"): Promise<OperatorProfile>;
export async function loadProfile(path: string, kind: "machine"): Promise<MachineProfile>;
export async function loadProfile(path: string, kind: "operator" | "machine"): Promise<Profile> {
  return withCredentialLock(path, async locked => {
    const value = readJson(locked);
    const profile = kind === "operator" ? operatorProfileSchema.parse(value) : machineProfileSchema.parse(value);
    const refreshed = await renewProfile(profile);
    if (refreshed !== profile) writeLocked(locked, refreshed);
    return kind === "machine" ? acknowledgeLocked(locked, refreshed as MachineProfile) : refreshed;
  });
}

export async function acknowledgeLocked(path: string, profile: MachineProfile) {
  if (!profile.pendingSaveAcknowledgement) return profile;
  try {
    await clientFor(profile).mutation(authApi.acknowledgeSaved, { permitId: profile.pendingSaveAcknowledgement });
  } catch {
    throw new Error("Machine credentials are saved; confirmation is pending. Retry credentials status with the same config.");
  }
  const { pendingSaveAcknowledgement: _, ...saved } = profile;
  writeLocked(path, saved);
  return saved;
}
