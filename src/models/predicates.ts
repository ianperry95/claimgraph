import type { Config, PredicateMode, PredicateSemantic } from "../config/index.js";
import type { Claim } from "./types.js";

/**
 * Resolve the predicate semantic config for a given predicate key.
 * Unknown predicates are treated as free-form append-only.
 */
export function getPredicateSemantic(
  config: Config,
  predicate: string,
): PredicateSemantic {
  return (
    config.predicateSemantics[predicate] ?? {
      mode: "multi-valued" as PredicateMode,
    }
  );
}

/**
 * Determine whether a new claim value should supersede existing active claims
 * for the same entity+predicate, based on predicate semantics.
 *
 * Returns the list of existing claim IDs to supersede (may be empty).
 */
export function claimsToSupersede(
  semantic: PredicateSemantic,
  existingActive: Claim[],
  newValue: unknown,
): string[] {
  switch (semantic.mode) {
    case "additive":
      // Never supersede — values accumulate.
      return [];

    case "single-current": {
      // Supersede all active claims for this predicate if value differs.
      const toSupersede: string[] = [];
      for (const claim of existingActive) {
        if (!valuesEqual(claim.value, newValue) && claim.id) {
          toSupersede.push(claim.id);
        }
      }
      return toSupersede;
    }

    case "temporal": {
      // Close (set validTo) on the prior active claim — similar to single-current
      // but handled at the write layer by setting validTo instead of just superseding.
      const toClose: string[] = [];
      for (const claim of existingActive) {
        if (!valuesEqual(claim.value, newValue) && claim.id) {
          toClose.push(claim.id);
        }
      }
      return toClose;
    }

    case "multi-valued": {
      // Only supersede if exact duplicate value exists (prevent duplicates).
      // Otherwise, the new value coexists.
      return [];
    }

    default:
      return [];
  }
}

/**
 * Check if a new multi-valued claim is a duplicate of an existing one.
 */
export function isDuplicateMultiValued(
  existingActive: Claim[],
  newValue: unknown,
): boolean {
  return existingActive.some((c) => valuesEqual(c.value, newValue));
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Materialize entity properties from active claims using predicate semantics.
 * Pure function — no LLM calls, no side effects.
 */
export function materializeProperties(
  config: Config,
  activeClaims: Claim[],
  currentAliases: string[],
): { properties: Record<string, unknown>; aliases: string[] } {
  const properties: Record<string, unknown> = {};
  const aliases = new Set<string>(currentAliases);

  // Group claims by predicate
  const byPredicate = new Map<string, Claim[]>();
  for (const claim of activeClaims) {
    const group = byPredicate.get(claim.predicate) ?? [];
    group.push(claim);
    byPredicate.set(claim.predicate, group);
  }

  for (const [predicate, claims] of byPredicate) {
    const semantic = getPredicateSemantic(config, predicate);

    if (!semantic.materializeTo) continue;

    if (semantic.materializeTo === "aliases") {
      for (const claim of claims) {
        if (typeof claim.value === "string") {
          aliases.add(claim.value);
        }
      }
      continue;
    }

    switch (semantic.mode) {
      case "additive": {
        const existing = getNestedValue(properties, semantic.materializeTo);
        const arr = Array.isArray(existing) ? [...existing] : [];
        for (const claim of claims) {
          if (!arr.some((v) => valuesEqual(v, claim.value))) {
            arr.push(claim.value);
          }
        }
        setNestedValue(properties, semantic.materializeTo, arr);
        break;
      }

      case "single-current":
      case "temporal": {
        // Pick the most recent active claim
        const sorted = [...claims].sort(
          (a, b) =>
            new Date(b.extractedAt).getTime() -
            new Date(a.extractedAt).getTime(),
        );
        if (sorted.length > 0) {
          setNestedValue(properties, semantic.materializeTo, sorted[0].value);
        }
        break;
      }

      case "multi-valued": {
        const values = claims.map((c) => c.value);
        setNestedValue(properties, semantic.materializeTo, values);
        break;
      }
    }
  }

  return { properties, aliases: [...aliases] };
}

// --- Nested property helpers ---

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  // Strip leading "properties." since we're already setting into properties
  const cleanPath = path.startsWith("properties.")
    ? path.slice("properties.".length)
    : path;
  const parts = cleanPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const cleanPath = path.startsWith("properties.")
    ? path.slice("properties.".length)
    : path;
  const parts = cleanPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
