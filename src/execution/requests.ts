import { join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { ConvexClient } from "convex/browser";
import { commandRequest,runtimeApi,type CommandRequest } from "@ultra-herdr/api";
import { readJson,writeLocked } from "../auth/storage";
import { protectedDirectory } from "../runtime/config";
import { encode } from "./journal";
const saved=z.object({runtime:z.string(),startedAt:z.number().nonnegative(),request:commandRequest}).strict();
/** Persist request identity and its original monotonic start before cloud I/O. No ticket-bearing responses on disk. */
export function requests(client:ConvexClient,directory:string,commandId:string,runtime:string) {
  const root=protectedDirectory(join(directory,"command-requests",commandId));
  return async(key:string,make:(requestId:string)=>CommandRequest)=>{
    if(!/^[a-z0-9.-]+$/.test(key))throw Error("Invalid request journal key.");
    const file=join(root,`${key}.json`);
    const value=existsSync(file)?saved.parse(readJson(file)):saved.parse({runtime,startedAt:performance.now(),request:make(crypto.randomUUID())});
    if(value.runtime!==runtime || encode(value.request)!==encode(make(value.request.requestId)))throw Error("RECOVERY_BLOCKED");
    if(!existsSync(file))writeLocked(file,value);
    const response=await client.mutation(runtimeApi.act,{canonical:encode(value.request)});
    return {value:JSON.parse(response.canonical),startedAt:value.startedAt};
  };
}
