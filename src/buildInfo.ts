import { buildInfo as generated } from "./buildInfo.generated";

export type BuildInfo = typeof generated;

export const buildInfo = generated;

export function formatBuildVersion(options?: { verbose?: boolean }) {
  const dirty = buildInfo.dirty ? " dirty" : "";
  if (!options?.verbose) return `${buildInfo.version} (${buildInfo.commit}${dirty}, ${buildInfo.builtAt})`;
  return JSON.stringify({ ...buildInfo, versionLine: `${buildInfo.version} (${buildInfo.commit}${dirty}, ${buildInfo.builtAt})` });
}
