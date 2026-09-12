import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readJson } from "./storage";
export function enrollmentPointerPath() {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ultra-herdr", "enrollment.json");
}
/** Local setup locator only; the referenced credential and caller are independently authenticated. */
export function defaultMachineConfig() {
  const pointer = enrollmentPointerPath();
  if (existsSync(pointer)) return z.object({ version: z.literal(1), config: z.string().startsWith("/") }).strict().parse(readJson(pointer)).config;
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ultra-herdr", "machine.json");
}
