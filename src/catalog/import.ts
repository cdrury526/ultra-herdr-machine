import { existsSync } from "node:fs";
import { catalogApi as api } from "@ultra-herdr/api";
import { z } from "zod";
import { loadProfile, clientFor } from "../auth/client";
import { withCredentialLock, readJson, writeLocked } from "../auth/storage";
import { batches, digest } from "./files";
const stateSchema = z.object({ requestId: z.string(), inputDigest: z.string(), operatorId: z.string(), deployment: z.string(),
  expectedHead: z.object({ releaseId: z.string().nullable(), generation: z.number().int().nonnegative() }) }).strict();
export async function importCatalog(options: { profile: string; file: string; request: string; mode: string; note: string }) {
  if (!["replace", "patch"].includes(options.mode)) throw new Error("Import mode must explicitly be replace or patch.");
  const profile = await loadProfile(options.profile, "operator"), client = clientFor(profile), descriptors: Array<{ count: number; digest: string }> = [];
  for await (const batch of batches(options.file)) descriptors.push({ count: batch.count, digest: batch.digest });
  const input = { format: "herdr-catalog-1", mode: options.mode, note: options.note, batches: descriptors }, inputDigest = digest(input);
  return withCredentialLock(options.request, async path => {
    let saved: z.infer<typeof stateSchema>;
    if (existsSync(path)) {
      saved = stateSchema.parse(readJson(path));
      if (saved.inputDigest !== inputDigest || saved.operatorId !== profile.principalId || saved.deployment !== profile.convexUrl)
        throw new Error("Saved catalog request belongs to different content, deployment or operator. Use its original inputs or a new request file.");
    } else {
      saved = { requestId: crypto.randomUUID(), inputDigest, operatorId: profile.principalId, deployment: profile.convexUrl, expectedHead: await client.query(api.head, {}) };
      writeLocked(path, saved);
    }
    const start = { requestId: saved.requestId, expectedHead: saved.expectedHead, text: JSON.stringify(input) };
    if (options.mode === "replace") {
      const importId = await client.mutation(api.importStart, start), status = await client.query(api.importStatus, { importId });
      if (status.state !== "sealed") {
        let index = 0;
        for await (const batch of batches(options.file)) {
          if (batch.digest !== descriptors[index]?.digest) throw new Error("Input file changed during import. Preserve the saved request and restore its original content.");
          if (index >= status.nextBatch) await client.mutation(api.importUpload, { importId, batch: index, text: batch.text });
          index++;
        }
      }
      return client.mutation(api.importSeal, { importId });
    }
    const patchId = await client.mutation(api.patchStart, start); let status = await client.query(api.patchStatus, { patchId });
    if (status.state === "uploading") {
      let index = 0;
      for await (const batch of batches(options.file)) {
        if (batch.digest !== descriptors[index]?.digest) throw new Error("Input file changed during patch staging. Restore its original content before retrying.");
        if (index >= status.nextBatch) await client.mutation(api.patchUpload, { patchId, batch: index, text: batch.text });
        index++;
      }
      status = await client.query(api.patchStatus, { patchId });
    }
    while (status.state !== "sealed") {
      const step = await client.mutation(api.patchStep, { patchId, expectedSequence: status.sequence });
      status = { ...status, ...step };
    }
    return { releaseId: status.releaseId!, manifestDigest: status.manifestDigest! };
  });
}
