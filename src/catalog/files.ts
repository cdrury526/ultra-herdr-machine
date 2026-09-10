import { createReadStream, openSync, writeSync, fsyncSync, closeSync, linkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
export const maxBytes = 1048576;
export function canonical(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) throw new Error("Catalog input must be JSON.");
  return result;
}
export function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export async function* lines(path: string) {
  const decoder = new TextDecoder("utf-8", { fatal: true }); let pending = "";
  for await (const chunk of createReadStream(path)) {
    pending += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (Buffer.byteLength(line) > maxBytes) throw new Error("Catalog line exceeds the 1 MiB import bound.");
      if (line.trim()) yield line;
    }
    if (Buffer.byteLength(pending) > maxBytes) throw new Error("Catalog line exceeds the 1 MiB import bound.");
  }
  pending += decoder.decode();
  if (pending.trim()) yield pending;
}
export async function* batches(path: string) {
  let first = true, count = 0, raw: string[] = [], bytes = 2;
  for await (const line of lines(path)) {
    if (first) {
      const header = JSON.parse(line);
      if (header?.format !== "herdr-catalog-file-1" || Object.keys(header).some(key => !["format", "manifest"].includes(key)))
        throw new Error("Catalog JSONL must begin with a herdr-catalog-file-1 header.");
      first = false; continue;
    }
    if (++count > 4096) throw new Error("Catalog input exceeds 4096 records.");
    const size = Buffer.byteLength(line);
    if (size + 2 > maxBytes) throw new Error("Catalog record cannot fit one bounded upload batch.");
    if (raw.length && (raw.length === 64 || bytes + size + 1 > maxBytes)) {
      const text = `[${raw.join(",")}]`; yield { text, count: raw.length, digest: digest(JSON.parse(text)) }; raw = []; bytes = 2;
    }
    bytes += size + (raw.length ? 1 : 0); raw.push(line);
  }
  if (first || !count) throw new Error("Catalog file requires a header and at least one record.");
  if (raw.length) { const text = `[${raw.join(",")}]`; yield { text, count: raw.length, digest: digest(JSON.parse(text)) }; }
}
/** Publish a complete output without replacing an existing file; readers never see a partial export. */
export async function writeNew(path: string, work: (write: (text: string) => void) => Promise<void>) {
  const temporary = join(dirname(path), `.herdr-catalog-${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    await work(text => { const bytes = Buffer.from(text); let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset); });
    fsyncSync(fd); linkSync(temporary, path);
    const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { closeSync(fd); unlinkSync(temporary); }
}
