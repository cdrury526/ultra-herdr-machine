import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { catalogApi as api } from "@ultra-herdr/api";
import { operatorClient, catalogOperation, print } from "../catalog/client";
import { importCatalog } from "../catalog/import";
import { releaseFile, validateCatalog, exportCatalog, entries } from "../catalog/read";
import { reviewCatalog, applyCatalog } from "../catalog/review";
export function addCatalogCommands(program: Command) {
  const catalog = program.command("catalog").description("Manage validated catalog releases using an explicit operator profile");
  const command = (name: string, description: string) => catalog.command(name).description(description).requiredOption("--profile <file>", "Protected operator profile");
  const action = (work: (options: any) => Promise<unknown>) => async (options: any) => print(await catalogOperation(() => work(options)));
  const release = (c: Command) => c.requiredOption("--release <file>", "JSON file containing releaseId and manifestDigest");
  command("head", "Show the active release and generation").action(action(async o => (await operatorClient(o.profile)).query(api.head, {})));
  command("list", "List stored releases").option("--cursor <cursor>").action(action(async o => JSON.parse((await (await operatorClient(o.profile)).query(api.releases, { ...(o.cursor ? { cursor: o.cursor } : {}) })).canonical)));
  release(command("entries", "List the exact revisions in a release")).action(action(async o => {
    const result = []; for await (const entry of entries(await operatorClient(o.profile), releaseFile(o.release))) result.push(entry); return result;
  }));
  release(command("show", "Show one canonical catalog body")).requiredOption("--kind <kind>").requiredOption("--key <key>")
    .action(action(async o => JSON.parse((await (await operatorClient(o.profile)).query(api.show, { ...releaseFile(o.release), kind: o.kind, key: o.key })).canonical)));
  command("import", "Stage and seal an explicit replacement or patch JSONL file")
    .requiredOption("--file <file>").requiredOption("--mode <replace|patch>").requiredOption("--note <text>")
    .requiredOption("--request <file>", "Saved request state; reuse this path to resume")
    .action(action(importCatalog));
  release(command("validate", "Run resumable complete release validation"))
    .action(action(o => validateCatalog(o.profile, releaseFile(o.release))));
  release(command("preview", "Render a synthetic sample with the shared composer")).requiredOption("--brief <key>").requiredOption("--sample <file>")
    .action(action(async o => {
      const result = await (await operatorClient(o.profile)).mutation(api.preview, { ...releaseFile(o.release), briefKey: o.brief, text: readFileSync(o.sample, "utf8") });
      return { ...result, canonical: undefined, preview: JSON.parse(result.canonical) };
    }));
  command("explain", "Read one immutable preview explanation page").requiredOption("--preview <id>").requiredOption("--digest <digest>").option("--page <number>", "Page ordinal", "0")
    .action(action(async o => JSON.parse((await (await operatorClient(o.profile)).query(api.explain, { previewId: o.preview, previewDigest: o.digest, page: Number(o.page) })).canonical)));
  release(command("review", "Prepare a preview-bound complete diff for explicit apply"))
    .requiredOption("--brief <key>").requiredOption("--sample <file>").requiredOption("--note <text>").requiredOption("--request <file>", "Saved review request; reuse to resume")
    .action(action(reviewCatalog));
  command("diff", "Read one page of a prepared complete review").requiredOption("--review <id>").option("--page <number>", "Page ordinal", "0")
    .action(action(async o => JSON.parse((await (await operatorClient(o.profile)).query(api.reviewShow, { reviewId: o.review, page: Number(o.page) })).canonical)));
  for (const name of ["apply", "rollback"]) command(name, name === "apply" ? "Activate the exact completed review" : "Apply a completed review selecting a whole prior release")
    .requiredOption("--review <file>", "JSON result from catalog review").requiredOption("--request <file>", "Saved apply request; reuse to resume")
    .action(action(applyCatalog));
  command("history", "Read catalog activation and no-op history").option("--cursor <cursor>")
    .action(action(async o => JSON.parse((await (await operatorClient(o.profile)).query(api.history, { ...(o.cursor ? { cursor: o.cursor } : {}) })).canonical)));
  release(command("export", "Verify and atomically export a sealed snapshot as JSONL")).requiredOption("--output <file>", "New export path; existing files are preserved")
    .action(action(o => exportCatalog(o.profile, releaseFile(o.release), o.output)));
}
