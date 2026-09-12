import { z } from "zod";
import { withVerifiedHerdr } from "../herdr/verified-connection";
import type { Installation } from "../runtime/config";

const tabListSchema = z.object({ type: z.literal("tab_list"), tabs: z.array(z.object({ tab_id: z.string(), label: z.string() })) });
const snapshotSchema = z.object({
  type: z.literal("session_snapshot"),
  snapshot: z.object({ layouts: z.array(z.object({ tab_id: z.string(), panes: z.array(z.object({ pane_id: z.string() })) })) }),
});
const tabCreatedSchema = z.object({ type: z.literal("tab_created"), tab: z.object({ tab_id: z.string().min(1) }), root_pane: z.object({ pane_id: z.string().min(1) }) });

/** Resolve the Workers tab and the pane to split from (never the dispatch caller pane). */
export async function resolveWorkersSplitPane(
  settings: Installation,
  fingerprint: string,
  label: string,
  cwd: string,
  forbiddenPaneIds: string[],
) {
  const forbidden = new Set(forbiddenPaneIds.filter(Boolean));
  return withVerifiedHerdr(
    { socketPath: settings.socketPath, sessionName: settings.sessionName, uid: process.getuid!(),
      timeoutMs: settings.policy.inspectionTimeoutMs, maxResponseBytes: settings.policy.maxResponseBytes },
    async (connection, server) => {
      if (server.fingerprint !== fingerprint) throw new Error("STALE_BINDING");
      const listed = tabListSchema.parse(await connection.rpc("tab.list", {}));
      const tabId = listed.tabs.find(t => t.label === label)?.tab_id;
      if (tabId) {
        const snap = snapshotSchema.parse(await connection.rpc("session.snapshot", {}));
        const layout = snap.snapshot.layouts.find(l => l.tab_id === tabId);
        const candidate = layout?.panes.map(p => p.pane_id).find(id => !forbidden.has(id));
        if (candidate) return { paneId: candidate, tabId, tabLabel: label };
      }
      const created = tabCreatedSchema.parse(await connection.rpc("tab.create", { cwd, focus: false, label }));
      const paneId = created.root_pane.pane_id;
      if (forbidden.has(paneId)) throw new Error("WORKERS_TAB_PROTECTED");
      return { paneId, tabId: created.tab.tab_id, tabLabel: label };
    },
  );
}
