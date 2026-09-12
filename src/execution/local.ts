import { withVerifiedHerdr,type RuntimeOperation } from "../herdr/verified-connection";
import { observe } from "../runtime/observation";
import type { Installation } from "../runtime/config";
import type { CommandEnvelope } from "@ultra-herdr/api";
import type { ExecutionConfig } from "./config";
export async function localTarget(settings:Installation,config:ExecutionConfig,expectedServer:string) {
  const observed=await observe(settings);
  if(observed.server.fingerprint!==expectedServer)throw Error("STALE_BINDING");
  const proof=config.targetIdentity;
  if(!proof)return {observed,terminal:null};
  const matches=observed.terminals.filter(t=>t.terminalId===proof.terminalId && t.shell?.pid===proof.shell.pid && t.shell.startIdentity===proof.shell.startIdentity);
  if(matches.length!==1 || matches[0].state!=="observed")throw Error("TARGET_UNAVAILABLE");
  const t=matches[0];
  if(proof.anchor && !t.foreground.some(f=>f.pid===proof.anchor!.pid && f.startIdentity===proof.anchor!.startIdentity))throw Error("TARGET_UNAVAILABLE");
  return {observed,terminal:t};
}
export async function effect(settings:Installation,fingerprint:string,op:RuntimeOperation,requestId:string) {
  return withVerifiedHerdr({socketPath:settings.socketPath,sessionName:settings.sessionName,uid:process.getuid!(),timeoutMs:settings.policy.inspectionTimeoutMs,maxResponseBytes:settings.policy.maxResponseBytes},async(connection,server)=>{
    if(server.fingerprint!==fingerprint)throw Error("STALE_BINDING");return connection.execute(op,requestId);
  });
}
export async function screen(settings:Installation,fingerprint:string,paneId:string,lines:number,maxBytes:number) {
  const value:any=await withVerifiedHerdr({socketPath:settings.socketPath,sessionName:settings.sessionName,uid:process.getuid!(),timeoutMs:settings.policy.inspectionTimeoutMs,maxResponseBytes:settings.policy.maxResponseBytes},async(connection,server)=>{
    if(server.fingerprint!==fingerprint)throw Error("STALE_BINDING");return connection.screen(paneId,lines);
  });
  const text=value?.read?.text;if(typeof text!=="string" || Buffer.byteLength(text)>maxBytes)throw Error("READINESS_BLOCKED");return text;
}
export function target(e:CommandEnvelope) {const p=e.payload;return p.op==="split"?p.anchor:p.op!=="snapshot"?p.target:undefined;}
export async function wait(ms:number,signal:AbortSignal) {if(signal.aborted)throw Error("RUNTIME_STOPPED");await new Promise<void>((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);signal.removeEventListener("abort",stop);reject(Error("RUNTIME_STOPPED"));};
  const timer=setTimeout(()=>{signal.removeEventListener("abort",stop);resolve();},ms);signal.addEventListener("abort",stop,{once:true});
});}

export async function foregroundAnchor(settings:Installation,fingerprint:string,paneId:string,foreground:{pid:number;startIdentity:string}[]) {
  const raw:any=await withVerifiedHerdr({socketPath:settings.socketPath,sessionName:settings.sessionName,uid:process.getuid!(),timeoutMs:settings.policy.inspectionTimeoutMs,maxResponseBytes:settings.policy.maxResponseBytes},async(connection,server)=>{
    if(server.fingerprint!==fingerprint)throw Error("STALE_BINDING");return connection.read("pane.process_info",paneId);
  });
  const matches=foreground.filter(p=>p.pid===raw?.process_info?.foreground_process_group_id);
  if(matches.length!==1)throw Error("READINESS_BLOCKED");return matches[0];
}
