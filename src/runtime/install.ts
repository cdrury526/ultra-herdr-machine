import { join, dirname, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { enrollmentPointerPath } from "../auth/default";
import { runtimeApi, runtimeResultSchemas } from "@ultra-herdr/api";
import { clientFor, loadProfile, secureUrl } from "../auth/client";
import { registerMachine, type RegisterOptions } from "../auth/registration";
import { readJson, writeLocked, withCredentialLock } from "../auth/storage";
import { pluginId, protectedDirectory, installationSchema } from "./config";
import { ensureRuntime } from "./startup";
export async function herdrCommand(binary: string, args: string[], socketPath?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { env: { ...process.env, ...(socketPath ? { HERDR_SOCKET_PATH: socketPath } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", bytes = 0;
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Herdr plugin command timed out; inspect before retrying.")); }, 15000);
    child.stdout.on("data", data => { bytes += data.length; if (bytes > 1048576) child.kill("SIGTERM"); else out += data; });
    child.stderr.resume(); child.on("error", () => { clearTimeout(timer); reject(new Error("Cannot run the installed Herdr binary.")); });
    child.on("exit", code => { clearTimeout(timer); if (code === 0 && bytes <= 1048576) resolve(out.trim()); else reject(new Error("Herdr plugin operation failed.")); });
  });
}
export async function enroll(options: RegisterOptions & { socket: string; herdrBin: string }) {
  const directory = protectedDirectory(await herdrCommand(options.herdrBin, ["plugin", "config-dir", pluginId]));
  return withCredentialLock(join(directory, "installation.json"), async () => {
  const socketPath = resolve(options.socket), config = resolve(options.config || join(directory, "machine.json"));
  const existingPath = join(directory, "installation.json");
  if (existsSync(existingPath)) {
    const prior = installationSchema.parse(readJson(existingPath));
    if (prior.config !== config || prior.socketPath !== socketPath) throw new Error("This plugin already has another enrollment. Preserve it before changing installation.");
  }
  if (!existsSync(config)) await registerMachine({ ...options, config });
  const profile = await loadProfile(config, "machine");
  if (profile.convexUrl !== secureUrl(options.deployment) || profile.name !== options.name || profile.herdrSession !== (options.session ?? "default"))
    throw new Error("Existing enrollment differs from the requested deployment/name/session.");
  const policy = runtimeResultSchemas.settings.parse(await clientFor(profile).query(runtimeApi.settings, {}));
  const binary = realpathSync(process.execPath);
  const installation = installationSchema.parse({ version: 1, config, socketPath, sessionName: profile.herdrSession,
    binary, herdrBin: realpathSync(options.herdrBin), policy });
  writeLocked(existingPath, installation);
  // Materialize the bundled plugin with an absolute compiled executable, never credentials in the manifest.
  const source = protectedDirectory(join(directory, "plugin"));
  const metadata = await import("../../package.json");
  const manifest = `id = "${pluginId}"\nname = "Ultra Herdr Machine"\nversion = "${metadata.default.version}"\nmin_herdr_version = "0.9.0"\nplatforms = ["linux"]\n\n[[startup]]\ncommand = [${JSON.stringify(binary)}, "ensure"]\n\n[[panes]]\nid = "agent"\ntitle = "Ultra Herdr Agent"\nplacement = "tab"\ncommand = [${JSON.stringify(binary)}, "agent"]\n`;
  // TOML is source metadata, not a journal. Atomic replacement still avoids partial plugin manifests.
  const { writeFileSync, renameSync } = await import("node:fs");
  const temporary = join(source, `manifest-${crypto.randomUUID()}`);
  writeFileSync(temporary, manifest, { mode: 0o600, flag: "wx" }); renameSync(temporary, join(source, "herdr-plugin.toml"));
  await herdrCommand(installation.herdrBin, ["plugin", "link", source], socketPath);
  await herdrCommand(installation.herdrBin, ["plugin", "enable", pluginId], socketPath);
  protectedDirectory(dirname(enrollmentPointerPath()));
  await withCredentialLock(enrollmentPointerPath(), async pointer => {
    if (existsSync(pointer)) {
      const prior = readJson(pointer) as { config?: string };
      if (prior.config !== config) throw new Error("A different default enrollment already exists; preserve its locator before switching.");
    }
    writeLocked(pointer, { version: 1, config });
  });
  return { machineId: profile.machineId, installation: "installed", ...await ensureRuntime(directory) };
  });
}
