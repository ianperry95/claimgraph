import type { Config } from "../config/index.js";
import type { Entity } from "../models/types.js";
import { embed } from "../models/embedding.js";
import { chatCompletion } from "../models/llm.js";
import { findByEmbedding, getEntity } from "../db/entities.js";
import { traverseFromSeeds, getEntityRelationships } from "../db/relationships.js";

export interface RetrievalResult {
  entities: ScoredEntity[];
  contextBlock: string;
}

export interface ScoredEntity {
  entity: Entity;
  score: number;
}

/**
 * Full retrieval pipeline:
 * 1. Seed — embed query → vector search → top-K
 * 2. Traverse — graph walk from seeds
 * 3. Rank — score by similarity × recency × stale penalty
 * 4. Summarize — LLM-generated context block within token budget
 */
export async function retrieve(
  config: Config,
  query: string,
): Promise<RetrievalResult> {
  // 1. Seed: embed the query and find top-K similar entities
  const queryEmbedding = await embed(config, query);
  const seedResults = await findByEmbedding(
    queryEmbedding,
    config.traversal.topK,
  );

  if (seedResults.length === 0) {
    return { entities: [], contextBlock: "" };
  }

  // Score seed entities
  const scoredSeeds: ScoredEntity[] = seedResults.map((r) => ({
    entity: r,
    score: computeScore(r.similarity, r.lastSeenAt, r.stale, config),
  }));

  // 2. Traverse: walk the graph from seed entities
  const seedIds = seedResults.map((r) => String(r.id));
  const neighborIds = await traverseFromSeeds(
    seedIds,
    config.traversal.hopDepth,
    config.traversal.maxNeighborsPerHop,
    config.traversal.totalResultCap,
  );

  // Fetch and score neighbor entities
  const scoredNeighbors: ScoredEntity[] = [];
  for (const nId of neighborIds) {
    const entity = await getEntity(nId);
    if (!entity || entity.archived) continue;
    // For traversed entities, use a base similarity of 0.5 (contextual relevance)
    const score = computeScore(0.5, entity.lastSeenAt, entity.stale, config);
    scoredNeighbors.push({ entity, score });
  }

  // 3. Rank: combine and sort all results
  const allScored = [...scoredSeeds, ...scoredNeighbors]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.traversal.totalResultCap);

  if (allScored.length === 0) {
    return { entities: [], contextBlock: "" };
  }

  // 4. Summarize: generate context block via LLM
  const contextBlock = await summarizeForContext(
    config,
    allScored.slice(0, 10), // Top 10 for summary
  );

  return { entities: allScored, contextBlock };
}

/**
 * Compute retrieval score for an entity.
 * score = similarity × recency_weight × stale_penalty
 */
function computeScore(
  similarity: number,
  lastSeenAt: string | Date,
  stale: boolean,
  config: Config,
): number {
  const seenDate = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const daysSinceSeen =
    (Date.now() - seenDate.getTime()) / (1000 * 60 * 60 * 24);
  const recencyWeight = 1 / (1 + Math.log(1 + daysSinceSeen));
  const stalePenalty = stale ? config.retrieval.staleWeight : 1.0;
  return similarity * recencyWeight * stalePenalty;
}

/**
 * Summarize top entities into a context block within the token budget.
 */
async function summarizeForContext(
  config: Config,
  scored: ScoredEntity[],
): Promise<string> {
  // Build entity summaries for the LLM
  const entitySummaries = scored
    .map((s) => {
      const e = s.entity;
      const props = Object.entries(e.properties)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return `- ${e.name} (${e.type}): ${e.summary || ""}${props ? ` [${props}]` : ""}`;
    })
    .join("\n");

  const prompt = `Summarize these memory items into a concise context block for an AI assistant. Focus on the most relevant and actionable information. Keep it under ${config.retrieval.contextBudgetTokens} tokens. Use natural language, not JSON.

Memory items:
${entitySummaries}

Write a brief, information-dense summary:`;

  const summary = await chatCompletion(
    config,
    [{ role: "user", content: prompt }],
    { temperature: 0.1, maxTokens: config.retrieval.contextBudgetTokens },
  );

  return summary.trim();
}
