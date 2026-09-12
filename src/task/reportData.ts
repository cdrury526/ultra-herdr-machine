import { resolve } from "node:path";
import { parseJson, type Json } from "@ultra-herdr/api";
import { readReportFile, ReportError, reportLimits } from "../reports/input";
import { writeEphemeralInput } from "./writeInput";

const slotKeys = new Set(["values", "bundleValues", "attributes", "referenceAuthorities"]);

export function normalizeReportSlots(raw: string) {
  const parsed = parseJson(raw, reportLimits, "task.report");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ReportError("Report content must be a JSON object with values.");
  if (Object.hasOwn(parsed, "values")) {
    if (Object.keys(parsed).some(key => !slotKeys.has(key)))
      throw new ReportError("Report input must contain values, with optional bundleValues, attributes and referenceAuthorities.");
    return parsed as { values: Json; bundleValues?: Json; attributes?: Json; referenceAuthorities?: Json };
  }
  return { values: parsed as Json };
}

export function materializeReportInput(prefix: string, options: { input?: string; data?: string; dataFile?: string }) {
  const modes = [options.input, options.data, options.dataFile].filter(v => v !== undefined && v !== "").length;
  if (modes !== 1) throw new ReportError("Provide exactly one of --input, --data, or --data-file.");
  if (options.input) return resolve(options.input);
  const raw = options.data ?? readReportFile(resolve(options.dataFile!));
  return writeEphemeralInput(prefix, normalizeReportSlots(raw));
}
