/** D175: tickets this machine has redeemed, kept per task so later `--task` commands can present them as authority. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Side = "worker" | "owner";
type Held = Partial<Record<Side, { ticket: string; kind: string; at: number }>>;
// Messages addressed to the assigned agent vs. to the task's owner. Notices can go either way, so they are not held.
const WORKER_KINDS = new Set(["assignment", "revision", "review_feedback", "stop", "resume"]);
const OWNER_KINDS = new Set(["submission", "failure_report"]);

let hint: { ticket?: string; task?: string; sides?: Side[] } = {};
/** Set once per CLI invocation, before any caller resolution. */
export function setCallerHint(value: typeof hint) { hint = value; }

const file = (config: string, taskId: string) => join(`${config}.tickets`, `${taskId.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
const read = (path: string): Held => { try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; } catch { return {}; } };

export function holdTicket(config: string, envelope: { kind: string; taskId: string }, ticket: string) {
  const side: Side | undefined = WORKER_KINDS.has(envelope.kind) ? "worker" : OWNER_KINDS.has(envelope.kind) ? "owner" : undefined;
  if (!side) return;
  mkdirSync(`${config}.tickets`, { recursive: true, mode: 0o700 });
  const path = file(config, envelope.taskId), held = read(path);
  held[side] = { ticket, kind: envelope.kind, at: Date.now() };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(held), { mode: 0o600 });
  renameSync(temporary, path);
}

/** Tickets to try as caller authority for this invocation, most specific first. */
export function candidateTickets(config: string): string[] {
  if (hint.ticket) return [hint.ticket];
  if (!hint.task) return [];
  const held = read(file(config, hint.task));
  return (hint.sides ?? ["owner", "worker"]).map(side => held[side]?.ticket).filter((t): t is string => Boolean(t));
}
