/**
 * Core data model types for the claims-backed knowledge graph.
 */

// --- Claim status ---

export type ClaimStatus = "active" | "superseded" | "disputed";

// --- Entity node ---

export interface Entity {
  id?: string;
  type: string;
  typeConfidence: number;
  name: string;
  aliases: string[];
  properties: Record<string, unknown>;
  summary: string;
  descriptionEmbedding: number[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  stale: boolean;
  archived: boolean;
  projectionDirty: boolean;
  projectionVersion: number;
  lastProjectedAt: string;
  typeConflicts: TypeConflict[];
}

export interface TypeConflict {
  proposedType: string;
  proposedConfidence: number;
  existingType: string;
  existingConfidence: number;
  timestamp: string;
}

// --- Scalar claim ---

export interface Claim {
  id?: string;
  entity: string;
  predicate: string;
  value: unknown;
  status: ClaimStatus;
  supersededBy: string | null;
  stale: boolean;
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  sourceConversationId: string;
  sourceMessageId: string;
  extractedAt: string;
  extractorModel: string;
}

// --- Relationship edge ---

export interface Relationship {
  id?: string;
  in: string;
  out: string;
  label: string;
  rawLabel: string;
  properties: Record<string, unknown>;
  status: ClaimStatus;
  stale: boolean;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  sourceConversationId: string;
  sourceMessageId: string;
  extractedAt: string;
  extractorModel: string;
}

// --- Extraction output types ---

export type ChangeHint =
  | null
  | "started"
  | "ended"
  | "replaces_prior_value"
  | "negation";

export interface ExtractedEntity {
  ref: string;
  name: string;
  type: string;
  typeConfidence: number;
  description: string;
  properties: Record<string, unknown>;
  salience: number;
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  label: string;
  properties: Record<string, unknown>;
  confidence: number;
  changeHint: ChangeHint;
}

export interface ExtractedPropertyClaim {
  subject: string;
  predicate: string;
  value: unknown;
  confidence: number;
  changeHint: ChangeHint;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  propertyClaims: ExtractedPropertyClaim[];
}

// --- Dedup result ---

export type DedupOutcome =
  | { kind: "match"; existingEntityId: string }
  | { kind: "new" };

export interface DedupResult {
  extracted: ExtractedEntity;
  outcome: DedupOutcome;
}

// --- Provenance ---

export interface Provenance {
  sourceConversationId: string;
  sourceMessageId: string;
  extractedAt: string;
  extractorModel: string;
}
