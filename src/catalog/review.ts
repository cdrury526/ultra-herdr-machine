import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { catalogApi as api } from "@ultra-herdr/api";
import { loadProfile, clientFor } from "../auth/client";
import { withCredentialLock, readJson, writeLocked } from "../auth/storage";
import { digest, maxBytes } from "./files";
import { releaseFile } from "./read";
export const reviewResult = z.object({ reviewId: z.string(), reviewDigest: z.string(), manifestDigest: z.string(),
  expectedHead: z.object({ releaseId: z.string().nullable(), generation: z.number().int().nonnegative() }) });
export async function reviewCatalog(options: { profile: string; release: string; brief: string; sample: string; note: string; request: string }) {
  const profile = await loadProfile(options.profile, "operator"), client = clientFor(profile), selected = releaseFile(options.release);
  const text = readFileSync(options.sample, "utf8");
  if (Buffer.byteLength(text) > maxBytes) throw new Error("Preview sample exceeds 1 MiB.");
  const inputDigest = digest({ selected, brief: options.brief, sample: JSON.parse(text), note: options.note });
  return withCredentialLock(options.request, async path => {
    const shape = z.object({ requestId: z.string(), inputDigest: z.string(), operatorId: z.string(), deployment: z.string(),
      expectedHead: reviewResult.shape.expectedHead, previewId: z.string().optional() }).strict();
    let saved: z.infer<typeof shape>;
    if (existsSync(path)) {
      saved = shape.parse(readJson(path));
      if (saved.inputDigest !== inputDigest || saved.operatorId !== profile.principalId || saved.deployment !== profile.convexUrl)
        throw new Error("Saved review request differs from this content, operator or deployment. Use a new request file for a new review.");
    } else {
      saved = { requestId: crypto.randomUUID(), inputDigest, operatorId: profile.principalId, deployment: profile.convexUrl, expectedHead: await client.query(api.head, {}) };
      writeLocked(path, saved);
    }
    if (!saved.previewId) {
      const preview = await client.mutation(api.preview, { ...selected, briefKey: options.brief, text });
      saved.previewId = preview.previewId; writeLocked(path, saved);
    }
    const reviewId = await client.mutation(api.reviewStart, { ...selected, expectedHead: saved.expectedHead, requestId: saved.requestId, previewId: saved.previewId, note: options.note });
    let status = await client.mutation(api.reviewStep, { reviewId, expectedSequence: 0 });
    while (status.stage !== "complete") status = await client.mutation(api.reviewStep, { reviewId, expectedSequence: status.sequence });
    return { reviewId, reviewDigest: status.reviewDigest!, manifestDigest: selected.manifestDigest, expectedHead: saved.expectedHead, previewId: saved.previewId };
  });
}
export async function applyCatalog(options: { profile: string; review: string; request: string }) {
  const profile = await loadProfile(options.profile, "operator"), client = clientFor(profile);
  const review = reviewResult.parse(JSON.parse(readFileSync(options.review, "utf8"))), inputDigest = digest(review);
  return withCredentialLock(options.request, async path => {
    const shape = z.object({ requestId: z.string(), inputDigest: z.string(), operatorId: z.string(), deployment: z.string() }).strict();
    const saved = existsSync(path) ? shape.parse(readJson(path)) : { requestId: crypto.randomUUID(), inputDigest, operatorId: profile.principalId, deployment: profile.convexUrl };
    if (saved.inputDigest !== inputDigest || saved.operatorId !== profile.principalId || saved.deployment !== profile.convexUrl) throw new Error("Saved apply request identifies a different review, operator or deployment.");
    if (!existsSync(path)) writeLocked(path, saved);
    return client.mutation(api.apply, { ...review, requestId: saved.requestId });
  });
}
