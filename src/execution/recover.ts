import {existsSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {runtimeApi,PROTOCOL_VERSION,commandReceipt,commandPhase,commandAttempt,commandPayload} from "@ultra-herdr/api";
import {readJson,writeLocked} from "../auth/storage";
import {protectedDirectory} from "../runtime/config";
import {observe} from "../runtime/observation";
import {encode,loadJournal,saveJournal,observation,journalFile} from "./journal";
import {inspectClose} from "./close";
import type {ExecutorContext} from "./execute";
const process=z.object({pid:z.number().int().positive(),startIdentity:z.string()}).strict();
const identity=z.object({terminalId:z.string(),shell:process,anchor:process}).strict();
const binding=z.object({sessionId:z.string(),terminalId:z.string(),paneId:z.string(),shell:process,anchor:process,discoveryProfileId:z.string(),runtimeEpoch:z.number(),serverBindingId:z.string(),state:z.string(),closing:z.boolean(),current:z.boolean()}).strict();
const item=z.object({commandId:z.string(),protocolVersion:z.number(),state:z.string(),payload:z.unknown(),attempt:commandAttempt,leaseUntil:z.number(),started:z.boolean(),phaseIndex:z.number(),received:z.boolean(),targetIdentity:identity.nullable(),serverFingerprint:z.string().nullable()}).strict();
/** One bounded page per heartbeat. Retains uncertainty; never replays a Herdr write. */
export function recovery() {
  let bindingCursor:string|null=null,commandCursor:string|null=null;
  return async(ctx:ExecutorContext)=>{
    const local=await observe(ctx.settings);if(local.server.fingerprint!==ctx.fingerprint)throw Error("STALE_BINDING");
    const b=z.object({items:z.array(binding).max(32),cursor:z.string().nullable()}).strict().parse(JSON.parse((await ctx.client.query(runtimeApi.recoveryBindings,{...ctx.fence,cursor:bindingCursor})).canonical));bindingCursor=b.cursor;
    for(const known of b.items){
      const terminal=local.terminals.find(t=>t.terminalId===known.terminalId);
      const matches=terminal?.state==="observed" && terminal.shell?.pid===known.shell.pid && terminal.shell.startIdentity===known.shell.startIdentity &&
        [terminal.shell,...terminal.foreground].some(p=>p.pid===known.anchor.pid&&p.startIdentity===known.anchor.startIdentity);
      if(known.closing) {
        let closeAbsent=false;
        if(!terminal)try{closeAbsent=await inspectClose(ctx.settings,ctx.fingerprint,known.paneId,{targetIdentity:{terminalId:known.terminalId,shell:known.shell,anchor:known.anchor},timing:{commandLeaseMs:1,commandRenewIntervalMs:1,localLeaseGuardMs:1,snapshotRetentionMs:1}});}catch{/* No absence proof. */}
        await ctx.client.mutation(runtimeApi.refreshBinding,{...ctx.fence,sessionId:known.sessionId,requestId:crypto.randomUUID(),closeAbsent,...(terminal?{terminal:{...terminal,discoveryProfileId:known.discoveryProfileId}}:{})});
        continue;
      }
      if(matches && known.state==="verified" && known.current && known.paneId===terminal.paneId)continue;
      if(!matches && known.state==="unavailable")continue;
      await ctx.client.mutation(runtimeApi.refreshBinding,{...ctx.fence,sessionId:known.sessionId,requestId:crypto.randomUUID(),...(terminal?{terminal:{...terminal,discoveryProfileId:known.discoveryProfileId}}:{})});
    }
    const page=z.object({items:z.array(item).max(32),cursor:z.string().nullable()}).strict().parse(JSON.parse((await ctx.client.query(runtimeApi.recoveryCommands,{...ctx.fence,cursor:commandCursor})).canonical));commandCursor=page.cursor;
    let unresolved=0,received=0,blocked=0;
    for(const work of page.items) {
      try {
      if(work.protocolVersion!==PROTOCOL_VERSION)continue;
      if(work.attempt.runtime.instanceId===ctx.runtime.instanceId && work.leaseUntil>Date.now() && work.state!=="blocked")continue;
      if(!work.started)continue;
      unresolved++;if(work.received)received++;
      const p=commandPayload.parse((work.payload as any).purpose==="offer"?{...(work.payload as object),offerText:"historical-reference"}:work.payload);
      const phase=commandPhase.parse(p.op==="send"?`${p.purpose}.${work.phaseIndex===0?"text":"enter"}`:p.op);
      const path=journalFile(ctx.directory,work.commandId,work.attempt.attemptEpoch,phase);
      let record=loadJournal(path);
      if(record && (encode(record.attempt)!==encode(work.attempt) || record.machineId!==ctx.machineId || record.deploymentId!==ctx.deploymentId))throw Error("INVALID_JOURNAL");
      if(record?.state==="intent") {
        record={...record,state:"uncertain",recordGeneration:record.recordGeneration+1,error:{code:"RECOVERY_BLOCKED",phase,effect:"may_have_applied",detail:"Runtime interrupted after durable intent; no terminal write replayed.",evidence:[]}};saveJournal(path,record);
      }
      if(record && ["socket_ack","uncertain"].includes(record.state)) {
        const ref=await observation(ctx.directory,record);
        const result=await ctx.client.mutation(runtimeApi.act,{canonical:encode({action:"observe",requestId:record.error?`late-${record.reportRequestId}`:record.reportRequestId,attempt:record.attempt,observation:ref,summary:record.phaseResult??record.error})});
        record={...record,state:"cloud_ack",recordGeneration:record.recordGeneration+1,cloudReceipt:commandReceipt.parse(JSON.parse(result.canonical))};saveJournal(path,record);
      }
      // Intact absence on the same physical server permits current-authority
      // release confirmation. Missing/corrupt journal or changed identity blocks.
      if(p.op==="close" && record && work.targetIdentity && work.serverFingerprint===ctx.fingerprint) {
        const config={targetIdentity:work.targetIdentity,timing:{commandLeaseMs:1,commandRenewIntervalMs:1,localLeaseGuardMs:1,snapshotRetentionMs:1}};
        if(await inspectClose(ctx.settings,ctx.fingerprint,p.target.paneId,config)) {
          const dir=protectedDirectory(join(ctx.directory,"command-recovery")),file=join(dir,`${work.commandId}-${ctx.runtime.instanceId}.json`);
          const request=existsSync(file)?readJson(file):{requestId:crypto.randomUUID(),runtime:ctx.runtime,previous:work.attempt,target:p.target,fingerprint:ctx.fingerprint,identity:work.targetIdentity,absent:true,observedAt:Date.now()};
          writeLocked(file,request);await ctx.client.mutation(runtimeApi.recoverClose,{canonical:encode(request)});
        }
      }
      }catch{blocked++;}
    }
    return {unresolved,received,blocked};
  };
}
