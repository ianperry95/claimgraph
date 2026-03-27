import { z } from "zod/v4";

const predicateMode = z.enum([
  "additive",
  "single-current",
  "temporal",
  "multi-valued",
]);

const predicateSemanticSchema = z.object({
  mode: predicateMode,
  materializeTo: z.string().optional(),
});

const surrealdbSchema = z.object({
  mode: z.enum(["embedded", "remote"]).default("embedded"),
  path: z.string().default("~/.claimgraph/data"),
  url: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  namespace: z.string().default("claimgraph"),
  database: z.string().default("graph_memory"),
});

const endpointSchema = z.object({
  baseURL: z.string(),
  apiKey: z.string(),
  model: z.string(),
});

export const configSchema = z.object({
  surrealdb: surrealdbSchema.optional(),
  embedding: endpointSchema.optional(),
  llm: endpointSchema.optional(),
  dedup: z.object({
    similarityThreshold: z.number().min(0).max(1).optional(),
    ambiguousZoneLow: z.number().min(0).max(1).optional(),
  }).optional(),
  traversal: z.object({
    hopDepth: z.number().int().min(0).optional(),
    maxNeighborsPerHop: z.number().int().min(1).optional(),
    totalResultCap: z.number().int().min(1).optional(),
    topK: z.number().int().min(1).optional(),
  }).optional(),
  retrieval: z.object({
    contextBudgetTokens: z.number().int().min(1).optional(),
    staleWeight: z.number().min(0).max(1).optional(),
  }).optional(),
  salience: z.object({
    threshold: z.number().min(0).max(1).optional(),
  }).optional(),
  type: z.object({
    overrideMargin: z.number().min(0).max(1).optional(),
  }).optional(),
  summary: z.object({
    maxChars: z.number().int().min(1).optional(),
  }).optional(),
  backgroundPass: z.object({
    maxCandidatesPerEntity: z.number().int().min(1).optional(),
    similarityFloor: z.number().min(0).max(1).optional(),
    maxEntitiesPerCycle: z.number().int().min(1).optional(),
  }).optional(),
  staleness: z.object({
    eventTTLDays: z.number().int().min(1).optional(),
    factTTLDays: z.number().int().min(1).optional(),
    archiveAfterDays: z.number().int().min(1).optional(),
  }).optional(),
  predicateSemantics: z.record(z.string(), predicateSemanticSchema).optional(),
});

/** Resolved config with all defaults applied. */
export interface Config {
  surrealdb: {
    mode: "embedded" | "remote";
    path: string;
    url?: string;
    username?: string;
    password?: string;
    namespace: string;
    database: string;
  };
  embedding: { baseURL: string; apiKey: string; model: string };
  llm: { baseURL: string; apiKey: string; model: string };
  dedup: { similarityThreshold: number; ambiguousZoneLow: number };
  traversal: {
    hopDepth: number;
    maxNeighborsPerHop: number;
    totalResultCap: number;
    topK: number;
  };
  retrieval: { contextBudgetTokens: number; staleWeight: number };
  salience: { threshold: number };
  type: { overrideMargin: number };
  summary: { maxChars: number };
  backgroundPass: {
    maxCandidatesPerEntity: number;
    similarityFloor: number;
    maxEntitiesPerCycle: number;
  };
  staleness: {
    eventTTLDays: number;
    factTTLDays: number;
    archiveAfterDays: number;
  };
  predicateSemantics: Record<string, PredicateSemantic>;
}

export type PredicateMode = z.infer<typeof predicateMode>;
export type PredicateSemantic = z.infer<typeof predicateSemanticSchema>;

const DEFAULT_PREDICATE_SEMANTICS: Record<string, PredicateSemantic> = {
  alias: { mode: "additive", materializeTo: "aliases" },
  "event.date": { mode: "single-current", materializeTo: "properties.date" },
  "event.location": { mode: "single-current", materializeTo: "properties.location" },
  works_at: { mode: "temporal", materializeTo: "properties.currentEmployer" },
  lives_in: { mode: "temporal", materializeTo: "properties.currentLocation" },
  participant: { mode: "multi-valued" },
  member_of: { mode: "multi-valued" },
  status: { mode: "single-current", materializeTo: "properties.status" },
};

/**
 * Parse and apply defaults to produce a fully-resolved Config.
 */
export function resolveConfig(overrides: Record<string, unknown> = {}): Config {
  const parsed = configSchema.parse(overrides);
  return {
    surrealdb: {
      mode: parsed.surrealdb?.mode ?? "embedded",
      path: parsed.surrealdb?.path ?? "~/.claimgraph/data",
      url: parsed.surrealdb?.url,
      username: parsed.surrealdb?.username,
      password: parsed.surrealdb?.password,
      namespace: parsed.surrealdb?.namespace ?? "claimgraph",
      database: parsed.surrealdb?.database ?? "graph_memory",
    },
    embedding: {
      baseURL: parsed.embedding?.baseURL ?? "http://localhost:11434/v1",
      apiKey: parsed.embedding?.apiKey ?? "ollama",
      model: parsed.embedding?.model ?? "nomic-embed-text:v1.5",
    },
    llm: {
      baseURL: parsed.llm?.baseURL ?? "http://localhost:11434/v1",
      apiKey: parsed.llm?.apiKey ?? "ollama",
      model: parsed.llm?.model ?? "llama3.1:8b-instruct-q8_0",
    },
    dedup: {
      similarityThreshold: parsed.dedup?.similarityThreshold ?? 0.92,
      ambiguousZoneLow: parsed.dedup?.ambiguousZoneLow ?? 0.75,
    },
    traversal: {
      hopDepth: parsed.traversal?.hopDepth ?? 2,
      maxNeighborsPerHop: parsed.traversal?.maxNeighborsPerHop ?? 3,
      totalResultCap: parsed.traversal?.totalResultCap ?? 30,
      topK: parsed.traversal?.topK ?? 5,
    },
    retrieval: {
      contextBudgetTokens: parsed.retrieval?.contextBudgetTokens ?? 500,
      staleWeight: parsed.retrieval?.staleWeight ?? 0.3,
    },
    salience: {
      threshold: parsed.salience?.threshold ?? 0.5,
    },
    type: {
      overrideMargin: parsed.type?.overrideMargin ?? 0.2,
    },
    summary: {
      maxChars: parsed.summary?.maxChars ?? 500,
    },
    backgroundPass: {
      maxCandidatesPerEntity: parsed.backgroundPass?.maxCandidatesPerEntity ?? 5,
      similarityFloor: parsed.backgroundPass?.similarityFloor ?? 0.70,
      maxEntitiesPerCycle: parsed.backgroundPass?.maxEntitiesPerCycle ?? 20,
    },
    staleness: {
      eventTTLDays: parsed.staleness?.eventTTLDays ?? 30,
      factTTLDays: parsed.staleness?.factTTLDays ?? 180,
      archiveAfterDays: parsed.staleness?.archiveAfterDays ?? 365,
    },
    predicateSemantics: parsed.predicateSemantics ?? DEFAULT_PREDICATE_SEMANTICS,
  };
}
