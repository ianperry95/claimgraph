import { v4 as uuidv4 } from "uuid";
import { RecordId, StringRecordId } from "surrealdb";
import type { Config } from "../config/index.js";
import type { Claim, Provenance } from "../models/types.js";
import {
  getPredicateSemantic,
  claimsToSupersede,
  isDuplicateMultiValued,
  materializeProperties,
} from "../models/predicates.js";
import { getDb } from "./connection.js";
import { getEntity, markProjectionDirty } from "./entities.js";

/**
 * Fetch all active claims for a given entity.
 */
export async function getActiveClaims(entityId: string): Promise<Claim[]> {
  const db = getDb();
  const results = await db.query<[Claim[]]>(
    `SELECT * FROM claim WHERE entity = $eid AND status = 'active'`,
    { eid: new StringRecordId(entityId) },
  );
  return results[0] ?? [];
}

/**
 * Fetch active claims for a specific entity + predicate.
 */
export async function getActiveClaimsForPredicate(
  entityId: string,
  predicate: string,
): Promise<Claim[]> {
  const db = getDb();
  const results = await db.query<[Claim[]]>(
    `SELECT * FROM claim
     WHERE entity = $eid AND predicate = $pred AND status = 'active'`,
    { eid: new StringRecordId(entityId), pred: predicate },
  );
  return results[0] ?? [];
}

/**
 * Write a new claim, applying predicate semantics for supersession.
 * Returns the new claim ID, or null if the claim was a duplicate.
 */
export async function writeClaim(
  config: Config,
  entityId: string,
  predicate: string,
  value: unknown,
  confidence: number,
  provenance: Provenance,
  changeHint?: string | null,
): Promise<string | null> {
  const db = getDb();
  const semantic = getPredicateSemantic(config, predicate);
  const existingActive = await getActiveClaimsForPredicate(entityId, predicate);

  // Check for idempotency — skip if exact duplicate from same conversation
  const isDuplicate = existingActive.some(
    (c) =>
      c.sourceConversationId === provenance.sourceConversationId &&
      JSON.stringify(c.value) === JSON.stringify(value),
  );
  if (isDuplicate) return null;

  // For multi-valued predicates, skip if the value already exists
  if (semantic.mode === "multi-valued") {
    if (isDuplicateMultiValued(existingActive, value)) return null;
  }

  // Determine which existing claims to supersede
  const toSupersede = claimsToSupersede(semantic, existingActive, value);

  // Mark projection dirty before making changes (failure recovery)
  await markProjectionDirty(entityId);

  const newClaimId = uuidv4();
  const now = new Date();

  // Supersede or close old claims
  for (const oldClaimId of toSupersede) {
    if (semantic.mode === "temporal") {
      // Close with validTo timestamp
      await db.update(new StringRecordId(oldClaimId)).merge({
        status: "superseded",
        supersededBy: new StringRecordId(`claim:${newClaimId}`),
        validTo: now,
      });
    } else {
      // Simple supersession
      await db.update(new StringRecordId(oldClaimId)).merge({
        status: "superseded",
        supersededBy: new StringRecordId(`claim:${newClaimId}`),
      });
    }
  }

  // Create the new claim — omit optional fields when null
  // (SurrealDB v3 rejects JS null for option<> types)
  const claimData: Record<string, unknown> = {
    entity: new StringRecordId(entityId),
    predicate,
    value,
    status: "active",
    stale: false,
    confidence,
    sourceConversationId: provenance.sourceConversationId,
    sourceMessageId: provenance.sourceMessageId,
    extractedAt: new Date(provenance.extractedAt),
    extractorModel: provenance.extractorModel,
  };
  if (semantic.mode === "temporal") {
    claimData.validFrom = now;
  }
  await db.create(new RecordId("claim", newClaimId)).content(claimData);

  return `claim:${newClaimId}`;
}

/**
 * Rebuild the entity projection from active claims.
 * Pure function over active claims — no LLM call.
 */
export async function rebuildProjection(
  config: Config,
  entityId: string,
): Promise<void> {
  const db = getDb();
  const entity = await getEntity(entityId);
  if (!entity) return;

  const activeClaims = await getActiveClaims(entityId);
  const { properties, aliases } = materializeProperties(
    config,
    activeClaims,
    entity.aliases,
  );

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
 * Find all claims sourced from a specific conversation.
 */
export async function findClaimsByConversation(
  conversationId: string,
): Promise<Claim[]> {
  const db = getDb();
  const results = await db.query<[Claim[]]>(
    `SELECT * FROM claim WHERE sourceConversationId = $cid`,
    { cid: conversationId },
  );
  return results[0] ?? [];
}

/**
 * Delete all claims from a conversation and rebuild affected projections.
 */
export async function deleteConversationClaims(
  config: Config,
  conversationId: string,
): Promise<void> {
  const db = getDb();

  // Find affected entities
  const claims = await findClaimsByConversation(conversationId);
  const affectedEntities = new Set(claims.map((c) => c.entity));

  // Delete claims
  await db.query(
    `DELETE FROM claim WHERE sourceConversationId = $cid`,
    { cid: conversationId },
  );

  // Delete relationships from same conversation
  await db.query(
    `DELETE FROM related WHERE sourceConversationId = $cid`,
    { cid: conversationId },
  );

  // Rebuild projections for all affected entities
  for (const entityId of affectedEntities) {
    await rebuildProjection(config, entityId);
  }
}
