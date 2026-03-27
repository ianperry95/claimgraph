import type { Surreal } from "surrealdb";

/**
 * Initialize the SurrealDB schema: tables, fields, indexes.
 * Idempotent — safe to run on every startup.
 */
export async function initSchema(db: Surreal): Promise<void> {
  // --- Entity table ---
  await db.query(`
    DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;

    DEFINE FIELD IF NOT EXISTS type ON entity TYPE string;
    DEFINE FIELD IF NOT EXISTS typeConfidence ON entity TYPE float;
    DEFINE FIELD IF NOT EXISTS name ON entity TYPE string;
    DEFINE FIELD IF NOT EXISTS aliases ON entity TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS properties ON entity TYPE object FLEXIBLE;
    DEFINE FIELD IF NOT EXISTS summary ON entity TYPE string DEFAULT '';
    DEFINE FIELD IF NOT EXISTS descriptionEmbedding ON entity TYPE array<float>;
    DEFINE FIELD IF NOT EXISTS createdAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS updatedAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS lastSeenAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS stale ON entity TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS archived ON entity TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS projectionDirty ON entity TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS projectionVersion ON entity TYPE int DEFAULT 0;
    DEFINE FIELD IF NOT EXISTS lastProjectedAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS typeConflicts ON entity TYPE any DEFAULT [];
    DEFINE FIELD IF NOT EXISTS typeConflicts[*] ON entity TYPE object FLEXIBLE;
  `);

  // Entity indexes
  await db.query(`
    DEFINE INDEX IF NOT EXISTS idx_entity_name ON entity FIELDS name;
    DEFINE INDEX IF NOT EXISTS idx_entity_aliases ON entity FIELDS aliases;
    DEFINE INDEX IF NOT EXISTS idx_entity_type ON entity FIELDS type;
    DEFINE INDEX IF NOT EXISTS idx_entity_stale ON entity FIELDS stale;
    DEFINE INDEX IF NOT EXISTS idx_entity_archived ON entity FIELDS archived;
  `);

  // Vector index for entity description embeddings
  await db.query(`
    DEFINE INDEX IF NOT EXISTS idx_entity_embedding ON entity FIELDS descriptionEmbedding
      HNSW DIMENSION 768 DIST COSINE;
  `);

  // --- Claim table ---
  await db.query(`
    DEFINE TABLE IF NOT EXISTS claim SCHEMAFULL;

    DEFINE FIELD IF NOT EXISTS entity ON claim TYPE record<entity>;
    DEFINE FIELD IF NOT EXISTS predicate ON claim TYPE string;
    DEFINE FIELD IF NOT EXISTS value ON claim TYPE any;
    DEFINE FIELD IF NOT EXISTS status ON claim TYPE string DEFAULT 'active'
      ASSERT $value IN ['active', 'superseded', 'disputed'];
    DEFINE FIELD IF NOT EXISTS supersededBy ON claim TYPE option<record<claim>>;
    DEFINE FIELD IF NOT EXISTS stale ON claim TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS confidence ON claim TYPE float;
    DEFINE FIELD IF NOT EXISTS validFrom ON claim TYPE option<datetime>;
    DEFINE FIELD IF NOT EXISTS validTo ON claim TYPE option<datetime>;
    DEFINE FIELD IF NOT EXISTS sourceConversationId ON claim TYPE string;
    DEFINE FIELD IF NOT EXISTS sourceMessageId ON claim TYPE string;
    DEFINE FIELD IF NOT EXISTS extractedAt ON claim TYPE datetime;
    DEFINE FIELD IF NOT EXISTS extractorModel ON claim TYPE string;
  `);

  // Claim indexes
  await db.query(`
    DEFINE INDEX IF NOT EXISTS idx_claim_entity ON claim FIELDS entity;
    DEFINE INDEX IF NOT EXISTS idx_claim_entity_predicate ON claim FIELDS entity, predicate;
    DEFINE INDEX IF NOT EXISTS idx_claim_status ON claim FIELDS status;
    DEFINE INDEX IF NOT EXISTS idx_claim_conversation ON claim FIELDS sourceConversationId;
    DEFINE INDEX IF NOT EXISTS idx_claim_idempotent ON claim FIELDS sourceConversationId, entity, predicate, value UNIQUE;
  `);

  // --- Relationship edge table ---
  await db.query(`
    DEFINE TABLE IF NOT EXISTS related SCHEMAFULL TYPE RELATION IN entity OUT entity;

    DEFINE FIELD IF NOT EXISTS label ON related TYPE string;
    DEFINE FIELD IF NOT EXISTS rawLabel ON related TYPE string;
    DEFINE FIELD IF NOT EXISTS properties ON related TYPE object FLEXIBLE DEFAULT {};
    DEFINE FIELD IF NOT EXISTS status ON related TYPE string DEFAULT 'active'
      ASSERT $value IN ['active', 'superseded', 'disputed'];
    DEFINE FIELD IF NOT EXISTS stale ON related TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS validFrom ON related TYPE option<datetime>;
    DEFINE FIELD IF NOT EXISTS validTo ON related TYPE option<datetime>;
    DEFINE FIELD IF NOT EXISTS confidence ON related TYPE float;
    DEFINE FIELD IF NOT EXISTS sourceConversationId ON related TYPE string;
    DEFINE FIELD IF NOT EXISTS sourceMessageId ON related TYPE string;
    DEFINE FIELD IF NOT EXISTS extractedAt ON related TYPE datetime;
    DEFINE FIELD IF NOT EXISTS extractorModel ON related TYPE string;
  `);

  // Relationship indexes
  await db.query(`
    DEFINE INDEX IF NOT EXISTS idx_related_label ON related FIELDS label;
    DEFINE INDEX IF NOT EXISTS idx_related_status ON related FIELDS status;
    DEFINE INDEX IF NOT EXISTS idx_related_conversation ON related FIELDS sourceConversationId;
  `);
}
