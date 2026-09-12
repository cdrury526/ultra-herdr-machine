import {resolve} from "node:path";
import {dispatchApi,dispatchResultSchemas,parseJson,canonicalJson,jsonDigest} from "@ultra-herdr/api";
import {messageContext} from "../reports/context";
import {reportRequest} from "../reports/journal";
import {readReportFile,reportLimits,ReportError,reportFailure} from "../reports/input";
export async function dispatch(options:{config:string;input:string;requestFile:string}){
  try{
    const config=resolve(options.config),inputFile=resolve(options.input),requestFile=resolve(options.requestFile);
    if(requestFile===config||requestFile===inputFile)throw new ReportError("Use a separate protected dispatch request file.");
    const input=parseJson(readReportFile(inputFile),reportLimits,"dispatch");
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.hasOwn(input,"requestId"))throw new ReportError("Provide dispatch input as an object; the CLI generates requestId.");
    const {caller,profile,client}=await messageContext(config);
    const body={machineId:caller.machineId,...input},inputDigest=(await jsonDigest(body,reportLimits,"dispatch")).value;
    const requestId=await reportRequest(requestFile,{deploymentUrl:profile.convexUrl,machineId:caller.machineId,callerSessionId:caller.sessionId,kind:"dispatch",inputDigest});
    const result=dispatchResultSchemas.accept.parse(await client.mutation(dispatchApi.accept,{verificationId:caller.verificationRequestId,text:canonicalJson({...body,requestId},reportLimits,"dispatch")}));
    return {...JSON.parse(result.canonical),requestId};
  }catch(error){throw new ReportError(reportFailure(error).message.replace(/\breport\b/gi,"dispatch"));}
}
