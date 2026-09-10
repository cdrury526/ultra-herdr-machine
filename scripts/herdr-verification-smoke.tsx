import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chmodSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { withVerifiedHerdr, type VerificationTarget } from "../src/herdr/verified-connection";
import { ContextError } from "../src/context/errors";

const target: VerificationTarget = { socketPath: join(homedir(), '.config/herdr/herdr.sock'),
  sessionName: 'default', uid: process.getuid!(), timeoutMs: 3000, maxResponseBytes: 2 * 1024 * 1024 };
const first = await withVerifiedHerdr(target, async (connection, server) => {
  assert.equal(server.version, '0.9.0'); assert.equal(server.protocol, 22);
  assert.equal(server.peerUid, process.getuid!());
  assert(await connection.read('session.snapshot'));
  return server.fingerprint;
});
assert.equal(await withVerifiedHerdr(target, async (_, server) => server.fingerprint), first);
await assert.rejects(withVerifiedHerdr({ ...target, uid: target.uid + 1 }, async () => null), ContextError);
const directory = mkdtempSync(join(tmpdir(), 'ultra-peer-smoke-'));
try {
  for (const mode of ['version', 'correlation', 'oversize', 'timeout', 'replaced'] as const) {
    const path = join(directory, mode + '.sock');
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.once('data', chunk => {
        const request = JSON.parse(chunk.toString());
        if (mode === 'timeout') return;
        if (mode === 'replaced') renameSync(path, path + '.old');
        socket.write(JSON.stringify({ id: mode === 'correlation' ? 'wrong-id' : request.id,
          result: { type: 'pong', version: mode === 'version' ? '0.0.0' : '0.9.0', protocol: 22,
            ...(mode === 'oversize' ? { excess: 'x'.repeat(2048) } : {}) } }) + '\n');
      });
    });
    await new Promise<void>(resolve => server.listen(path, resolve)); chmodSync(path, 0o600);
    try {
      await assert.rejects(withVerifiedHerdr({ ...target, socketPath: path, timeoutMs: 150, maxResponseBytes: 1024 },
        async () => assert.fail('Rejected server reached the observation callback')), ContextError);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('Herdr verification smoke passed: live pinned peer/snapshot, stable fingerprint, wrong UID/version/correlation, bounded response, timeout and replaced socket rejection. No panes changed.');
