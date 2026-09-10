import { existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { authApi, PROTOCOL_VERSION, registrationSchema } from "@ultra-herdr/api";
import { z } from "zod";
import { acknowledgeLocked, clientFor, machineProfileSchema, postCredential, secureUrl,
  renewProfile, type MachineProfile } from "./client";
import { readJson, readProtected, withCredentialLock, writeLocked } from "./storage";

const intentSchema = z.object({ requestId: z.string().uuid(), fingerprint: z.string(),
  convexUrl: z.url(), recovery: z.boolean(), name: z.string().optional(), herdrSession: z.string().optional() });
export type RegisterOptions = { config: string; deployment: string; keyFile: string;
  name?: string; session?: string; recovery?: boolean };
async function fingerprint(value: unknown) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Buffer.from(hash).toString("hex");
}
export async function registerMachine(options: RegisterOptions) {
  const convexUrl = secureUrl(options.deployment);
  const keyInput = readProtected(options.keyFile).trim();
  const keyRecord = keyInput.startsWith('{') ? JSON.parse(keyInput) : { setupKey: keyInput };
  if (keyRecord.convexUrl && secureUrl(keyRecord.convexUrl) !== convexUrl) throw new Error("Setup key belongs to another deployment.");
  const setupKey = z.string().regex(/^uhp1\.[A-Za-z0-9]+\.[A-Za-z0-9_-]{43}$/).parse(keyRecord.setupKey);
  const recovery = options.recovery ?? false;
  if (keyRecord.kind && keyRecord.kind !== (recovery ? 'recovery' : 'setup')) throw new Error("Setup key kind does not match registration mode.");
  if (recovery && (options.name || options.session)) throw new Error("Recovery preserves the existing machine name and Herdr session.");
  const body = recovery ? {} : {
    name: z.string().trim().min(1).max(100).parse(options.name),
    herdrSession: z.string().trim().min(1).max(100).parse(options.session ?? 'default'),
  };
  const expectedFingerprint = await fingerprint([convexUrl, recovery, body, setupKey]);
  return withCredentialLock(options.config, async path => {
    const existing = existsSync(path) ? machineProfileSchema.parse(readJson(path)) : undefined;
    if (existing && existing.convexUrl !== convexUrl) throw new Error("Config belongs to another deployment; select a separate config.");
    if (existing && keyRecord.machineId && keyRecord.machineId !== existing.machineId) throw new Error("Recovery key targets another machine.");
    const intentPath = `${path}.registration`;
    let intent = existsSync(intentPath) ? intentSchema.parse(readJson(intentPath)) : undefined;
    if (intent?.fingerprint !== expectedFingerprint) {
      if (intent && existing?.registrationRequestId !== intent.requestId) throw new Error("An interrupted registration is pending; retry its original inputs.");
      if (existing && !recovery) throw new Error("Machine credentials already exist; use credentials status or explicit recovery.");
      intent = { requestId: crypto.randomUUID(), fingerprint: expectedFingerprint, convexUrl, recovery, ...body };
      writeLocked(intentPath, intent);
    }
    if (existing?.registrationRequestId === intent.requestId) {
      const current = machineProfileSchema.parse(await renewProfile(existing));
      if (current.token !== existing.token) writeLocked(path, current);
      const saved = await acknowledgeLocked(path, current);
      await clientFor(saved).query(authApi.machine, {});
      return summary(saved);
    }
    const discovery = new ConvexHttpClient(convexUrl, { logger: false });
    const deployment = await discovery.query(authApi.deploymentInfo, {});
    if (deployment.protocolVersion !== PROTOCOL_VERSION) throw new Error("Deployment protocol differs from this CLI; update the CLI.");
    const registration = registrationSchema.parse(await postCredential(deployment.registrationUrl,
      setupKey, intent.requestId, body));
    if (registration.renewalUrl !== deployment.renewalUrl || (existing && registration.machineId !== existing.machineId)) {
      throw new Error("Registration returned inconsistent deployment or machine identity.");
    }
    const profile: MachineProfile = machineProfileSchema.parse({ ...registration, version: 1, convexUrl,
      registrationRequestId: intent.requestId, pendingSaveAcknowledgement: registration.permitId });
    const verified = await clientFor(profile).query(authApi.machine, {});
    if (verified.machineId !== profile.machineId) throw new Error("Registration credential identity mismatch.");
    writeLocked(path, profile);
    return summary(await acknowledgeLocked(path, profile));
  });
}
function summary(profile: MachineProfile) {
  return { machineId: profile.machineId, name: profile.name, herdrSession: profile.herdrSession,
    credentials: "saved", installation: "not_installed" };
}
