import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Write one ephemeral typed input for a single CLI mutation. */
export function writeEphemeralInput(prefix: string, value: unknown) {
  const dir = join("/tmp", `herdr-cli-${prefix}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "input.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return path;
}
