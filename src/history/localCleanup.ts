import { existsSync, openSync, closeSync, constants } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { historyApi, historyResultSchemas, messageArtifactId } from "@ultra-herdr/api";
import { historyConnection, type HistoryScopeOptions } from "./client";
import { withArtifactLock } from "../receive/artifactLock";
import { withCredentialLock, writeLocked } from "../auth/storage";
import { readArtifactText } from "../receive/artifact";
import { openArtifacts, artifactNames, inspectArtifact, removeArtifact, closeArtifacts } from "./localArtifactFiles";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const item = z.object({ artifactId: hash, taskId: z.string().optional(), fingerprint: z.string().optional(),
  eligible: z.boolean(), reason: z.string(), }).strict();
const manifest = z.object({ version: z.literal(1), profile: z.string(), directoryIdentity: z.string().nullable(),
  task: z.string().optional(), session: z.string().optional(), eligibleCache: z.boolean(), createdAt: z.number(),
  next: hash.nullable(), items: z.array(item).max(1000) }).strict()
  .refine(p => [!!p.task, !!p.session, p.eligibleCache].filter(Boolean).length === 1);
type Options = Omit<HistoryScopeOptions, "task"> & { task?: string; session?: string; eligibleCache?: boolean;
  previewFile: string; after?: string; limit?: string; artifact?: string[] };
async function connection(options: Options) {
  // The same explicit live/released/operator authority as existing history reads.
  return historyConnection({ ...options, task: options.task ?? "local-artifact-cleanup" });
}
function destination(file: string, profile: string) {
  const path = resolve(file), directory = `${profile}.messages`;
  if (path === profile || `${path}.lock` === profile || path === `${profile}.lock` || path === directory || path.startsWith(directory + sep))
    throw new Error("Keep the preview separate from credentials and cached artifacts.");
  return path;
}
export async function previewLocalCleanup(options: Options) {
  if ([!!options.task, !!options.session, !!options.eligibleCache].filter(Boolean).length !== 1) throw new Error("Select exactly one of --task, --session or --eligible-cache.");
  const limit = Number(options.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || (options.after && !hash.safeParse(options.after).success)) throw new Error("Invalid preview page.");
  const { client, actor, config } = await connection(options), output = destination(options.previewFile, config);
  const value = await withArtifactLock(`${config}.messages`, async () => {
    const directory = openArtifacts(`${config}.messages`), items: z.infer<typeof item>[] = [];
    let next: string | null = null;
    try {
      if (directory) {
        const page = artifactNames(directory, options.after, limit); next = page.next;
        for (const name of page.names) {
          const artifactId = name.slice(0, -5);
          try {
            const file = await inspectArtifact(directory, artifactId), envelope = file.envelope;
            if (!envelope.taskId) throw new Error("Artifact has no task identity.");
            if (options.task && envelope.taskId !== options.task) continue;
            const answer = historyResultSchemas.localPreview.parse(await client.query(historyApi.localPreview,
              { actor, taskId: envelope.taskId, messageId: envelope.messageId, digest: envelope.digest, artifactId,
                ...(options.session ? { sessionId: options.session } : {}) }));
            if (answer.reason === "scope_mismatch") continue;
            if (await messageArtifactId(answer.deploymentId, envelope) !== artifactId) throw new Error();
            items.push({ artifactId, taskId: envelope.taskId, fingerprint: file.fingerprint, eligible: answer.eligible, reason: answer.reason });
          } catch { items.push({ artifactId, eligible: false, reason: "invalid_or_unauthorized_artifact" }); }
        }
      }
      return manifest.parse({ version: 1, profile: config, directoryIdentity: directory?.identity ?? null,
        task: options.task, session: options.session, eligibleCache: options.eligibleCache ?? false, createdAt: Date.now(), next, items });
    } finally { if (directory) closeArtifacts(directory.fd); }
  });
  await withCredentialLock(output, async path => {
    if (existsSync(path)) throw new Error("Use a new preview file; existing files are never overwritten.");
    writeLocked(path, value);
  });
  return { previewFile: output, next: value.next, items: value.items };
}
export async function applyLocalCleanup(options: Options) {
  const { client, actor, config } = await connection(options), input = destination(options.previewFile, config);
  const fd = openSync(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let text: string;
  try { text = readArtifactText(fd); } finally { closeSync(fd); }
  const preview = manifest.parse(JSON.parse(text));
  if (preview.profile !== config) throw new Error("Preview belongs to another profile.");
  const selected = options.artifact ?? preview.items.filter(i => i.eligible).map(i => i.artifactId);
  if (new Set(selected).size !== selected.length || selected.some(id => !preview.items.some(i => i.artifactId === id && i.eligible))) throw new Error("Select only eligible artifacts from this preview.");
  return withArtifactLock(`${config}.messages`, async () => {
    const directory = openArtifacts(`${config}.messages`), results: { artifactId: string; result: string }[] = [];
    try {
      if (directory && directory.identity !== preview.directoryIdentity) throw new Error("Artifact directory changed; preview again.");
      for (const artifactId of selected) {
        if (!directory) { results.push({ artifactId, result: "already_absent" }); continue; }
        try {
          const file = await inspectArtifact(directory, artifactId), prior = preview.items.find(i => i.artifactId === artifactId)!;
          if (file.fingerprint !== prior.fingerprint || file.envelope.taskId !== prior.taskId) throw new Error("Changed file.");
          const envelope = file.envelope;
          if (!envelope.taskId) throw new Error("Artifact has no task identity.");
          if (preview.task && envelope.taskId !== preview.task) throw new Error("Artifact outside preview scope.");
          const answer = historyResultSchemas.localAuthorize.parse(await client.mutation(historyApi.localAuthorize,
            { actor, taskId: envelope.taskId, messageId: envelope.messageId, digest: envelope.digest, artifactId,
              ...(preview.session ? { sessionId: preview.session } : {}) }));
          if (!answer.eligible) { results.push({ artifactId, result: answer.reason }); continue; }
          if (await messageArtifactId(answer.deploymentId, envelope) !== artifactId) throw new Error("Changed deployment.");
          removeArtifact(directory, artifactId, file.fingerprint);
          results.push({ artifactId, result: "removed" });
        } catch (error) {
          results.push({ artifactId, result: (error as NodeJS.ErrnoException).code === "ENOENT" ? "already_absent" : "changed_or_unauthorized" });
        }
      }
      return { results };
    } finally { if (directory) closeArtifacts(directory.fd); }
  });
}
