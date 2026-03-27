import type { Config } from "../config/index.js";
import type { Entity, ExtractedEntity, DedupResult } from "../models/types.js";
import { embed, cosineSimilarity } from "../models/embedding.js";
import { chatCompletion } from "../models/llm.js";
import { findByNameOrAlias, findByEmbedding } from "../db/entities.js";

/**
 * Run 3-tier hybrid dedup for a single extracted entity.
 *
 * Tier 1: Alias/key lookup (O(1))
 * Tier 2: Embedding similarity
 * Tier 3: LLM resolution (only for ambiguous Tier 2)
 */
export async function dedup(
  config: Config,
  extracted: ExtractedEntity,
  descriptionEmbedding: number[],
): Promise<DedupResult> {
  // --- Tier 1: Name/alias lookup ---
  const tier1Matches = await findByNameOrAlias(extracted.name);

  if (tier1Matches.length === 1) {
    const match = tier1Matches[0];
    // Exact unique match — confident if embedding also confirms
    const similarity = cosineSimilarity(
      descriptionEmbedding,
      match.descriptionEmbedding,
    );
    if (similarity >= config.dedup.ambiguousZoneLow) {
      return {
        extracted,
        outcome: { kind: "match", existingEntityId: String(match.id) },
      };
    }
    // Name matched but description is very different — fall through to Tier 3
    return tier3Resolution(config, extracted, [match]);
  }

  if (tier1Matches.length > 1) {
    // Ambiguous name match — use embedding to narrow
    let bestMatch: Entity | null = null;
    let bestSim = 0;
    for (const match of tier1Matches) {
      const sim = cosineSimilarity(
        descriptionEmbedding,
        match.descriptionEmbedding,
      );
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = match;
      }
    }

    if (bestMatch && bestSim >= config.dedup.similarityThreshold) {
      return {
        extracted,
        outcome: { kind: "match", existingEntityId: String(bestMatch.id) },
      };
    }
    if (bestMatch && bestSim >= config.dedup.ambiguousZoneLow) {
      return tier3Resolution(config, extracted, tier1Matches);
    }
  }

  // --- Tier 2: Embedding similarity search ---
  const tier2Matches = await findByEmbedding(descriptionEmbedding, 3);

  if (tier2Matches.length > 0) {
    const best = tier2Matches[0];
    if (best.similarity >= config.dedup.similarityThreshold) {
      return {
        extracted,
        outcome: { kind: "match", existingEntityId: String(best.id) },
      };
    }
    if (best.similarity >= config.dedup.ambiguousZoneLow) {
      // --- Tier 3: LLM resolution ---
      return tier3Resolution(config, extracted, tier2Matches);
    }
  }

  // No match — new entity
  return { extracted, outcome: { kind: "new" } };
}

/**
 * Tier 3: Ask the LLM whether the extracted entity matches any candidates.
 */
async function tier3Resolution(
  config: Config,
  extracted: ExtractedEntity,
  candidates: (Entity & { similarity?: number })[],
): Promise<DedupResult> {
  const candidateDescriptions = candidates
    .map(
      (c, i) =>
        `Candidate ${i + 1}: "${c.name}" (type: ${c.type}) — ${c.summary || "No description"}`,
    )
    .join("\n");

  const prompt = `Are any of these existing entities the same as the new entity?

New entity: "${extracted.name}" (type: ${extracted.type}) — ${extracted.description}

Existing candidates:
${candidateDescriptions}

Respond with JSON: {"match": null} if none match, or {"match": 1} for Candidate 1, {"match": 2} for Candidate 2, etc.
Only output JSON, no explanation.`;

  const raw = await chatCompletion(
    config,
    [{ role: "user", content: prompt }],
    { temperature: 0, responseFormat: { type: "json_object" } },
  );

  try {
    const result = JSON.parse(raw) as { match: number | null };
    if (
      result.match !== null &&
      result.match >= 1 &&
      result.match <= candidates.length
    ) {
      const matched = candidates[result.match - 1];
      return {
        extracted,
        outcome: { kind: "match", existingEntityId: String(matched.id) },
      };
    }
  } catch {
    // Parse failure — treat as new entity
  }

  return { extracted, outcome: { kind: "new" } };
}

/**
 * Run dedup for all extracted entities, returning results with embeddings.
 */
export async function dedupAll(
  config: Config,
  entities: ExtractedEntity[],
): Promise<Array<DedupResult & { embedding: number[] }>> {
  const results: Array<DedupResult & { embedding: number[] }> = [];

  for (const entity of entities) {
    const embedding = await embed(config, entity.description || entity.name);
    const dedupResult = await dedup(config, entity, embedding);
    results.push({ ...dedupResult, embedding });
  }

  return results;
}
