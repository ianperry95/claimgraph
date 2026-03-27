import { v4 as uuidv4 } from "uuid";
import { StringRecordId } from "surrealdb";
import type { Config } from "../config/index.js";
import type { Relationship, Provenance, ChangeHint } from "../models/types.js";
import { getPredicateSemantic } from "../models/predicates.js";
import { getDb } from "./connection.js";

/**
 * Fetch active outgoing relationships from an entity.
 */
export async function getOutgoingRelationships(
  entityId: string,
): Promise<Relationship[]> {
  const db = getDb();
  const results = await db.query<[Relationship[]]>(
    `SELECT * FROM related WHERE in = $eid AND status = 'active'`,
    { eid: new StringRecordId(entityId) },
  );
  return results[0] ?? [];
}

/**
 * Fetch active incoming relationships to an entity.
 */
export async function getIncomingRelationships(
  entityId: string,
): Promise<Relationship[]> {
  const db = getDb();
  const results = await db.query<[Relationship[]]>(
    `SELECT * FROM related WHERE out = $eid AND status = 'active'`,
    { eid: new StringRecordId(entityId) },
  );
  return results[0] ?? [];
}

/**
 * Fetch all active relationships involving an entity (in or out).
 */
export async function getEntityRelationships(
  entityId: string,
): Promise<Relationship[]> {
  const db = getDb();
  const results = await db.query<[Relationship[]]>(
    `SELECT * FROM related WHERE (in = $eid OR out = $eid) AND status = 'active'`,
    { eid: new StringRecordId(entityId) },
  );
  return results[0] ?? [];
}

/**
 * Write a new relationship edge with predicate-aware supersession.
 */
export async function writeRelationship(
  config: Config,
  fromEntityId: string,
  toEntityId: string,
  label: string,
  rawLabel: string,
  properties: Record<string, unknown>,
  confidence: number,
  provenance: Provenance,
  changeHint?: ChangeHint,
): Promise<string | null> {
  const db = getDb();
  const semantic = getPredicateSemantic(config, label);
  const now = new Date();

  // Check for idempotency
  const existing = await db.query<[Relationship[]]>(
    `SELECT * FROM related
     WHERE in = $from AND out = $to AND label = $label
       AND sourceConversationId = $cid AND status = 'active'`,
    {
      from: new StringRecordId(fromEntityId),
      to: new StringRecordId(toEntityId),
      label,
      cid: provenance.sourceConversationId,
    },
  );
  if ((existing[0] ?? []).length > 0) return null;

  // Handle supersession based on change hint and predicate semantics
  if (
    changeHint === "ended" ||
    changeHint === "replaces_prior_value" ||
    changeHint === "negation"
  ) {
    if (semantic.mode === "temporal") {
      await db.query(
        `UPDATE related SET status = 'superseded', validTo = $now
         WHERE in = $from AND label = $label AND status = 'active'`,
        { from: new StringRecordId(fromEntityId), label, now },
      );
    } else if (semantic.mode === "single-current") {
      await db.query(
        `UPDATE related SET status = 'superseded'
         WHERE in = $from AND label = $label AND status = 'active'`,
        { from: new StringRecordId(fromEntityId), label },
      );
    }
  }

  // For "ended" hint with no new target, just close the old one
  if (changeHint === "ended") return null;

  // Create the new relationship
  const relId = uuidv4();
  const validFromClause = semantic.mode === "temporal"
    ? "validFrom = $validFrom,"
    : "";
  await db.query(
    `RELATE $from->related->$to SET
       label = $label,
       rawLabel = $rawLabel,
       properties = $props,
       status = 'active',
       stale = false,
       ${validFromClause}
       confidence = $confidence,
       sourceConversationId = $cid,
       sourceMessageId = $mid,
       extractedAt = $extracted,
       extractorModel = $model`,
    {
      from: new StringRecordId(fromEntityId),
      to: new StringRecordId(toEntityId),
      label,
      rawLabel,
      props: properties,
      ...(semantic.mode === "temporal" ? { validFrom: now } : {}),
      confidence,
      cid: provenance.sourceConversationId,
      mid: provenance.sourceMessageId,
      extracted: new Date(provenance.extractedAt),
      model: provenance.extractorModel,
    },
  );

  return relId;
}

/**
 * Traverse relationships from seed entities up to N hops.
 * Uses two separate queries per entity (outgoing + incoming) since
 * SurrealQL does not support UNION ALL.
 */
export async function traverseFromSeeds(
  seedEntityIds: string[],
  hopDepth: number,
  maxNeighborsPerHop: number,
  totalResultCap: number,
): Promise<string[]> {
  const db = getDb();
  const visited = new Set<string>(seedEntityIds);
  let frontier = [...seedEntityIds];

  for (let hop = 0; hop < hopDepth && visited.size < totalResultCap; hop++) {
    const nextFrontier: string[] = [];

    for (const entityId of frontier) {
      if (visited.size >= totalResultCap) break;

      // Outgoing neighbors
      const outResults = await db.query<[Array<{ out: string; confidence: number }>]>(
        `SELECT out, confidence FROM related
         WHERE in = $eid AND status = 'active' AND stale = false
         ORDER BY confidence DESC
         LIMIT $limit`,
        { eid: new StringRecordId(entityId), limit: maxNeighborsPerHop },
      );

      // Incoming neighbors
      const inResults = await db.query<[Array<{ in: string; confidence: number }>]>(
        `SELECT in, confidence FROM related
         WHERE out = $eid AND status = 'active' AND stale = false
         ORDER BY confidence DESC
         LIMIT $limit`,
        { eid: new StringRecordId(entityId), limit: maxNeighborsPerHop },
      );

      const neighbors: string[] = [
        ...(outResults[0] ?? []).map((r) => String(r.out)),
        ...(inResults[0] ?? []).map((r) => String(r.in)),
      ];

      for (const neighborId of neighbors) {
        if (!visited.has(neighborId) && visited.size < totalResultCap) {
          visited.add(neighborId);
          nextFrontier.push(neighborId);
        }
      }
    }

    frontier = nextFrontier;
  }

  // Remove seeds from result (caller already has them)
  return [...visited].filter((id) => !seedEntityIds.includes(id));
}
