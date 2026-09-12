import { z } from "zod";
import { join, resolve } from "node:path";
import { mkdirSync, lstatSync, chmodSync } from "node:fs";
import { readJson } from "../auth/storage";
export const pluginId = "ultra-herdr.machine";
const absolute = z.string().startsWith("/");
export const policySchema = z.object({ revision: z.number().int().positive(), ensureWaitMs: z.number().int().min(1).max(30000),
  inspectionTimeoutMs: z.number().int().min(1).max(10000), retryIntervalMs: z.number().int().min(100).max(10000),
  maxResponseBytes: z.number().int().min(1024).max(16777216), maxTerminals: z.number().int().min(1).max(4096),
  defaultDiscoveryProfileId: z.string().min(1) }).strict();
export const installationSchema = z.object({ version: z.literal(1), config: absolute, socketPath: absolute,
  sessionName: z.string().min(1), binary: absolute, herdrBin: absolute, policy: policySchema }).strict();
export type Installation = z.infer<typeof installationSchema>;
export function protectedDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid!()) throw new Error("Runtime storage must be an owned directory.");
  if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o700);
  return resolve(path);
}
export function installation(path: string) { return installationSchema.parse(readJson(join(path, "installation.json"))); }
export function pluginDirectory() {
  const path = process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!path) throw new Error("Use enrollment or the installed plugin entrypoint to start the runtime.");
  return protectedDirectory(path);
}
export function sessionGuard(i: Installation) {
  const inherited = process.env.HERDR_SOCKET_PATH;
  return !inherited || resolve(inherited) === resolve(i.socketPath);
}
