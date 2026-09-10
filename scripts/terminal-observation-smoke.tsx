import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectMachineObservation, observeTerminals, type ObservationReader } from "../src/herdr/observations";
import { ContextError } from "../src/context/errors";

const policy = { maxTerminals: 256, maxForegroundProcesses: 64 };
const live = await collectMachineObservation({ socketPath: join(homedir(), '.config/herdr/herdr.sock'),
  sessionName: 'default', uid: process.getuid!(), timeoutMs: 30_000, maxResponseBytes: 2 * 1024 * 1024 }, policy);
assert(live.terminals.length > 0);
assert(live.terminals.some(t => t.state === 'observed' && t.shell));
assert(live.terminals.every(t => !('argv' in t) && !('cwd' in t) && !('agent' in t)));
function fixture(mode: 'stable' | 'move' | 'replace' | 'ambiguous' | 'missing'): ObservationReader {
  let snapshots = 0, processes = 0;
  return { read: async method => {
    if (method === 'session.snapshot') {
      snapshots++;
      const pane = { pane_id: mode === 'move' && snapshots > 1 ? 'moved' : 'pane', terminal_id: 'terminal' };
      return { type: 'session_snapshot', snapshot: { version: '0.9.0', protocol: 22,
        panes: mode === 'ambiguous' ? [pane, { ...pane, pane_id: 'second' }] : [pane] } };
    }
    processes++;
    return { type: 'pane_process_info', process_info: { pane_id: 'pane',
      shell_pid: mode === 'missing' ? null : process.pid,
      foreground_process_group_id: process.pid,
      foreground_processes: mode === 'replace' && processes > 1 ? [] : [{ pid: process.pid, name: 'ignored', argv: ['ignored'] }] } };
  } };
}
const observed = await observeTerminals(fixture('stable'), live.server, policy);
assert.equal(observed.terminals[0].state, 'observed');
assert.equal(observed.terminals[0].shell?.pid, process.pid);
assert.equal((await observeTerminals(fixture('missing'), live.server, policy)).terminals[0].state, 'unavailable');
for (const mode of ['move', 'replace', 'ambiguous'] as const) {
  await assert.rejects(observeTerminals(fixture(mode), live.server, policy), ContextError);
}
const otherNamespace = await observeTerminals(fixture('stable'), { ...live.server, pidNamespace: 'pid:[0]' }, policy);
assert.equal(otherNamespace.terminals[0].state, 'unavailable');
console.log(`Terminal observation smoke passed: ${live.terminals.length} live terminals inspected read-only; stable identities, missing/foreign namespace, changed mapping/process set and duplicate terminal rejection checked. No caller authorization is claimed.`);
