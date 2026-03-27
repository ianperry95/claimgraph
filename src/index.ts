export { ClaimGraph } from "./plugin/index.js";
export { createHttpServer, type HttpServerOptions } from "./server/http.js";
export { serveMcp } from "./server/mcp.js";
export type { Config, PredicateMode, PredicateSemantic } from "./config/index.js";
export type {
  Entity,
  Claim,
  Relationship,
  ClaimStatus,
  ChangeHint,
  ExtractionResult,
  ExtractedEntity,
  ExtractedRelationship,
  ExtractedPropertyClaim,
  DedupResult,
  DedupOutcome,
  Provenance,
} from "./models/types.js";
export type { WriteResult } from "./pipeline/write.js";
export type { RetrievalResult, ScoredEntity } from "./retrieval/retrieve.js";
export type { ScanResult } from "./background/staleness.js";
export type { DiscoveryResult } from "./background/discovery.js";
