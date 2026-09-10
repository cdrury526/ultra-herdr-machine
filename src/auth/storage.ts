import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync,
  fsyncSync, renameSync, unlinkSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { dlopen, FFIType } from "bun:ffi";

function owned(fd: number) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
    throw new Error("Credential files must be regular, owned by this user and mode 0600.");
  }
}
export function readProtected(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { owned(fd); return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
}
export function readJson(path: string): unknown { return JSON.parse(readProtected(path)); }
export function writeLocked(path: string, value: unknown) {
  const temporary = join(dirname(path), `.herdr-credential-${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
/** All credential read-modify-write paths hold this stable inode through network renewal. */
export async function withCredentialLock<T>(file: string, operation: (path: string) => Promise<T>): Promise<T> {
  if (process.platform !== "linux") throw new Error("Credential locking currently requires Linux.");
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = statSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid!() || (parent.mode & 0o022) !== 0) {
    throw new Error("Credential directory must belong to this user and deny group/other writes.");
  }
  const fd = openSync(`${path}.lock`, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | 0o2000000, 0o600);
  const native = dlopen("libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  try {
    owned(fd);
    const flags = native.symbols.fcntl(fd, 1, 0);
    if (flags < 0 || native.symbols.fcntl(fd, 2, flags | 1) !== 0) throw new Error("Cannot protect credential lock inheritance.");
    const deadline = Date.now() + 60_000;
    while (native.symbols.flock(fd, 2 | 4) !== 0) {
      if (Date.now() >= deadline) throw new Error("Credential file is busy; retry after the other command finishes.");
      await new Promise(done => setTimeout(done, 50));
    }
    return await operation(path);
  } finally {
    native.symbols.flock(fd, 8); closeSync(fd); native.close();
  }
}
