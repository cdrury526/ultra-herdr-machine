import { constants, openSync, closeSync, fstatSync, mkdirSync, readSync, writeSync,
  fsyncSync, linkSync, unlinkSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyEnvelope, messageArtifactId, type MessageEnvelope } from "@ultra-herdr/api";

import { ReceiveError } from "./errors";
export { ReceiveError } from "./errors";
function owned(fd: number, directory: boolean) {
  const stat = fstatSync(fd);
  if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (directory ? !stat.isDirectory() : !stat.isFile())) throw new ReceiveError();
}
export function readArtifactText(fd: number) {
  owned(fd, false);
  if (fstatSync(fd).size > 1048576) throw new ReceiveError();
  const buffer = Buffer.alloc(1048577); let size = 0, count: number;
  while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
  if (size > 1048576) throw new ReceiveError();
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
}
/** Internal receive stage. Only the transaction may return its path after server confirmation. */
export async function saveArtifact(directory: string, deploymentId: string, artifactId: string, envelope: MessageEnvelope) {
  // Revalidate at the storage boundary; callers cannot use a forged typed object or filename.
  const verified = await verifyEnvelope(JSON.stringify(envelope));
  if (await messageArtifactId(deploymentId, verified) !== artifactId) throw new ReceiveError();
  const root = resolve(directory);
  // The configured parent must already exist and protect the directory name from other users.
  const parent = openSync(dirname(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let dir: number;
  try {
    const stat = fstatSync(parent);
    if (stat.uid !== process.getuid!() || (stat.mode & 0o022) !== 0) throw new ReceiveError();
    const anchoredRoot = `/proc/self/fd/${parent}/${basename(root)}`;
    try { mkdirSync(anchoredRoot, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    fsyncSync(parent); // Persist creation before a receipt can depend on the artifact directory.
    dir = openSync(anchoredRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } finally { closeSync(parent); }
  let temporary: string | undefined;
  try {
    owned(dir, true);
    // Linux directory descriptor anchors every operation even if the pathname is concurrently renamed.
    const anchor = `/proc/self/fd/${dir}`, filename = `${artifactId}.json`, target = `${anchor}/${filename}`;
    const bytes = Buffer.from(JSON.stringify(verified) + "\n");
    temporary = `${anchor}/.receive-${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset); fsyncSync(fd); }
    finally { closeSync(fd); }
    try { linkSync(temporary, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    // A concurrent receiver may have won publication. Verify that file; never replace it.
    const existing = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const text = readArtifactText(existing);
      const saved = await verifyEnvelope(text);
      if (await messageArtifactId(deploymentId, saved) !== artifactId || text !== bytes.toString("utf8")) throw new ReceiveError();
      fsyncSync(existing);
    } finally { closeSync(existing); }
    unlinkSync(temporary); temporary = undefined; fsyncSync(dir);
    return `${root}/${filename}`;
  } finally {
    try { if (temporary) unlinkSync(temporary); } finally { closeSync(dir); }
  }
}
