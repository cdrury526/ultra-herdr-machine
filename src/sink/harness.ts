/** Developer test harness: a scripted stand-in for an interactive coding agent. It only uses product CLI commands. */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";

export const READY_MARKER = "ULTRA-HERDR SINK READY";
export type Plan = { label: string; profile?: string; children?: Plan[]; report?: "submit"; release?: boolean };
const plan: z.ZodType<Plan> = z.lazy(() => z.object({ label: z.string().min(1).max(64), profile: z.string().optional(),
  children: z.array(plan).max(8).optional(), report: z.literal("submit").optional(), release: z.boolean().optional() }).strict());
const PREFIX = "SINK ", CRITERION = "Sink plan executed";

type Options = { root?: string; ignoreOffers: number };
type Envelope = { kind: string; taskId: string; payload?: { goal?: string } };

export async function runSink(options: Options) {
  const directory = join(process.cwd(), ".sink");
  mkdirSync(directory, { recursive: true });
  const role = options.root ? "manager" : "agent";
  const logFile = join(directory, `${role}-${process.pid}.jsonl`);
  const log = (event: string, detail: Record<string, unknown> = {}) => {
    const line = { at: new Date().toISOString(), role, pid: process.pid, event, ...detail };
    appendFileSync(logFile, `${JSON.stringify(line)}\n`);
    console.log(`[sink ${role}] ${event} ${JSON.stringify(detail)}`);
  };
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    const ok = result.status === 0;
    if (!ok) log("cli_failed", { command: args[0], status: result.status, error: (result.stderr || "").trim().slice(0, 500) });
    return { ok, json: ok ? JSON.parse(result.stdout.trim().split("\n").pop() || "null") : null };
  };

  let own: { taskId: string; plan: Plan } | undefined;
  const children = new Map<string, Plan>();
  const done = new Set<string>();
  const dispatch = (child: Plan, parentTaskId?: string) => {
    const input = { launchProfileKey: child.profile ?? "sink", workingDirectory: process.cwd(), ...(parentTaskId ? { parentTaskId } : {}),
      values: { payload: { goal: PREFIX + JSON.stringify(child), criteria: [CRITERION], scope: ["sink"], constraints: [], references: [], attributes: {} } } };
    const r = cli(["dispatch", "--data", JSON.stringify(input)]);
    if (r.ok) { children.set(r.json.taskId, child); log("dispatched", { label: child.label, taskId: r.json.taskId, profile: input.launchProfileKey }); }
    return r.ok ? r.json.taskId as string : undefined;
  };
  const submitOwn = () => {
    if (!own) return;
    const summary = `Sink ${own.plan.label} executed; children ${[...done].length}/${own.plan.children?.length ?? 0} completed.`;
    const r = cli(["submit", "--task", own.taskId, "--data", JSON.stringify({ values: { payload: {
      criterionResults: [{ criterion: CRITERION, outcome: "met", explanation: summary }], evidence: { summary, references: [] } } } })]);
    log(r.ok ? "submitted" : "submit_failed", { taskId: own.taskId });
  };
  const handle = (envelope: Envelope) => {
    log("received", { kind: envelope.kind, taskId: envelope.taskId });
    if (envelope.kind === "assignment" && envelope.payload?.goal?.startsWith(PREFIX)) {
      own = { taskId: envelope.taskId, plan: plan.parse(JSON.parse(envelope.payload.goal.slice(PREFIX.length))) };
      for (const child of own.plan.children ?? []) dispatch(child, own.taskId);
      if (!own.plan.children?.length) submitOwn();
    } else if (envelope.kind === "submission") {
      const completed = cli(["complete", "--task", envelope.taskId, "--summary", "Sink accepted submission."]);
      log(completed.ok ? "completed" : "complete_failed", { taskId: envelope.taskId });
      if (!completed.ok) return;
      done.add(envelope.taskId);
      if (children.get(envelope.taskId)?.release !== false) {
        const released = cli(["release", "--task", envelope.taskId, "--reason", "Sink scenario cleanup."]);
        log(released.ok ? "release_requested" : "release_failed", { taskId: envelope.taskId });
      }
      if (options.root && children.has(envelope.taskId)) {
        writeFileSync(join(directory, "root-done.json"), JSON.stringify({ taskId: envelope.taskId, at: Date.now() }));
        log("root_done", { taskId: envelope.taskId });
      } else if (own && own.plan.children?.length && [...children.keys()].every(id => done.has(id))) submitOwn();
    }
  };

  if (options.root) {
    const rootPlan = plan.parse(JSON.parse(readFileSync(options.root, "utf8")));
    const taskId = dispatch(rootPlan);
    writeFileSync(join(directory, "root.json"), JSON.stringify(taskId ? { taskId, label: rootPlan.label } : { error: "dispatch_failed" }));
  }
  console.log(READY_MARKER);
  let ignored = 0;
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const ticket = /receive\s+--ticket\s+(\S+)/.exec(line)?.[1];
    if (!ticket) continue;
    if (ignored < options.ignoreOffers) { ignored++; log("offer_ignored", { count: ignored }); continue; }
    const received = cli(["receive", "--ticket", ticket]);
    if (received.ok && received.json?.envelope) handle(received.json.envelope);
  }
}
