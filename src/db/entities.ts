import { v4 as uuidv4 } from "uuid";
import { RecordId, StringRecordId } from "surrealdb";
import type { Config } from "../config/index.js";
import type { Entity, ExtractedEntity, TypeConflict } from "../models/types.js";
import { getDb } from "./connection.js";

/**
 * Create a new entity from an extraction result.
 */
export async function createEntity(
  config: Config,
  extracted: ExtractedEntity,
  embedding: number[],
): Promise<string> {
  const db = getDb();
  const now = new Date();
  const id = uuidv4();

  await db.create(new RecordId("entity", id)).content({
    type: extracted.type,
    typeConfidence: extracted.typeConfidence,
    name: extracted.name,
    aliases: [] as string[],
    properties: extracted.properties ?? {},
    summary: extracted.description.slice(0, config.summary.maxChars),
    descriptionEmbedding: embedding,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    stale: false,
    archived: false,
    projectionDirty: false,
    projectionVersion: 0,
    lastProjectedAt: now,
    typeConflicts: [] as TypeConflict[],
  });

  return `entity:${id}`;
}

/**
 * Fetch an entity by its full record ID string (e.g. "entity:abc123").
 */
export async function getEntity(entityId: string): Promise<Entity | null> {
  const db = getDb();
  const results = await db.query<[Entity[]]>(
    `SELECT * FROM $id`,
    { id: new StringRecordId(entityId) },
  );
  return results[0]?.[0] ?? null;
}

/**
 * Look up entities by exact name or alias match (Tier 1 dedup).
 */
export async function findByNameOrAlias(name: string): Promise<Entity[]> {
  const db = getDb();
  const normalized = name.toLowerCase().trim();
  const results = await db.query<[Entity[]]>(
    `SELECT * FROM entity
     WHERE string::lowercase(name) = $name
        OR $name INSIDE aliases.map(|$v| string::lowercase($v))`,
    { name: normalized },
  );
  return results[0] ?? [];
}

/**
 * Vector similarity search on entity description embeddings.
 */
export async function findByEmbedding(
  embedding: number[],
  topK: number = 5,
): Promise<Array<Entity & { similarity: number }>> {
  const db = getDb();
  const results = await db.query<[(Entity & { similarity: number })[]]>(
    `SELECT *, vector::similarity::cosine(descriptionEmbedding, $emb) AS similarity
     FROM entity
     WHERE archived = false
     ORDER BY similarity DESC
     LIMIT $k`,
    { emb: embedding, k: topK },
  );
  return results[0] ?? [];
}

/**
 * Update entity fields after a merge (dedup match).
 */
export async function mergeEntity(
  config: Config,
  entityId: string,
  extracted: ExtractedEntity,
  newEmbedding: number[] | null,
): Promise<void> {
  const db = getDb();
  const existing = await getEntity(entityId);
  if (!existing) throw new Error(`Entity not found: ${entityId}`);

  const now = new Date();
  const updates: Record<string, unknown> = {
    updatedAt: now,
    lastSeenAt: now,
  };

  // Alias accumulation: add new name form if different
  if (
    extracted.name.toLowerCase() !== existing.name.toLowerCase() &&
    !existing.aliases.some(
      (a) => a.toLowerCase() === extracted.name.toLowerCase(),
    )
  ) {
    updates.aliases = [...existing.aliases, extracted.name];
  }

  // Type override with confidence margin
  if (extracted.type !== existing.type) {
    if (
      extracted.typeConfidence >
      existing.typeConfidence + config.type.overrideMargin
    ) {
      updates.type = extracted.type;
      updates.typeConfidence = extracted.typeConfidence;
    } else {
      const conflict: TypeConflict = {
        proposedType: extracted.type,
        proposedConfidence: extracted.typeConfidence,
        existingType: existing.type,
        existingConfidence: existing.typeConfidence,
        timestamp: now.toISOString(),
      };
      updates.typeConflicts = [...existing.typeConflicts, conflict];
    }
  } else if (extracted.typeConfidence > existing.typeConfidence) {
    updates.typeConfidence = extracted.typeConfidence;
  }

  // Update embedding if provided
  if (newEmbedding) {
    updates.descriptionEmbedding = newEmbedding;
  }

  // Update summary if materially different
  if (extracted.description && extracted.description !== existing.summary) {
    updates.summary = extracted.description.slice(0, config.summary.maxChars);
  }

  await db.update(new StringRecordId(entityId)).merge(updates);
}

/**
 * Update entity projection (properties rebuilt from claims).
 */
export async function updateProjection(
  entityId: string,
  properties: Record<string, unknown>,
  aliases: string[],
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.query(
    `UPDATE $id SET
       properties = $props,
       aliases = $aliases,
       projectionDirty = false,
       projectionVersion = projectionVersion + 1,
       lastProjectedAt = $now,
       updatedAt = $now`,
    {
      id: new StringRecordId(entityId),
      props: properties,
      aliases,
      now,
    },
  );
}

/**
 * Mark entity projection as dirty (for failure recovery).
 */
export async function markProjectionDirty(entityId: string): Promise<void> {
  const db = getDb();
  await db.update(new StringRecordId(entityId)).merge({
    projectionDirty: true,
  });
}

/**
 * Touch lastSeenAt for an entity (when it appears in a conversation).
 */
export async function touchEntity(entityId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.update(new StringRecordId(entityId)).merge({
    lastSeenAt: now,
    updatedAt: now,
  });
}
