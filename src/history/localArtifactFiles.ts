import { constants, openSync, closeSync, fstatSync, lstatSync, readdirSync, unlinkSync, fsyncSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { verifyEnvelope } from "@ultra-herdr/api";
import { readArtifactText } from "../receive/artifact";
export const artifactName = /^[a-f0-9]{64}\.json$/;
const identity = (s: ReturnType<typeof fstatSync>) => `${s.dev}:${s.ino}`;
export function openArtifacts(directory: string) {
  const root = resolve(directory), parent = openSync(dirname(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let fd: number;
  try {
    const stat = fstatSync(parent);
    if (stat.uid !== process.getuid!() || (stat.mode & 0o022) !== 0) throw new Error("Unprotected artifact parent.");
    try { fd = openSync(`/proc/self/fd/${parent}/${basename(root)}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  } finally { closeSync(parent); }
  const stat = fstatSync(fd!);
  if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700) { closeSync(fd!); throw new Error("Unprotected artifact directory."); }
  return { fd: fd!, identity: identity(stat), anchor: `/proc/self/fd/${fd!}` };
}
export function artifactNames(directory: NonNullable<ReturnType<typeof openArtifacts>>, after: string | undefined, limit: number) {
  const names = readdirSync(directory.anchor).filter(name => artifactName.test(name) && (!after || name > `${after}.json`)).sort();
  return { names: names.slice(0, limit), next: names.length > limit ? names[limit - 1].slice(0, -5) : null };
}
export async function inspectArtifact(directory: NonNullable<ReturnType<typeof openArtifacts>>, artifactId: string) {
  if (!/^[a-f0-9]{64}$/.test(artifactId)) throw new Error("Invalid artifact identity.");
  const path = `${directory.anchor}/${artifactId}.json`;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size > 1048576) throw new Error("Invalid artifact file.");
    const envelope = await verifyEnvelope(readArtifactText(fd));
    return { envelope, fingerprint: `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` };
  } finally { closeSync(fd); }
}
/** Caller holds the shared artifact lock across inspect, fresh backend permission
 * and unlink. A replaced entry is never treated as the previewed file. */
export function removeArtifact(directory: NonNullable<ReturnType<typeof openArtifacts>>, artifactId: string, fingerprint: string) {
  const path = `${directory.anchor}/${artifactId}.json`, stat = lstatSync(path);
  if (!stat.isFile() || `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` !== fingerprint) throw new Error("Artifact changed.");
  unlinkSync(path); fsyncSync(directory.fd);
}
export { closeSync as closeArtifacts };
