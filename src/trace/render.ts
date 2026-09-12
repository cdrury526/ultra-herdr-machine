import type { traceResultSchemas } from "@ultra-herdr/api";
import type { z } from "zod";

type Active = z.infer<typeof traceResultSchemas.active>;
type Tree = z.infer<typeof traceResultSchemas.tree>;
type Timeline = z.infer<typeof traceResultSchemas.timeline>;
type Ticket = Active["tickets"][number];

const BLOCKING = new Set(["PLACEMENT_FAILED", "DELIVERY_FAILED", "STALLED", "REDEEMED_OUTSIDE_PLACEMENT_PANE", "MANAGER_PANE_OFFERED_WORKER_TICKET", "ORPHAN_CHILD"]);
const short = (id?: string) => !id ? "-" : id.length > 16 ? id.slice(-8) : id;
const who = (party: string) => { const [kind, id] = party.split(":"); return `${kind}:${short(id)}`; };
export function age(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
}
const clock = (at: number) => new Date(at).toISOString().slice(11, 23);
const flags = (list: string[]) => list.map(a => BLOCKING.has(a) ? `!${a}` : a).join(",") || "-";
function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return rows.map(r => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}
const place = (t: Ticket) => `${t.tabLabel ?? (t.tabId ? short(t.tabId) : "-")}/${t.paneId ?? "-"}`;

export function renderActive(value: Active) {
  const head = `TRACE ACTIVE  ${value.tickets.length} tickets  ${value.blocking} blocking  (${new Date(value.now).toLocaleTimeString()})`;
  if (!value.tickets.length) return `${head}\nNothing in flight.`;
  return `${head}\n` + table([["IDLE", "STATE", "KIND", "TASK", "TICKET", "TO", "PROFILE", "TAB/PANE", "OFFERS", "ERROR", "ANOMALIES"],
    ...value.tickets.map(t => [age(value.now - t.updatedAt), t.state, t.kind, short(t.taskId), short(t.deliveryId), who(t.recipient),
      t.profileKey ?? "-", place(t), String(t.offerCount), t.lastError ?? "-", flags(t.anomalies)])]);
}

export function renderTree(value: Tree) {
  const lines = [`TRACE TREE  root ${value.rootTaskId}  ${value.blocking} blocking${value.truncated ? "  (truncated)" : ""}`];
  const children = new Map<string | undefined, Tree["tasks"]>();
  for (const task of value.tasks) {
    const parent = value.tasks.some(t => t.taskId === task.parentTaskId) ? task.parentTaskId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), task]);
  }
  const walk = (task: Tree["tasks"][number], indent: string, last: boolean) => {
    lines.push(`${indent}${last ? "└─" : "├─"} task ${task.taskId} [${task.outcome}]${task.anomalies.length ? ` ${flags(task.anomalies)}` : ""}`);
    const inner = indent + (last ? "   " : "│  ");
    for (const t of task.tickets) {
      const redeemed = t.redeemedAt ? `redeemed +${age(t.redeemedAt - t.createdAt)}${t.redeemedPaneId ? ` @${t.redeemedPaneId}` : ""}` : t.state;
      lines.push(`${inner}• ${t.kind.padEnd(16)} ${who(t.sender)} → ${who(t.recipient)}${t.recipientRole ? ` (${t.recipientRole})` : ""}` +
        `  ${t.profileKey ?? ""}  ${place(t)}  offers ${t.offerCount}  ${redeemed}${t.lastError ? `  error ${t.lastError}` : ""}` +
        `${t.anomalies.length ? `  ${flags(t.anomalies)}` : ""}  [${short(t.deliveryId)}]`);
    }
    const kids = children.get(task.taskId) ?? [];
    kids.forEach((kid, i) => walk(kid, inner, i === kids.length - 1));
  };
  const roots = children.get(undefined) ?? [];
  roots.forEach((task, i) => walk(task, "", i === roots.length - 1));
  return lines.join("\n");
}

export function renderTimeline(value: Timeline) {
  const lines = [`TRACE TIMELINE  task ${value.taskId}${value.deliveryId ? `  ticket ${value.deliveryId}` : ""}${value.truncated ? "  (truncated)" : ""}`];
  const first = value.events[0]?.at ?? 0;
  for (const e of value.events)
    lines.push(`${clock(e.at)}  +${age(e.at - first).padEnd(7)} ${e.kind.padEnd(28)} ${e.deliveryId ? short(e.deliveryId) : "-".padEnd(8)}  ${e.detail ?? ""}`);
  return lines.join("\n");
}
