import { dlopen, FFIType, ptr } from "bun:ffi";
import { performance } from "node:perf_hooks";
import { ContextError } from "../context/errors";

function failure(message: string): never { throw new ContextError("UNSUPPORTED_CONTEXT", message); }
/** Linux AF_UNIX only. Every descriptor is nonblocking and close-on-exec at creation. */
export class LinuxSocket {
  private native = dlopen("libc.so.6", {
    socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    connect: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    getsockopt: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    poll: { args: [FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    // Calls are bounded below 2^31 bytes, so signed low 32 bits preserve ssize_t results.
    send: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    recv: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  });
  private fd = -1;
  private constructor() {}
  static async connect(path: string, deadline: number) {
    if (process.platform !== "linux") failure("Herdr peer verification currently requires Linux.");
    const encoded = Buffer.from(path);
    if (!path.startsWith("/") || path.includes("\0") || encoded.length > 107) failure("Enrolled socket path is unsupported.");
    const connection = new LinuxSocket();
    try {
      connection.fd = connection.native.symbols.socket(1, 1 | 0o4000 | 0o2000000, 0);
      if (connection.fd < 0) failure("Cannot open a protected local socket.");
      const address = Buffer.alloc(110); address.writeUInt16LE(1); encoded.copy(address, 2);
      const result = connection.native.symbols.connect(connection.fd, ptr(address), encoded.length + 3);
      if (result !== 0) {
        await connection.ready(4, deadline);
        const error = connection.option(4, 4);
        if (error.readInt32LE() !== 0) failure("Cannot connect to the enrolled Herdr server.");
      }
      return connection;
    } catch (error) { connection.close(); throw error; }
  }
  private option(name: number, size: number) {
    const data = Buffer.alloc(size), length = Buffer.alloc(4); length.writeUInt32LE(size);
    if (this.native.symbols.getsockopt(this.fd, 1, name, ptr(data), ptr(length)) !== 0 ||
        length.readUInt32LE() !== size) failure("Connected socket identity is unavailable.");
    return data;
  }
  peer() {
    const data = this.option(17, 12);
    const pid = data.readInt32LE(), uid = data.readUInt32LE(4), gid = data.readUInt32LE(8);
    if (pid <= 0) failure("Connected socket has no supported peer identity.");
    return { pid, uid, gid };
  }
  private async ready(events: number, deadline: number) {
    while (performance.now() < deadline) {
      const poll = Buffer.alloc(8); poll.writeInt32LE(this.fd); poll.writeInt16LE(events, 4);
      const result = this.native.symbols.poll(ptr(poll), 1, 0);
      if (result < 0) failure("Local socket readiness failed.");
      const returned = poll.readInt16LE(6);
      if (returned & events) return;
      if (returned & (8 | 16 | 32)) failure("Herdr connection closed during verification.");
      await new Promise(done => setTimeout(done, Math.min(10, Math.max(1, deadline - performance.now()))));
    }
    failure("Herdr verification timed out; retry after checking the local server.");
  }
  async exchange(request: string, deadline: number, maxResponseBytes: number) {
    const body = Buffer.from(request);
    if (body.length > 16 * 1024) failure("Herdr verification request is oversized.");
    let offset = 0;
    while (offset < body.length) {
      await this.ready(4, deadline);
      const remaining = body.subarray(offset);
      const sent = this.native.symbols.send(this.fd, ptr(remaining), remaining.length, 0x4000);
      if (sent <= 0) failure("Herdr verification request could not be sent.");
      offset += sent;
    }
    const chunks: Buffer[] = []; let total = 0;
    while (true) {
      await this.ready(1, deadline);
      const chunk = Buffer.alloc(Math.min(16 * 1024, maxResponseBytes - total + 1));
      const size = this.native.symbols.recv(this.fd, ptr(chunk), chunk.length, 0);
      if (size <= 0) failure("Herdr response ended before verification completed.");
      total += size;
      if (total > maxResponseBytes) failure("Herdr verification response exceeds its configured bound.");
      const read = chunk.subarray(0, size); chunks.push(read);
      const newline = read.indexOf(10);
      if (newline >= 0) {
        if (newline !== read.length - 1) failure("Unexpected additional Herdr response data.");
        return Buffer.concat(chunks).toString("utf8");
      }
    }
  }
  close() {
    if (this.fd >= 0) { this.native.symbols.close(this.fd); this.fd = -1; }
    this.native.close();
  }
}
