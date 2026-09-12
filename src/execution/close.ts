import {join} from "node:path";
import type {CommandEnvelope} from "@ultra-herdr/api";
import {readFileSync} from "node:fs";
import {observe} from "../runtime/observation";
import {protectedDirectory,type Installation} from "../runtime/config";
import {writeLocked} from "../auth/storage";
import type {ExecutionConfig} from "./config";
import {effect} from "./local";
import {hash,type Journal} from "./journal";
function stillAlive(p:{pid:number;startIdentity:string}) {
  try {
    const stat=readFileSync(`/proc/${p.pid}/stat`,"utf8"),fields=stat.slice(stat.lastIndexOf(")")+1).trim().split(/\s+/);
    if(fields.length<20 || !/^\d+$/.test(fields[19]))throw Error("Process identity unavailable.");
    return fields[19]===p.startIdentity && !["Z","X","x"].includes(fields[0]);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")return false;
    // A failed /proc read is not proof of process exit.
    throw error;
  }
}
export async function inspectClose(settings:Installation,fingerprint:string,paneId:string,config:ExecutionConfig) {
  const proof=config.targetIdentity;if(!proof?.anchor)throw Error("STALE_BINDING");
  const current=await observe(settings);if(current.server.fingerprint!==fingerprint)throw Error("STALE_BINDING");
  const terminal=current.terminals.find(t=>t.terminalId===proof.terminalId);
  if(terminal) {
    if(terminal.paneId!==paneId || terminal.state!=="observed" || terminal.shell?.pid!==proof.shell.pid || terminal.shell.startIdentity!==proof.shell.startIdentity ||
      ![terminal.shell,...terminal.foreground].some(p=>p.pid===proof.anchor!.pid && p.startIdentity===proof.anchor!.startIdentity))throw Error("STALE_BINDING");
    return false;
  }
  if(current.terminals.some(t=>t.paneId===paneId) || stillAlive(proof.shell) || stillAlive(proof.anchor))throw Error("TARGET_UNAVAILABLE");
  return true;
}
export async function closeTarget(settings:Installation,directory:string,fingerprint:string,p:Extract<CommandEnvelope["payload"],{op:"close"}>,config:ExecutionConfig,record:Journal,beforeWrite:()=>void) {
  const absent=await inspectClose(settings,fingerprint,p.target.paneId,config);
  if(!absent)await effect(settings,fingerprint,{method:"pane.close",params:{pane_id:p.target.paneId}},record.rpcRequestId,beforeWrite);
  const until=performance.now()+settings.policy.inspectionTimeoutMs;
  for(;;){
    try{if(await inspectClose(settings,fingerprint,p.target.paneId,config))break;}
    catch(error){if(!(error instanceof Error) || error.message!=="TARGET_UNAVAILABLE")throw error;}
    if(performance.now()>=until)throw Error("RPC_UNCERTAIN");
    await new Promise(resolve=>setTimeout(resolve,Math.min(settings.policy.retryIntervalMs,until-performance.now())));
  }
  const observedAt=Date.now(),body={machineId:record.machineId,attempt:record.attempt,target:p.target,fingerprint,identity:config.targetIdentity,absent:true,observedAt};
  const observationId=crypto.randomUUID(),digest=await hash(body);
  writeLocked(join(protectedDirectory(join(directory,"command-close-observations")),observationId+'.json'),body);
  return {kind:"close" as const,observedAt,releaseAttemptId:p.releaseAttemptId,target:p.target,outcome:absent?"already_absent" as const:"closed" as const,evidence:{observationId,digest}};
}
