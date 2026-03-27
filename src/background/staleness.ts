import type { Config } from "../config/index.js";
import type { Entity } from "../models/types.js";
import { getDb } from "../db/connection.js";
import { rebuildProjection } from "../db/claims.js";

/**
 * Run a full staleness scan:
 * - Mark expired claims/edges as stale based on type-aware TTLs
 * - Archive entities unseen for > archiveAfterDays
 * - Repair dirty projections
 */
export async function runStalenessScan(config: Config): Promise<ScanResult> {
  const db = getDb();
  const now = Date.now();
  let claimsMarkedStale = 0;
  let edgesMarkedStale = 0;
  let entitiesArchived = 0;
  let projectionsRepaired = 0;

  // --- Mark stale claims based on entity type TTL ---

  // Event entities: claims stale after eventTTLDays past the event date
  const eventCutoff = new Date(
    now - config.staleness.eventTTLDays * 24 * 60 * 60 * 1000,
  );

  await db.query(
    `UPDATE claim SET stale = true
     WHERE status = 'active' AND stale = false
       AND entity IN (SELECT id FROM entity WHERE type = 'event')
       AND extractedAt < $cutoff
     RETURN NONE`,
    { cutoff: eventCutoff },
  );

  // Fact/preference entities: claims stale after factTTLDays
  const factCutoff = new Date(
    now - config.staleness.factTTLDays * 24 * 60 * 60 * 1000,
  );

  await db.query(
    `UPDATE claim SET stale = true
     WHERE status = 'active' AND stale = false
       AND entity IN (SELECT id FROM entity WHERE type IN ['concept', 'thing', 'project'])
       AND extractedAt < $cutoff
     RETURN NONE`,
    { cutoff: factCutoff },
  );

  // --- Mark stale relationship edges ---
  await db.query(
    `UPDATE related SET stale = true
     WHERE status = 'active' AND stale = false
       AND extractedAt < $cutoff
     RETURN NONE`,
    { cutoff: factCutoff },
  );

  // --- Archive entities unseen for > archiveAfterDays ---
  const archiveCutoff = new Date(
    now - config.staleness.archiveAfterDays * 24 * 60 * 60 * 1000,
  );

  const archived = await db.query<[Entity[]]>(
    `UPDATE entity SET archived = true
     WHERE archived = false AND lastSeenAt < $cutoff
     RETURN id`,
    { cutoff: archiveCutoff },
  );
  entitiesArchived = (archived[0] ?? []).length;

  // --- Repair dirty projections ---
  const dirtyEntities = await db.query<[Entity[]]>(
    `SELECT id FROM entity WHERE projectionDirty = true`,
  );

  for (const entity of dirtyEntities[0] ?? []) {
    if (entity.id) {
      await rebuildProjection(config, String(entity.id));
      projectionsRepaired++;
    }
  }

  return {
    claimsMarkedStale,
    edgesMarkedStale,
    entitiesArchived,
    projectionsRepaired,
  };
}

export interface ScanResult {
  claimsMarkedStale: number;
  edgesMarkedStale: number;
  entitiesArchived: number;
  projectionsRepaired: number;
}
