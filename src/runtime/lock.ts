import { constants, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
/** Stable process-lifetime flock. Never unlink/replace it, and never inherit it into a child. */
export function runtimeLock(path: string) {
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const native = dlopen("libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  let held = false;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) throw new Error("Invalid runtime lock ownership.");
    const flags = native.symbols.fcntl(fd, 1, 0);
    if (flags < 0 || native.symbols.fcntl(fd, 2, flags | 1) !== 0) throw new Error("Cannot protect runtime lock inheritance.");
    held = native.symbols.flock(fd, 2 | 4) === 0;
    return { held, heldBy(pid: number) {
      const st = fstatSync(fd, { bigint: true }), dev = st.dev;
      const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
      const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
      return readFileSync("/proc/locks", "utf8").split("\n").some(line => {
        const f = line.trim().split(/\s+/), device = f[5]?.split(":");
        return f[1] === "FLOCK" && f[3] === "WRITE" && Number(f[4]) === pid && device?.length === 3 &&
          BigInt(`0x${device[0]}`) === major && BigInt(`0x${device[1]}`) === minor && BigInt(device[2]) === st.ino;
      });
    }, close() { if (held) native.symbols.flock(fd, 8); closeSync(fd); native.close(); } };
  } catch (error) { closeSync(fd); native.close(); throw error; }
}
