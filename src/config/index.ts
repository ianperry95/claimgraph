import { resolveConfig } from "./schema.js";

export type { Config, PredicateMode, PredicateSemantic } from "./schema.js";

export function loadConfig(
  overrides: Record<string, unknown> = {},
) {
  return resolveConfig(overrides);
}

export function resolveDbPath(raw: string): string {
  if (raw.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return raw.replace("~", home);
  }
  return raw;
}
