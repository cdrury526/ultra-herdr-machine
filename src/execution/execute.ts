import { z } from "zod";
import type { ConvexClient } from "convex/browser";
import { runtimeApi,commandEnvelope,commandAttempt,commandLease,commandReceipt,commandPhases,commandPhaseResult,type CommandPhase,type CommandEnvelope,type CommandRequest,type CommandSuccess } from "@ultra-herdr/api";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readJson,writeLocked } from "../auth/storage";
import { protectedDirectory,type Installation } from "../runtime/config";
import { observe } from "../runtime/observation";
import { executionConfig,bootstrap } from "./config";
import { localTarget,effect,screen,target,wait,foregroundAnchor } from "./local";
import { encode,hash,journalFile,loadJournal,saveJournal,observation,type Journal } from "./journal";
const claimSchema=z.object({attempt:commandAttempt,lease:commandLease,nextPhase:z.string(),configuration:executionConfig,envelope:commandEnvelope}).strict();
export interface ExecutorContext {client:ConvexClient;settings:Installation;directory:string;machineId:string;deploymentId:string;runtime:{instanceId:string;epoch:number};fence:{runtimeEpoch:number;recoveryEpoch:number};fingerprint:string;signal:AbortSignal}
export async function executeCommand(ctx:ExecutorContext,commandId:string) {
  const {client,settings,signal}=ctx;
  const act=async(request:CommandRequest)=>JSON.parse((await client.mutation(runtimeApi.act,{canonical:encode(request)})).canonical);
  const read=JSON.parse((await client.query(runtimeApi.readCommand,{...ctx.fence,commandId})).canonical);
  const envelope=commandEnvelope.parse(read.envelope),config=executionConfig.parse(read.configuration);
  const {commandDigest,...unsigned}=envelope;
  if(envelope.targetMachineId!==ctx.machineId || encode(await hash(unsigned))!==encode(commandDigest))throw Error("INVALID_COMMAND");
  const requestFile=join(protectedDirectory(join(ctx.directory,"command-requests")),`${commandId}.json`);
  let request=existsSync(requestFile)?z.object({runtime: z.string(),requestId:z.string().uuid()}).strict().parse(readJson(requestFile)):null;
  if(request && request.runtime!==ctx.runtime.instanceId)throw Error("RECOVERY_BLOCKED");
  if(!request){request={runtime:ctx.runtime.instanceId,requestId:crypto.randomUUID()};writeLocked(requestFile,request);}
  let sent=performance.now();const claim=claimSchema.parse(await act({action:"claim",commandId,runtime:ctx.runtime,requestId:request.requestId}));
  let deadline=sent+claim.lease.durationMs-config.timing.localLeaseGuardMs;
  const phaseResults:NonNullable<Journal["phaseResult"]>[]=[];
  async function authority() {
    if(signal.aborted)throw Error("RUNTIME_STOPPED");
    if(performance.now()+config.timing.commandRenewIntervalMs>=deadline){sent=performance.now();const renewed=await act({action:"renew",attempt:claim.attempt,requestId:crypto.randomUUID()});deadline=sent+commandLease.parse(renewed.lease).durationMs-config.timing.localLeaseGuardMs;}
    if(performance.now()>=deadline)throw Error("LEASE_EXPIRED");
  }
  async function sleep(ms:number) {let remaining=ms;while(remaining>0){await authority();const part=Math.min(remaining,config.timing.commandRenewIntervalMs/2);await wait(part,signal);remaining-=part;}}
  for(const phase of commandPhases(envelope.payload)) {
    const path=journalFile(ctx.directory,commandId,claim.attempt.attemptEpoch,phase);
    let record=loadJournal(path);
    if(record && (record.machineId!==ctx.machineId || record.deploymentId!==ctx.deploymentId || encode(record.attempt)!==encode(claim.attempt) || encode(record.commandDigest)!==encode(envelope.commandDigest)))throw Error("INVALID_JOURNAL");
    if(record?.state==="intent" || record?.state==="uncertain")throw Error("RECOVERY_BLOCKED");
    if(!record) {
      await authority();
      const local=await localTarget(settings,config,ctx.fingerprint),route=target(envelope);
      if(route && local.terminal?.paneId!==route.paneId)throw Error("STALE_BINDING");
      sent=performance.now();const start=await act({action:"start",requestId:crypto.randomUUID(),attempt:claim.attempt,phase,commandDigest:envelope.commandDigest});
      deadline=sent+commandLease.parse(start.lease).durationMs-config.timing.localLeaseGuardMs;
      await authority();
      record={journalVersion:1,recordGeneration:1,deploymentId:ctx.deploymentId,machineId:ctx.machineId,attempt:claim.attempt,phase,commandDigest:envelope.commandDigest,
        serverBindingId:route?.serverBindingId??(envelope.payload as {serverBindingId:string}).serverBindingId,...(route?{target:route}:{}),rpcRequestId:crypto.randomUUID(),reportRequestId:crypto.randomUUID(),state:"intent",recordedAt:Date.now()};
      saveJournal(path,record);
      try {
        const p=envelope.payload;let result:unknown;
        if(p.op==="split") {
          const cwd=config.launch?.bootstrap.cwd==="{{workingDirectory}}"?config.workingDirectory:config.launch?.bootstrap.cwd;
          if(!cwd)throw Error("Missing launch cwd.");
          const raw:any=await effect(settings,ctx.fingerprint,{method:"pane.split",params:{target_pane_id:p.anchor.paneId,direction:p.direction,...(p.ratio?{ratio:p.ratio}:{}),cwd,focus:false,env:{ULTRA_HERDR_ALLOCATION:p.allocationId}}},record.rpcRequestId);
          const paneId=z.string().min(1).parse(raw.pane?.pane_id);
          result={kind:"split",observedAt:Date.now(),allocationId:p.allocationId,newSessionId:p.newSessionId,serverBindingId:p.anchor.serverBindingId,paneId,rpcRequestId:record.rpcRequestId};
        } else if(p.op==="send") {
          if(phase.endsWith(".text")) await effect(settings,ctx.fingerprint,{method:"pane.send_text",params:{pane_id:p.target.paneId,text:p.purpose==="bootstrap"?bootstrap(config,p.target.paneId):p.offerText}},record.rpcRequestId);
          else await effect(settings,ctx.fingerprint,{method:"pane.send_keys",params:{pane_id:p.target.paneId,keys:["enter"]}},record.rpcRequestId);
          result={kind:"input_phase_ack",observedAt:Date.now(),purpose:p.purpose,target:p.target,phase,rpcRequestId:record.rpcRequestId};
        } else throw Error("Handler not installed.");
        record={...record,recordGeneration:record.recordGeneration+1,state:"socket_ack",phaseResult:commandPhaseResult.parse(result)};saveJournal(path,record);
      } catch {
        record={...record,recordGeneration:record.recordGeneration+1,state:"uncertain",phaseResult:undefined,error:{code:"RPC_UNCERTAIN",phase,effect:"may_have_applied",detail:"Herdr effect not confirmed; preserve the phase journal and reconcile before another write.",evidence:[]}};saveJournal(path,record);
        await act({action:"fail",requestId:record.reportRequestId,attempt:claim.attempt,error:record.error!});throw Error("RPC_UNCERTAIN");
      }
    }
    if(record.state==="socket_ack") {
      const reference=await observation(ctx.directory,record);
      const receipt=commandReceipt.parse(await act({action:"observe",requestId:record.reportRequestId,attempt:claim.attempt,observation:reference,summary:record.phaseResult!}));
      record={...record,recordGeneration:record.recordGeneration+1,state:"cloud_ack",cloudReceipt:receipt};saveJournal(path,record);
    }
    phaseResults.push(record.phaseResult!);
    if(phase.endsWith(".text"))await sleep(envelope.payload.op==="send"&&envelope.payload.purpose==="bootstrap"?config.launch!.bootstrap.input.submitDelayMs:config.launch!.delivery.submitDelayMs);
  }
  const p=envelope.payload;
  if(p.op==="send"&&p.purpose==="bootstrap") {
    try {
      await sleep(config.launch!.bootstrap.waitMs);
      const readiness=config.launch!.readiness,until=performance.now()+(readiness.kind==="screen-text"?readiness.timeoutMs:0);
      for(;;){await authority();const text=await screen(settings,ctx.fingerprint,p.target.paneId,readiness.tailLines,readiness.maxBytes);
        if(readiness.blockedAny.some(marker=>text.includes(marker)))throw Error("READINESS_BLOCKED");
        if(readiness.kind==="configured-wait" || readiness.readyAll.every(marker=>text.includes(marker)))break;
        if(performance.now()>=until)throw Error("READINESS_BLOCKED");await sleep(readiness.pollMs);
      }
      const current=await observe(settings),terminal=current.terminals.find(t=>t.paneId===p.target.paneId);
      if(current.server.fingerprint!==ctx.fingerprint || !terminal?.shell)throw Error("STALE_BINDING");
      const foreground=terminal.foreground.filter(f=>f.pid!==terminal.shell!.pid);if(!foreground.length)throw Error("READINESS_BLOCKED");
      // A foreground group leader is process evidence; labels and screen text alone never bind a worker.
      const anchor=await foregroundAnchor(settings,ctx.fingerprint,p.target.paneId,foreground);
      await client.mutation(runtimeApi.verifyCommandBinding,{...ctx.fence,commandId,requestId:crypto.randomUUID(),stage:"activate",terminal:{...terminal,discoveryProfileId:config.discoveryId!},anchor});
    }catch{await act({action:"fail",requestId:crypto.randomUUID(),attempt:claim.attempt,error:{code:"READINESS_BLOCKED",phase:"bootstrap.enter",effect:"may_have_applied",detail:"Input acknowledged but readiness or launch binding is blocked; do not rebootstrap.",evidence:[]}});throw Error("READINESS_BLOCKED");}
  }
  const result:CommandSuccess=p.op==="send"?{kind:"input_ack",observedAt:Date.now(),purpose:p.purpose,target:p.target,acks:phaseResults.map(r=>({phase:(r as {phase:CommandPhase}).phase,rpcRequestId:(r as {rpcRequestId:string}).rpcRequestId}))}:phaseResults[0] as CommandSuccess;
  const resultFile=join(protectedDirectory(join(ctx.directory,"command-results")),`${commandId}-${claim.attempt.attemptEpoch}.json`);
  const final=existsSync(resultFile)?readJson(resultFile) as {requestId:string;result:CommandSuccess}:{requestId:crypto.randomUUID(),result};
  writeLocked(resultFile,final);await authority();await act({action:"succeed",requestId:final.requestId,attempt:claim.attempt,result:final.result});
  if(p.op==="split" && result.kind==="split") {
    const current=await observe(settings),terminal=current.terminals.find(t=>t.paneId===result.paneId);
    if(current.server.fingerprint!==ctx.fingerprint || !terminal?.shell)throw Error("STALE_BINDING");
    await client.mutation(runtimeApi.verifyCommandBinding,{...ctx.fence,commandId,requestId:crypto.randomUUID(),stage:"prepare",terminal:{...terminal,discoveryProfileId:config.discoveryId!}});
  }
}
