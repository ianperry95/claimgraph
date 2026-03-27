import type { Config } from "../config/index.js";
import type { ExtractionResult } from "../models/types.js";
import { chatCompletion } from "../models/llm.js";

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction system. Your job is to extract structured entities, relationships, and property claims from conversation transcripts for long-term memory storage.

## Rules

1. **Entities** represent stable identities: people, places, organizations, events, projects, concepts.
2. **Property claims** represent mutable facts about entities: dates, locations, statuses, preferences.
3. **Relationships** represent connections between entities: works_at, lives_in, participant, member_of, etc.
4. **Salience**: Only extract memory-worthy items. Score each entity 0.0-1.0 for long-term relevance. Drop generic world facts, one-off examples, hypothetical scenarios.
5. **Change detection**: Look for linguistic signals like "no longer", "used to", "moved to", "changed to", "now works at", "left", "stopped". Mark these with changeHint.
6. **Do NOT** decide whether to create or update stored entities — that is determined by the storage layer.
7. **Do NOT** fabricate oldValue — you only see the conversation, not the database.

## Change Hints
- null: No change detected
- "started": New relationship or state began
- "ended": Relationship or state ended
- "replaces_prior_value": Explicit replacement of a prior value
- "negation": Explicit negation of a prior fact

## Output Format
Respond with a JSON object matching this schema exactly:
{
  "entities": [
    {
      "ref": "e1",
      "name": "string",
      "type": "person|place|organization|event|project|concept|thing",
      "typeConfidence": 0.0-1.0,
      "description": "Brief description for memory retrieval",
      "properties": {},
      "salience": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "from": "e1",
      "to": "e2",
      "label": "relationship_type",
      "properties": {},
      "confidence": 0.0-1.0,
      "changeHint": null
    }
  ],
  "propertyClaims": [
    {
      "subject": "e1",
      "predicate": "predicate.name",
      "value": "any",
      "confidence": 0.0-1.0,
      "changeHint": null
    }
  ]
}

Only output valid JSON. No markdown fences, no explanation.`;

/**
 * Run extraction on a conversation transcript.
 */
export async function extractFromTranscript(
  config: Config,
  transcript: string,
  conversationId: string,
): Promise<ExtractionResult> {
  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract entities, relationships, and property claims from this conversation:\n\n${transcript}`,
      },
    ],
    {
      temperature: 0.1,
      maxTokens: 2048,
      responseFormat: { type: "json_object" },
    },
  );

  return parseExtractionOutput(raw);
}

/**
 * Parse and validate the LLM's extraction output.
 */
export function parseExtractionOutput(raw: string): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Extraction output is not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Extraction output is not an object");
  }

  const obj = parsed as Record<string, unknown>;

  const entities = Array.isArray(obj.entities) ? obj.entities : [];
  const relationships = Array.isArray(obj.relationships) ? obj.relationships : [];
  const propertyClaims = Array.isArray(obj.propertyClaims) ? obj.propertyClaims : [];

  return {
    entities: entities.map((e: any) => ({
      ref: String(e.ref ?? ""),
      name: String(e.name ?? ""),
      type: String(e.type ?? "thing"),
      typeConfidence: Number(e.typeConfidence ?? 0.5),
      description: String(e.description ?? ""),
      properties: (e.properties && typeof e.properties === "object") ? e.properties : {},
      salience: Number(e.salience ?? 0.5),
    })),
    relationships: relationships.map((r: any) => ({
      from: String(r.from ?? ""),
      to: String(r.to ?? ""),
      label: String(r.label ?? ""),
      properties: (r.properties && typeof r.properties === "object") ? r.properties : {},
      confidence: Number(r.confidence ?? 0.5),
      changeHint: r.changeHint ?? null,
    })),
    propertyClaims: propertyClaims.map((c: any) => ({
      subject: String(c.subject ?? ""),
      predicate: String(c.predicate ?? ""),
      value: c.value,
      confidence: Number(c.confidence ?? 0.5),
      changeHint: c.changeHint ?? null,
    })),
  };
}

/**
 * Filter extraction results by salience threshold.
 */
export function filterBySalience(
  result: ExtractionResult,
  threshold: number,
): ExtractionResult {
  const keptEntities = result.entities.filter((e) => e.salience >= threshold);
  const keptRefs = new Set(keptEntities.map((e) => e.ref));

  return {
    entities: keptEntities,
    // Only keep relationships where both endpoints are kept
    relationships: result.relationships.filter(
      (r) => keptRefs.has(r.from) && keptRefs.has(r.to),
    ),
    // Only keep claims where the subject is kept
    propertyClaims: result.propertyClaims.filter((c) =>
      keptRefs.has(c.subject),
    ),
  };
}
