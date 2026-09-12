import { z } from "zod";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { commandPane,type CommandPayload } from "@ultra-herdr/api";
import { withVerifiedHerdr } from "../herdr/verified-connection";
import { observeTerminals } from "../herdr/observations";
import { protectedDirectory,type Installation } from "../runtime/config";
import { readJson,writeLocked } from "../auth/storage";
import { encode } from "./journal";
const spool=z.object({snapshotId:z.string().uuid(),serverBindingId:z.string(),fingerprint:z.string(),capturedAt:z.number(),expiresAt:z.number(),panes:z.array(commandPane).max(4096)}).strict();
export async function snapshot(settings:Installation,directory:string,fingerprint:string,p:Extract<CommandPayload,{op:"snapshot"}>,retentionMs:number) {
  const root=protectedDirectory(join(directory,"command-snapshots"));let saved:z.infer<typeof spool>;
  if(p.cursor) {
    if(!z.string().uuid().safeParse(p.cursor.snapshotId).success)throw Error("STALE_SNAPSHOT");
    const path=join(root,p.cursor.snapshotId+'.json');if(!existsSync(path))throw Error("STALE_SNAPSHOT");saved=spool.parse(readJson(path));
    if(saved.serverBindingId!==p.serverBindingId || saved.fingerprint!==fingerprint || saved.expiresAt<=Date.now() || p.cursor.nextOffset>=saved.panes.length)throw Error("STALE_SNAPSHOT");
  }else{
    saved=await withVerifiedHerdr({socketPath:settings.socketPath,sessionName:settings.sessionName,uid:process.getuid!(),timeoutMs:settings.policy.inspectionTimeoutMs,maxResponseBytes:settings.policy.maxResponseBytes},async(connection,server)=>{
      if(server.fingerprint!==fingerprint)throw Error("STALE_BINDING");
      const observed=await observeTerminals(connection,server,{maxTerminals:settings.policy.maxTerminals,maxForegroundProcesses:64});
      const raw:any=await connection.read("session.snapshot");
      const panes=observed.terminals.map(t=>{
        const pane=raw.snapshot.panes.find((p:any)=>p.pane_id===t.paneId && p.terminal_id===t.terminalId);if(!pane)throw Error("STALE_SNAPSHOT");
        return commandPane.parse({paneId:t.paneId,terminalId:t.terminalId,workspaceId:pane.workspace_id,processEvidence:t.state==="observed"?"complete":"unavailable",
          ...(t.shell?{shellProcess:t.shell}:{}),...(t.state==="observed"?{foregroundProcesses:t.foreground}:{})});
      });
      const capturedAt=Date.now();return spool.parse({snapshotId:crypto.randomUUID(),serverBindingId:p.serverBindingId,fingerprint,capturedAt,expiresAt:capturedAt+retentionMs,panes});
    });
    writeLocked(join(root,saved.snapshotId+'.json'),saved);
  }
  const offset=p.cursor?.nextOffset??0,panes:typeof saved.panes=[];
  while(offset+panes.length<saved.panes.length && panes.length<p.pageSize){const next=saved.panes[offset+panes.length];if(Buffer.byteLength(JSON.stringify([...panes,next]))>60*1024)break;panes.push(next);}
  const nextOffset=offset+panes.length;
  const result={kind:"snapshot" as const,observedAt:saved.capturedAt,serverBindingId:p.serverBindingId,snapshotId:saved.snapshotId,panes,
    ...(nextOffset<saved.panes.length?{nextCursor:{snapshotId:saved.snapshotId,nextOffset}}:{}),...(p.verificationRequestId?{verificationRequestId:p.verificationRequestId}:{})};
  encode(result);return result;
}
