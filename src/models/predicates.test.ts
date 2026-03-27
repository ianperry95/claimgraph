import { describe, it, expect } from "vitest";
import { loadConfig } from "../config/index.js";
import type { Claim } from "./types.js";
import {
  getPredicateSemantic,
  claimsToSupersede,
  isDuplicateMultiValued,
  materializeProperties,
} from "./predicates.js";

const config = loadConfig({});

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "claim:test-1",
    entity: "entity:test",
    predicate: "test",
    value: "old-value",
    status: "active",
    supersededBy: null,
    stale: false,
    confidence: 0.9,
    validFrom: null,
    validTo: null,
    sourceConversationId: "conv-1",
    sourceMessageId: "msg-1",
    extractedAt: "2026-01-01T00:00:00Z",
    extractorModel: "test",
    ...overrides,
  };
}

describe("getPredicateSemantic", () => {
  it("returns configured semantics for known predicates", () => {
    const sem = getPredicateSemantic(config, "event.date");
    expect(sem.mode).toBe("single-current");
    expect(sem.materializeTo).toBe("properties.date");
  });

  it("returns multi-valued for unknown predicates", () => {
    const sem = getPredicateSemantic(config, "some.unknown.predicate");
    expect(sem.mode).toBe("multi-valued");
  });

  it("returns additive for alias predicate", () => {
    const sem = getPredicateSemantic(config, "alias");
    expect(sem.mode).toBe("additive");
    expect(sem.materializeTo).toBe("aliases");
  });

  it("returns temporal for works_at", () => {
    const sem = getPredicateSemantic(config, "works_at");
    expect(sem.mode).toBe("temporal");
  });
});

describe("claimsToSupersede", () => {
  it("returns empty for additive predicates", () => {
    const sem = getPredicateSemantic(config, "alias");
    const existing = [makeClaim({ value: "old-alias" })];
    expect(claimsToSupersede(sem, existing, "new-alias")).toEqual([]);
  });

  it("supersedes for single-current when value differs", () => {
    const sem = getPredicateSemantic(config, "event.date");
    const existing = [
      makeClaim({ id: "claim:old", value: "2026-01-01" }),
    ];
    const result = claimsToSupersede(sem, existing, "2026-02-01");
    expect(result).toEqual(["claim:old"]);
  });

  it("does not supersede for single-current when value matches", () => {
    const sem = getPredicateSemantic(config, "event.date");
    const existing = [makeClaim({ id: "claim:old", value: "2026-01-01" })];
    const result = claimsToSupersede(sem, existing, "2026-01-01");
    expect(result).toEqual([]);
  });

  it("closes for temporal when value differs", () => {
    const sem = getPredicateSemantic(config, "works_at");
    const existing = [makeClaim({ id: "claim:old", value: "AlphaCorp" })];
    const result = claimsToSupersede(sem, existing, "BetaCorp");
    expect(result).toEqual(["claim:old"]);
  });

  it("returns empty for multi-valued predicates", () => {
    const sem = getPredicateSemantic(config, "participant");
    const existing = [makeClaim({ value: "person-a" })];
    expect(claimsToSupersede(sem, existing, "person-b")).toEqual([]);
  });
});

describe("isDuplicateMultiValued", () => {
  it("detects duplicate values", () => {
    const existing = [makeClaim({ value: "same-value" })];
    expect(isDuplicateMultiValued(existing, "same-value")).toBe(true);
  });

  it("returns false for new values", () => {
    const existing = [makeClaim({ value: "old" })];
    expect(isDuplicateMultiValued(existing, "new")).toBe(false);
  });
});

describe("materializeProperties", () => {
  it("materializes single-current predicate to properties", () => {
    const claims = [
      makeClaim({
        predicate: "event.date",
        value: "2026-04-02",
        extractedAt: "2026-03-15T00:00:00Z",
      }),
    ];
    const result = materializeProperties(config, claims, []);
    expect(result.properties.date).toBe("2026-04-02");
  });

  it("picks most recent claim for single-current", () => {
    const claims = [
      makeClaim({
        predicate: "event.date",
        value: "2026-04-01",
        extractedAt: "2026-03-10T00:00:00Z",
      }),
      makeClaim({
        predicate: "event.date",
        value: "2026-04-02",
        extractedAt: "2026-03-15T00:00:00Z",
      }),
    ];
    const result = materializeProperties(config, claims, []);
    expect(result.properties.date).toBe("2026-04-02");
  });

  it("accumulates aliases from additive predicate", () => {
    const claims = [
      makeClaim({ predicate: "alias", value: "Bob" }),
      makeClaim({ predicate: "alias", value: "Robert" }),
    ];
    const result = materializeProperties(config, claims, ["Bobby"]);
    expect(result.aliases).toContain("Bob");
    expect(result.aliases).toContain("Robert");
    expect(result.aliases).toContain("Bobby");
  });

  it("collects multi-valued predicate values", () => {
    const claims = [
      makeClaim({ predicate: "member_of", value: "GroupA" }),
      makeClaim({ predicate: "member_of", value: "GroupB" }),
    ];
    // member_of has no materializeTo, so nothing in properties
    const result = materializeProperties(config, claims, []);
    expect(result.properties).toEqual({});
  });

  it("materializes temporal predicate with most recent value", () => {
    const claims = [
      makeClaim({
        predicate: "works_at",
        value: "BetaCorp",
        extractedAt: "2026-03-20T00:00:00Z",
      }),
    ];
    const result = materializeProperties(config, claims, []);
    expect(result.properties.currentEmployer).toBe("BetaCorp");
  });
});
