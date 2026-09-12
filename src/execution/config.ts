import { z } from "zod";
import { launchRecord } from "@ultra-herdr/api";
const processSchema=z.object({pid:z.number().int().positive(),startIdentity:z.string()}).strict();
export const executionConfig=z.object({timing:z.object({commandLeaseMs:z.number().int().positive(),commandRenewIntervalMs:z.number().int().positive(),localLeaseGuardMs:z.number().int().positive(),snapshotRetentionMs:z.number().int().positive()}).strict(),
  launch:launchRecord.optional(),discoveryId:z.string().optional(),workingDirectory:z.string().optional(),launchContextId:z.string().nullable().optional(),
  targetIdentity:z.object({terminalId:z.string(),shell:processSchema,anchor:processSchema.optional(),paneId:z.string().optional(),state:z.enum(["observed","unavailable"]).optional(),foreground:z.array(processSchema).optional(),discoveryProfileId:z.string().optional()}).strict().nullable().optional()
}).strict();
export type ExecutionConfig=z.infer<typeof executionConfig>;
export function shellQuote(value:string) {if(/[\u0000\r\n]/.test(value))throw Error("Invalid bootstrap field.");return "'"+value.replaceAll("'","'\\''")+"'";}
export function bootstrap(config:ExecutionConfig,paneId:string) {
  const p=config.launch;if(!p)throw Error("Missing launch profile.");
  const slot=(value:string)=>value.replaceAll("{{launchContext}}",()=>{if(!config.launchContextId)throw Error("Missing launch binding.");return config.launchContextId;});
  const cwd=p.bootstrap.cwd==="{{workingDirectory}}"?config.workingDirectory:p.bootstrap.cwd;
  if(!cwd?.startsWith("/"))throw Error("Missing working directory.");
  const environment:Record<string,string>={};
  for(const key of p.bootstrap.environment.inherit) if(process.env[key]!==undefined)environment[key]=process.env[key]!;
  for(const [key,value] of Object.entries(p.bootstrap.environment.set))environment[key]=slot(value);
  if(p.bootstrap.environment.inherit.includes("HERDR_PANE_ID"))environment.HERDR_PANE_ID=paneId;
  // Never forward cloud deployment authority, including accidentally inherited setup state.
  for(const key of ["CONVEX_SELF_HOSTED_ADMIN_KEY","CONVEX_DEPLOY_KEY","HERDR_PLUGIN_CONFIG_DIR","ULTRA_START_ATTEMPT","ULTRA_START_NONCE"])delete environment[key];
  const words=["env","-i",...Object.entries(environment).map(([key,value])=>`${key}=${value}`),...p.bootstrap.argv.map(slot)];
  const command=`cd -- ${shellQuote(cwd)} && ${words.map(shellQuote).join(" ")}`;
  if(Buffer.byteLength(command)>65536)throw Error("Bootstrap exceeds transport limit.");return command;
}
