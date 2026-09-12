import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { parseJson } from "@ultra-herdr/api";
import { readReportFile, ReportError, reportLimits } from "../reports/input";
import { materializeReportInput } from "../task/reportData";
import { writeEphemeralInput } from "../task/writeInput";

export type MutationInputOptions = { input?: string; data?: string; dataFile?: string };
export type MutationRequestOptions = { requestFile?: string };

export function inputModeCount(options: MutationInputOptions) {
  return [options.input, options.data, options.dataFile].filter(v => v !== undefined && v !== "").length;
}

/** Add --input with --data / --data-file aliases for one JSON document. */
export function addDocumentInputOptions(cmd: Command, description: string) {
  cmd.option("--input <file>", description)
    .option("--data <json>", "Inline JSON input (alias for --input)")
    .option("--data-file <file>", "JSON input file (alias for --input)");
}

export function addAutoRequestFileOption(cmd: Command) {
  cmd.option("--request-file <file>", "Protected retry journal; auto-created under /tmp when omitted");
}

export function resolveDocumentInput(prefix: string, options: MutationInputOptions) {
  if (inputModeCount(options) !== 1)
    throw new ReportError("Provide exactly one of --input, --data, or --data-file.");
  if (options.input) return resolve(options.input);
  const raw = options.data ?? readReportFile(resolve(options.dataFile!));
  const parsed = parseJson(raw, reportLimits, `${prefix}.input`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ReportError("Input must be a JSON object.");
  return writeEphemeralInput(prefix, parsed);
}

export function resolveReportContentInput(prefix: string, options: MutationInputOptions) {
  return materializeReportInput(prefix, options);
}

/** Ephemeral protected journal when --request-file is omitted; reuse an explicit path for retries. */
export function resolveRequestFile(prefix: string, requestFile?: string) {
  if (requestFile) return resolve(requestFile);
  const dir = join("/tmp", `herdr-cli-${prefix}-request-${randomUUID()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, "request.json");
}
