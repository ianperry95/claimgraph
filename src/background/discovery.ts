import type { Config } from "../config/index.js";
import type { Entity } from "../models/types.js";
import { getDb } from "../db/connection.js";
import { findByEmbedding } from "../db/entities.js";
import { writeRelationship, getEntityRelationships } from "../db/relationships.js";
import { chatCompletion } from "../models/llm.js";
import { cosineSimilarity } from "../models/embedding.js";
import { StringRecordId } from "surrealdb";

/**
 * Background relationship discovery pass.
 * Finds cross-cluster relationships between entities that were never co-extracted.
 */
export async function runDiscoveryPass(
  config: Config,
): Promise<DiscoveryResult> {
  const db = getDb();
  let candidatesEvaluated = 0;
  let relationshipsCreated = 0;

  // Find recently created/updated entities (candidates for discovery)
  const recentEntities = await db.query<[Entity[]]>(
    `SELECT * FROM entity
     WHERE archived = false
     ORDER BY updatedAt DESC
     LIMIT $limit`,
    { limit: config.backgroundPass.maxEntitiesPerCycle },
  );

  const entities = recentEntities[0] ?? [];

  for (const entity of entities) {
    if (!entity.id || entity.descriptionEmbedding.length === 0) continue;

    // Find similar entities via embedding
    const candidates = await findByEmbedding(
      entity.descriptionEmbedding,
      config.backgroundPass.maxCandidatesPerEntity + 1, // +1 for self
    );

    // Filter: exclude self, below similarity floor
    const validCandidates = candidates.filter(
      (c) =>
        String(c.id) !== String(entity.id) &&
        c.similarity >= config.backgroundPass.similarityFloor,
    );

    if (validCandidates.length === 0) continue;

    // Check if relationships already exist
    const existingRels = await getEntityRelationships(String(entity.id));
    const existingPairs = new Set(
      existingRels.map((r) => `${r.in}:${r.out}`),
    );

    const newCandidates = validCandidates.filter(
      (c) =>
        !existingPairs.has(`${entity.id}:${c.id}`) &&
        !existingPairs.has(`${c.id}:${entity.id}`),
    );

    if (newCandidates.length === 0) continue;

    // Batch LLM call to evaluate candidates
    const candidateDescs = newCandidates
      .map(
        (c, i) =>
          `${i + 1}. "${c.name}" (${c.type}): ${c.summary || "No description"}`,
      )
      .join("\n");

    const prompt = `Given entity "${entity.name}" (${entity.type}): ${entity.summary || "No description"}

Which of these entities might have a relationship with it? For each that does, specify the relationship label.

Candidates:
${candidateDescs}

Respond with JSON: {"relationships": [{"candidate": 1, "label": "relationship_type", "confidence": 0.0-1.0}]}
Return an empty array if none are related. Only output JSON.`;

    const raw = await chatCompletion(
      config,
      [{ role: "user", content: prompt }],
      { temperature: 0, responseFormat: { type: "json_object" } },
    );
    candidatesEvaluated += newCandidates.length;

    try {
      const result = JSON.parse(raw) as {
        relationships: Array<{
          candidate: number;
          label: string;
          confidence: number;
        }>;
      };

      for (const rel of result.relationships ?? []) {
        if (
          rel.candidate < 1 ||
          rel.candidate > newCandidates.length ||
          rel.confidence < 0.5
        ) {
          continue;
        }

        const target = newCandidates[rel.candidate - 1];
        await writeRelationship(
          config,
          String(entity.id),
          String(target.id),
          rel.label,
          rel.label,
          {},
          rel.confidence,
          {
            sourceConversationId: "background_discovery",
            sourceMessageId: "auto",
            extractedAt: new Date().toISOString(), // stays as string in Provenance; converted to Date in writeClaim/writeRelationship
            extractorModel: config.llm.model,
          },
        );
        relationshipsCreated++;
      }
    } catch {
      // Parse failure — skip this entity's candidates
    }
  }

  return { candidatesEvaluated, relationshipsCreated };
}

export interface DiscoveryResult {
  candidatesEvaluated: number;
  relationshipsCreated: number;
}
