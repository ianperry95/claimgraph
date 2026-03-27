import { describe, it, expect } from "vitest";
import { parseExtractionOutput, filterBySalience } from "./extraction.js";
import type { ExtractionResult } from "../models/types.js";

describe("parseExtractionOutput", () => {
  it("parses valid extraction JSON", () => {
    const raw = JSON.stringify({
      entities: [
        {
          ref: "e1",
          name: "Ian Perry",
          type: "person",
          typeConfidence: 0.97,
          description: "Systems administrator",
          properties: { employer: "BetaCorp" },
          salience: 0.91,
        },
      ],
      relationships: [
        {
          from: "e1",
          to: "e2",
          label: "works_at",
          properties: {},
          confidence: 0.92,
          changeHint: "started",
        },
      ],
      propertyClaims: [
        {
          subject: "e1",
          predicate: "event.date",
          value: "2026-04-02",
          confidence: 0.89,
          changeHint: null,
        },
      ],
    });

    const result = parseExtractionOutput(raw);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("Ian Perry");
    expect(result.entities[0].salience).toBe(0.91);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].changeHint).toBe("started");
    expect(result.propertyClaims).toHaveLength(1);
  });

  it("handles missing arrays gracefully", () => {
    const result = parseExtractionOutput("{}");
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.propertyClaims).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseExtractionOutput("not json")).toThrow();
  });

  it("provides defaults for missing fields", () => {
    const raw = JSON.stringify({
      entities: [{ ref: "e1", name: "Test" }],
    });
    const result = parseExtractionOutput(raw);
    expect(result.entities[0].type).toBe("thing");
    expect(result.entities[0].typeConfidence).toBe(0.5);
    expect(result.entities[0].salience).toBe(0.5);
  });
});

describe("filterBySalience", () => {
  const extraction: ExtractionResult = {
    entities: [
      {
        ref: "e1",
        name: "Important",
        type: "person",
        typeConfidence: 0.9,
        description: "Key person",
        properties: {},
        salience: 0.9,
      },
      {
        ref: "e2",
        name: "Trivial",
        type: "thing",
        typeConfidence: 0.5,
        description: "Unimportant",
        properties: {},
        salience: 0.2,
      },
    ],
    relationships: [
      {
        from: "e1",
        to: "e2",
        label: "knows",
        properties: {},
        confidence: 0.8,
        changeHint: null,
      },
    ],
    propertyClaims: [
      {
        subject: "e2",
        predicate: "status",
        value: "inactive",
        confidence: 0.7,
        changeHint: null,
      },
    ],
  };

  it("filters entities below threshold", () => {
    const result = filterBySalience(extraction, 0.5);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("Important");
  });

  it("removes relationships with filtered endpoints", () => {
    const result = filterBySalience(extraction, 0.5);
    expect(result.relationships).toHaveLength(0);
  });

  it("removes claims for filtered entities", () => {
    const result = filterBySalience(extraction, 0.5);
    expect(result.propertyClaims).toHaveLength(0);
  });

  it("keeps everything when threshold is 0", () => {
    const result = filterBySalience(extraction, 0);
    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.propertyClaims).toHaveLength(1);
  });
});
