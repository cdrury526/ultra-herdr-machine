import type { Json } from "@ultra-herdr/api";
import { normalizeReportSlots } from "./reportData";

type BriefSlots = { values: Json; bundleValues?: Json; attributes?: Json; referenceAuthorities?: Json };

/** Merge optional --data/--data-file slots into a scaffolded parent-review input. */
export function mergeReviewSlots<T extends BriefSlots>(scaffold: T, raw?: string) {
  if (!raw) return scaffold;
  const slots = normalizeReportSlots(raw);
  return { ...scaffold, ...slots, values: slots.values ?? scaffold.values,
    bundleValues: slots.bundleValues ?? scaffold.bundleValues ?? {} };
}

export function mergeRevisionPayload(base: Record<string, unknown>, changeReason: string, raw?: string) {
  let payload = { ...base, changeReason };
  if (raw) {
    const slots = normalizeReportSlots(raw);
    const user = slots.values;
    if (user && typeof user === "object" && !Array.isArray(user) && Object.hasOwn(user, "payload")) {
      const patch = (user as { payload: unknown }).payload;
      if (patch && typeof patch === "object" && !Array.isArray(patch))
        payload = { ...payload, ...patch as Record<string, unknown>, changeReason };
    }
  }
  return payload;
}
