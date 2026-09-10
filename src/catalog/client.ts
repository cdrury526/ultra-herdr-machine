import { ConvexError } from "convex/values";
import { operatorClient } from "../auth/operator";
export type CatalogClient = Awaited<ReturnType<typeof operatorClient>>;
export class CatalogError extends Error {}
export async function catalogOperation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof ConvexError) {
      const data = error.data as any;
      const code = typeof data?.code === "string" && /^[A-Z_]{1,64}$/.test(data.code) ? data.code : "CATALOG_ERROR";
      const issue = data?.issues?.[0];
      const detail = issue && typeof issue.code === "string" && /^[A-Z_]{1,64}$/.test(issue.code) ? `/${issue.code}` : "";
      const path = issue && typeof issue.path === "string" ? ` at ${JSON.stringify(issue.path.slice(0, 512))}` : "";
      throw new CatalogError(`${code}${detail}${path}. Correct the field or refresh the catalog head and review.`);
    }
    throw error;
  }
}
export { operatorClient };
export function print(value: unknown) { console.log(JSON.stringify(value, null, 2)); }
export type Release = { releaseId: string; manifestDigest: string };
export type Head = { releaseId: string | null; generation: number };
