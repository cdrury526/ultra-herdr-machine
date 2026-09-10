import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { collectCallerEvidence, MAX_PROCESS_IDENTITIES, MAX_EVIDENCE_BYTES } from "../src/context/evidence";
import { readStableProcess, matchesProcess } from "../src/context/linux";
import { ContextError } from "../src/context/errors";

const evidence = collectCallerEvidence();
assert(evidence.processes.some(p => p.pid === process.pid));
assert(evidence.processes.length <= MAX_PROCESS_IDENTITIES);
assert(Buffer.byteLength(JSON.stringify(evidence)) <= MAX_EVIDENCE_BYTES);
assert(!JSON.stringify(evidence).includes('argv'));
const current = readStableProcess(process.pid);
assert(matchesProcess(current, evidence.pidNamespace));
assert(!matchesProcess({ ...current, startIdentity: (BigInt(current.startIdentity) + 1n).toString() }, evidence.pidNamespace));
assert(!matchesProcess(current, 'pid:[0]'));
const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
try {
  assert(child.pid);
  const identity = readStableProcess(child.pid);
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
  assert(!matchesProcess(identity, evidence.pidNamespace));
} finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
process.env.ULTRA_HERDR_LAUNCH_CONTEXT = 'fixture-launch-context';
assert.equal(collectCallerEvidence().launchContextId, 'fixture-launch-context');
process.env.ULTRA_HERDR_LAUNCH_CONTEXT = ' '.repeat(129);
assert.throws(collectCallerEvidence, (error: unknown) => error instanceof ContextError && error.code === 'UNSUPPORTED_CONTEXT');
console.log('Caller evidence smoke passed: bounded live ancestry, PID/start/namespace checks, process death, explicit context and malformed-context rejection. No session binding is claimed.');
