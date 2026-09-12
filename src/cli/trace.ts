import type { Command } from "commander";
import { ConvexClient } from "convex/browser";
import { traceApi, traceResultSchemas } from "@ultra-herdr/api";
import { defaultMachineConfig } from "../auth/default";
import { clientFor, loadProfile, secureUrl } from "../auth/client";
import { renderActive, renderTimeline, renderTree } from "../trace/render";

type Options = { config: string; json?: boolean; watch?: boolean; stallMs?: string; limit?: string };
type View = { ref: any; args: Record<string, unknown>; parse: (value: unknown) => any; render: (value: any) => string; blocking: (value: any) => number };

async function run(view: View, options: Options) {
  const profile = await loadProfile(options.config, "machine");
  const show = (value: unknown) => {
    const parsed = view.parse(value);
    return { parsed, text: options.json ? JSON.stringify(parsed) : view.render(parsed) };
  };
  if (!options.watch) {
    const { parsed, text } = show(await clientFor(profile).query(view.ref, view.args));
    console.log(text);
    if (view.blocking(parsed) > 0) process.exitCode = 2;
    return;
  }
  const client = new ConvexClient(secureUrl(profile.convexUrl).replace(/\/$/, ""), { logger: false });
  client.setAuth(async () => (await loadProfile(options.config, "machine")).token);
  await new Promise<void>(resolve => {
    const stop = () => { client.close().finally(resolve); };
    process.once("SIGINT", stop);
    client.onUpdate(view.ref, view.args, value => {
      const { text } = show(value);
      if (options.json) console.log(text);
      else process.stdout.write(`\x1b[2J\x1b[H${text}\n\n(watching; ctrl-c to stop)\n`);
    }, () => { console.error("Trace subscription failed. Check machine credentials."); stop(); });
  });
}

const positive = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer.`);
  return n;
};

export function addTraceCommands(program: Command) {
  const trace = program.command("trace").description("Inspect where tickets landed using the Convex ticket ledger (exit 2 on blocking anomalies).");
  const common = (command: Command) => command.option("--json", "Machine-readable output").option("--watch", "Live-update via Convex subscription")
    .option("--stall-ms <ms>", "Idle time before an in-flight ticket is STALLED (default 120000)")
    .option("--config <file>", "Protected machine profile", defaultMachineConfig());
  common(trace.command("active").description("Every in-flight ticket, stalest first.").option("--limit <count>", "Maximum tickets (default 50)"))
    .action((o: Options) => run({ ref: traceApi.active, args: { ...(o.limit ? { limit: positive(o.limit, "--limit") } : {}), ...(o.stallMs ? { stallMs: positive(o.stallMs, "--stall-ms") } : {}) },
      parse: v => traceResultSchemas.active.parse(v), render: renderActive, blocking: v => v.blocking }, o));
  common(trace.command("tree <id>").description("Whole manager → supervisor → worker tree for a task or ticket delivery id."))
    .action((id: string, o: Options) => run({ ref: traceApi.tree, args: { id, ...(o.stallMs ? { stallMs: positive(o.stallMs, "--stall-ms") } : {}) },
      parse: v => traceResultSchemas.tree.parse(v), render: renderTree, blocking: v => v.blocking }, o));
  common(trace.command("timeline <id>").description("Ordered events for a task, or one ticket delivery id.").option("--limit <count>", "Maximum events (default 200)"))
    .action((id: string, o: Options) => run({ ref: traceApi.timeline, args: { id, ...(o.limit ? { limit: positive(o.limit, "--limit") } : {}) },
      parse: v => traceResultSchemas.timeline.parse(v), render: renderTimeline, blocking: () => 0 }, o));
}
