import { z } from "zod";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { commandAttempt,commandPhase,commandDigest,commandRoute,commandPhaseResult,commandFailure,commandReceipt, jsonDigest,canonicalJson } from "@ultra-herdr/api";
import { protectedDirectory } from "../runtime/config";
import { readJson,writeLocked } from "../auth/storage";
const limits={maxBytes:65536,maxDepth:32,maxNodes:16384};
export const encode=(value:unknown)=>canonicalJson(value,limits,"machine.command");
export const hash=async(value:unknown)=>{const {byteLength,...digest}=await jsonDigest(value,limits,"machine.command");return digest;};
export const journalSchema=z.object({journalVersion:z.literal(1),recordGeneration:z.number().int().positive(),deploymentId:z.string(),machineId:z.string(),
  attempt:commandAttempt,phase:commandPhase,commandDigest,serverBindingId:z.string(),target:commandRoute.optional(),rpcRequestId:z.string().uuid(),reportRequestId:z.string().uuid(),
  state:z.enum(["intent","socket_ack","cloud_ack","uncertain"]),recordedAt:z.number().int().nonnegative(),phaseResult:commandPhaseResult.optional(),error:commandFailure.optional(),cloudReceipt:commandReceipt.optional()
}).strict().superRefine((r,c)=>{
  const hasResult=Boolean(r.phaseResult),hasError=Boolean(r.error),hasReceipt=Boolean(r.cloudReceipt);
  if((r.state==="intent"&&(hasResult||hasError||hasReceipt)) || (r.state==="socket_ack"&&(!hasResult||hasError||hasReceipt)) ||
    (r.state==="uncertain"&&(!hasError||hasResult||hasReceipt)) || (r.state==="cloud_ack"&&(!hasReceipt||hasResult===hasError)))c.addIssue({code:"custom",message:"Invalid journal state evidence."});
});
export type Journal=z.infer<typeof journalSchema>;
export function journalFile(directory:string,commandId:string,epoch:number,phase:string) {
  if(!/^[a-zA-Z0-9_-]{1,256}$/.test(commandId)||!Number.isSafeInteger(epoch)||epoch<1||!commandPhase.safeParse(phase).success)throw Error("Invalid journal identity.");
  return join(protectedDirectory(join(directory,"command-journal")),`${commandId}-${epoch}-${phase}.json`);
}
export function loadJournal(path:string) {return existsSync(path)?journalSchema.parse(readJson(path)):null;}
export function saveJournal(path:string,record:Journal) {const r=journalSchema.parse(record);encode(r);writeLocked(path,r);}
export async function observation(directory:string,record:Journal) {
  const observationId=record.reportRequestId,body={machineId:record.machineId,attempt:record.attempt,phase:record.phase,
    rpcRequestId:record.rpcRequestId,...(record.phaseResult?{result:record.phaseResult}:{error:record.error})};
  const digest=await hash(body);writeLocked(join(protectedDirectory(join(directory,"command-observations")),`${observationId}.json`),body);return {observationId,digest};
}
