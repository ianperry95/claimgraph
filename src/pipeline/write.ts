import type { Config } from "../config/index.js";
import type { Provenance, ExtractionResult, DedupResult } from "../models/types.js";
import { extractFromTranscript, filterBySalience } from "./extraction.js";
import { dedupAll } from "./dedup.js";
import { createEntity, mergeEntity, touchEntity } from "../db/entities.js";
import { writeClaim, rebuildProjection } from "../db/claims.js";
import { writeRelationship } from "../db/relationships.js";

export interface WriteResult {
  entitiesCreated: number;
  entitiesMerged: number;
  claimsWritten: number;
  relationshipsWritten: number;
}

/**
 * Full post-session write pipeline:
 * 1. Extract → 2. Salience filter → 3. Dedup → 4. Convert & write claims →
 * 5. Write relationships → 6. Rebuild projections → 7. Update embeddings
 */
export async function writePipeline(
  config: Config,
  transcript: string,
  conversationId: string,
  messageId: string,
): Promise<WriteResult> {
  const provenance: Provenance = {
    sourceConversationId: conversationId,
    sourceMessageId: messageId,
    extractedAt: new Date().toISOString(),
    extractorModel: config.llm.model,
  };

  // 1. Extract
  const extraction = await extractFromTranscript(
    config,
    transcript,
    conversationId,
  );

  // 2. Salience filter
  const filtered = filterBySalience(extraction, config.salience.threshold);

  if (filtered.entities.length === 0) {
    return {
      entitiesCreated: 0,
      entitiesMerged: 0,
      claimsWritten: 0,
      relationshipsWritten: 0,
    };
  }

  // 3. Dedup
  const dedupResults = await dedupAll(config, filtered.entities);

  // Build ref → entityId map
  const refToEntityId = new Map<string, string>();
  let entitiesCreated = 0;
  let entitiesMerged = 0;

  // 4. Create or merge entities
  for (const result of dedupResults) {
    if (result.outcome.kind === "new") {
      const entityId = await createEntity(
        config,
        result.extracted,
        result.embedding,
      );
      refToEntityId.set(result.extracted.ref, entityId);
      entitiesCreated++;
    } else {
      const entityId = result.outcome.existingEntityId;
      await mergeEntity(config, entityId, result.extracted, result.embedding);
      await touchEntity(entityId);
      refToEntityId.set(result.extracted.ref, entityId);
      entitiesMerged++;
    }
  }

  // 5. Write property claims
  let claimsWritten = 0;
  for (const claim of filtered.propertyClaims) {
    const entityId = refToEntityId.get(claim.subject);
    if (!entityId) continue;

    const claimId = await writeClaim(
      config,
      entityId,
      claim.predicate,
      claim.value,
      claim.confidence,
      provenance,
      claim.changeHint,
    );
    if (claimId) claimsWritten++;
  }

  // Also write extracted entity properties as claims
  for (const result of dedupResults) {
    const entityId = refToEntityId.get(result.extracted.ref);
    if (!entityId) continue;

    for (const [key, value] of Object.entries(result.extracted.properties)) {
      const claimId = await writeClaim(
        config,
        entityId,
        key,
        value,
        result.extracted.typeConfidence,
        provenance,
      );
      if (claimId) claimsWritten++;
    }
  }

  // 6. Write relationships
  let relationshipsWritten = 0;
  for (const rel of filtered.relationships) {
    const fromId = refToEntityId.get(rel.from);
    const toId = refToEntityId.get(rel.to);
    if (!fromId || !toId) continue;

    const relId = await writeRelationship(
      config,
      fromId,
      toId,
      rel.label,
      rel.label,
      rel.properties,
      rel.confidence,
      provenance,
      rel.changeHint,
    );
    if (relId) relationshipsWritten++;
  }

  // 7. Rebuild projections for all touched entities
  const touchedEntities = new Set(refToEntityId.values());
  for (const entityId of touchedEntities) {
    await rebuildProjection(config, entityId);
  }

  return {
    entitiesCreated,
    entitiesMerged,
    claimsWritten,
    relationshipsWritten,
  };
}
