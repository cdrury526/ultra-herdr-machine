import { catalogApi as api } from "@ultra-herdr/api";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { operatorClient, type CatalogClient, type Release } from "./client";
import { canonical, digest, writeNew } from "./files";
export function releaseFile(path: string): Release {
  return z.object({ releaseId: z.string().min(1), manifestDigest: z.string().regex(/^[0-9a-f]{64}$/) }).parse(JSON.parse(readFileSync(path, "utf8")));
}
export async function* entries(client: CatalogClient, release: Release) {
  let cursor: string | null = null;
  do {
    const page: { entries: Array<{ kind: string; key: string; revision: number; bodyDigest: string }>; cursor: string | null } =
      JSON.parse((await client.query(api.entries, { ...release, ...(cursor ? { cursor } : {}) })).canonical);
    for (const entry of page.entries) yield entry;
    cursor = page.cursor;
  } while (cursor);
}
export async function validateCatalog(profile: string, selected: Release) {
  const client = await operatorClient(profile);
  await client.query(api.exportManifest, selected);
  const runId = await client.mutation(api.validationStart, { releaseId: selected.releaseId });
  let scan = await client.mutation(api.validationScan, { runId, expectedCount: 0 });
  while (scan.state === "entries") scan = await client.mutation(api.validationScan, { runId, expectedCount: scan.processedCount });
  if (scan.state === "entries_complete") {
    for await (const entry of entries(client, selected)) if (entry.kind === "brief") {
      const buildId = await client.mutation(api.planStart, { runId, briefKey: entry.key });
      let plan = await client.mutation(api.planStep, { buildId, expectedRules: 0 });
      while (plan.state === "collecting") plan = await client.mutation(api.planStep, { buildId, expectedRules: plan.processedRules });
      if (plan.state === "rejected") break;
    }
    const status = JSON.parse((await client.query(api.validationStatus, { runId })).canonical);
    if (status.state !== "rejected") {
      const coverageId = await client.mutation(api.coverageStart, { runId });
      let coverage = await client.mutation(api.coverageStep, { coverageId, expectedSequence: 0 });
      while (!["validated", "rejected"].includes(coverage.stage)) coverage = await client.mutation(api.coverageStep, { coverageId, expectedSequence: coverage.sequence });
    }
  }
  const result = JSON.parse((await client.query(api.validationStatus, { runId })).canonical);
  if (result.state !== "validated") { console.log(JSON.stringify(result, null, 2)); throw new Error("Catalog validation rejected. Inspect the reported issue and stage a corrected release."); }
  return result;
}
export async function exportCatalog(profile: string, selected: Release, output: string) {
  const client = await operatorClient(profile), manifest = JSON.parse((await client.query(api.exportManifest, selected)).canonical);
  const { manifestDigest, ...hashed } = manifest;
  if (digest(hashed) !== manifestDigest || manifestDigest !== selected.manifestDigest) throw new Error("Export manifest verification failed.");
  await writeNew(output, async write => {
    write(canonical({ format: "herdr-catalog-file-1", manifest }) + "\n");
    let cursor: string | null = null, count = 0, page = 0, tuples: unknown[] = [];
    do {
      const record: { entry: { kind: string; key: string; revision: number; bodyDigest: string }; body: string; cursor: string | null } =
        await client.query(api.exportRecord, { ...selected, ...(cursor ? { cursor } : {}) });
      const body = JSON.parse(record.body);
      if (canonical(body) !== record.body || digest(body) !== record.entry.bodyDigest) throw new Error("Export body verification failed.");
      write(canonical({ ...record.entry, body }) + "\n"); tuples.push(record.entry); count++; cursor = record.cursor;
      if (tuples.length === 64 || !cursor) {
        if (digest(tuples) !== manifest.pageDigests[page++]) throw new Error("Export page verification failed.");
        tuples = [];
      }
    } while (cursor);
    if (count !== manifest.entryCount || page !== manifest.pageDigests.length) throw new Error("Export snapshot is incomplete.");
  });
  return { ...selected, output };
}
