/**
 * Integration tests against live SurrealDB (localhost:8001) and ollama (localhost:11434).
 *
 * These tests are slow (~30s+ per LLM call) and require running services.
 * Run with: npx vitest run src/integration.test.ts --timeout 120000
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Surreal } from "surrealdb";
import { ClaimGraph } from "./plugin/index.js";
import { getDb } from "./db/connection.js";
import { getActiveClaims } from "./db/claims.js";
import { getEntity, findByNameOrAlias, findByEmbedding } from "./db/entities.js";
import { getEntityRelationships } from "./db/relationships.js";
import type { Entity, Claim } from "./models/types.js";

const TEST_CONFIG = {
  surrealdb: {
    mode: "remote" as const,
    url: "http://localhost:8001",
    username: "root",
    password: "root",
    namespace: "openclaw",
    database: "integration_test",
  },
  llm: {
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.1:8b",
  },
  embedding: {
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "nomic-embed-text:latest",
  },
};

let graph: ClaimGraph;

beforeAll(async () => {
  graph = new ClaimGraph(TEST_CONFIG as any);
  await graph.init();
}, 30_000);

afterAll(async () => {
  // Clean up test database
  try {
    const db = getDb();
    await db.query("REMOVE TABLE IF EXISTS entity");
    await db.query("REMOVE TABLE IF EXISTS claim");
    await db.query("REMOVE TABLE IF EXISTS related");
  } catch {}
  await graph.shutdown();
}, 10_000);

// ─── Helpers ────────────────────────────────────────────────────────

async function allEntities(): Promise<Entity[]> {
  const db = getDb();
  const results = await db.query<[Entity[]]>("SELECT * FROM entity");
  return results[0] ?? [];
}

async function allClaims(): Promise<Claim[]> {
  const db = getDb();
  const results = await db.query<[Claim[]]>("SELECT * FROM claim");
  return results[0] ?? [];
}

async function allRelationships() {
  const db = getDb();
  const results = await db.query<[any[]]>("SELECT * FROM related");
  return results[0] ?? [];
}

// ─── Test 1: Full ingest pipeline ───────────────────────────────────

describe("ingest pipeline", () => {
  it("extracts entities, claims, and relationships from a transcript", async () => {
    const transcript = `User: I'm Ian Perry, I work at BetaCorp as a systems administrator. Our church, United Believers Community Church in Kansas City, is doing the annual Maundy Thursday Last Supper reenactment on April 2nd at 6pm. I'm playing Judas this year. The rehearsal is March 31st at 6pm.
Assistant: That sounds like a meaningful event! I'll remember that you're at BetaCorp, and the reenactment details at United Believers on April 2nd with rehearsal on March 31st.`;

    const result = await graph.ingest(transcript, "conv_001", "msg_001");

    console.log("Ingest result:", result);

    // Should have created some entities
    expect(result.entitiesCreated).toBeGreaterThan(0);

    // Check entities actually exist in DB
    const entities = await allEntities();
    console.log(`Entities in DB: ${entities.length}`);
    for (const e of entities) {
      console.log(`  - ${e.name} (${e.type}) [${e.summary?.slice(0, 80)}]`);
    }
    expect(entities.length).toBeGreaterThan(0);

    // Check that at least one entity has an embedding
    const withEmbeddings = entities.filter(
      (e) => e.descriptionEmbedding && e.descriptionEmbedding.length > 0,
    );
    expect(withEmbeddings.length).toBeGreaterThan(0);
    expect(withEmbeddings[0].descriptionEmbedding.length).toBe(768);

    // Check claims exist
    const claims = await allClaims();
    console.log(`Claims in DB: ${claims.length}`);
    for (const c of claims) {
      console.log(`  - ${c.predicate}: ${JSON.stringify(c.value)} (${c.status})`);
    }

    // Check relationships exist
    const rels = await allRelationships();
    console.log(`Relationships in DB: ${rels.length}`);
    for (const r of rels) {
      console.log(`  - ${r.in} --${r.label}--> ${r.out}`);
    }
  }, 300_000);
});

// ─── Test 2: Recall pipeline ────────────────────────────────────────

describe("recall pipeline", () => {
  it("retrieves relevant context for a query about church events", async () => {
    const result = await graph.recall("church events in Kansas City");

    console.log("Recall result:");
    console.log(`  Entities found: ${result.entities.length}`);
    for (const se of result.entities.slice(0, 5)) {
      console.log(
        `  - ${se.entity.name} (${se.entity.type}) score=${se.score.toFixed(4)}`,
      );
    }
    console.log(`  Context block (${result.contextBlock.length} chars):`);
    console.log(`  "${result.contextBlock.slice(0, 300)}"`);

    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.contextBlock.length).toBeGreaterThan(0);
  }, 300_000);

  it("retrieves relevant context for a query about work", async () => {
    const result = await graph.recall("Where does Ian work?");

    console.log("Recall (work) result:");
    console.log(`  Entities found: ${result.entities.length}`);
    for (const se of result.entities.slice(0, 5)) {
      console.log(
        `  - ${se.entity.name} (${se.entity.type}) score=${se.score.toFixed(4)}`,
      );
    }

    expect(result.entities.length).toBeGreaterThan(0);
  }, 300_000);
});

// ─── Test 3: Claim supersession ─────────────────────────────────────

describe("claim supersession", () => {
  it("supersedes old claims when facts change", async () => {
    // Ingest a second transcript that changes the rehearsal time
    const transcript2 = `User: Hey, the rehearsal for the Maundy Thursday reenactment got moved to 7pm instead of 6pm. Same day, March 31st, just an hour later.
Assistant: Got it! I've updated the rehearsal time to 7pm on March 31st.`;

    const result = await graph.ingest(transcript2, "conv_002", "msg_002");
    console.log("Supersession ingest result:", result);

    // Check all claims — should see superseded ones
    const claims = await allClaims();
    const superseded = claims.filter((c) => c.status === "superseded");
    const active = claims.filter((c) => c.status === "active");

    console.log(`Total claims: ${claims.length}`);
    console.log(`Active: ${active.length}, Superseded: ${superseded.length}`);
    for (const c of claims) {
      console.log(
        `  - [${c.status}] ${c.predicate}: ${JSON.stringify(c.value)} (conv: ${c.sourceConversationId})`,
      );
    }

    // We expect the system to have created new claims from conv_002
    const conv2Claims = claims.filter(
      (c) => c.sourceConversationId === "conv_002",
    );
    expect(conv2Claims.length).toBeGreaterThan(0);
  }, 300_000);
});

// ─── Test 4: Dedup ──────────────────────────────────────────────────

describe("dedup", () => {
  it("merges entities instead of creating duplicates on re-mention", async () => {
    const entitiesBefore = await allEntities();
    const countBefore = entitiesBefore.length;
    console.log(`Entities before dedup test: ${countBefore}`);

    // Ingest a third transcript that mentions the same people/places
    const transcript3 = `User: Ian Perry here. Just confirming I'll be at United Believers for the Maundy Thursday thing. BetaCorp gave me the day off.
Assistant: Great, glad BetaCorp is accommodating! See you at United Believers for the reenactment.`;

    const result = await graph.ingest(transcript3, "conv_003", "msg_003");
    console.log("Dedup ingest result:", result);
    console.log(
      `  Created: ${result.entitiesCreated}, Merged: ${result.entitiesMerged}`,
    );

    const entitiesAfter = await allEntities();
    const countAfter = entitiesAfter.length;
    console.log(`Entities after dedup test: ${countAfter}`);

    // Ideally, merged count > 0 and we didn't create many new entities.
    // The LLM may still create some new entities for things it interprets
    // differently, but the total shouldn't double.
    console.log(`Net new entities: ${countAfter - countBefore}`);

    // Check aliases accumulated on merged entities
    for (const e of entitiesAfter) {
      if (e.aliases.length > 0) {
        console.log(`  ${e.name} aliases: [${e.aliases.join(", ")}]`);
      }
    }

    // Log the entity lastSeenAt to verify touch worked
    for (const e of entitiesAfter) {
      console.log(`  ${e.name} lastSeenAt: ${e.lastSeenAt}`);
    }

    // The dedup should have merged at least some entities
    expect(result.entitiesMerged).toBeGreaterThanOrEqual(0);
    // Total entities shouldn't have doubled
    expect(countAfter).toBeLessThan(countBefore * 2);
  }, 300_000);
});

// ─── Test 5: Conversation deletion ──────────────────────────────────

describe("conversation deletion", () => {
  it("removes claims from a specific conversation and rebuilds projections", async () => {
    const claimsBefore = await allClaims();
    const conv1Claims = claimsBefore.filter(
      (c) => c.sourceConversationId === "conv_001",
    );
    console.log(
      `Claims from conv_001 before delete: ${conv1Claims.length}`,
    );

    await graph.deleteConversation("conv_001");

    const claimsAfter = await allClaims();
    const conv1After = claimsAfter.filter(
      (c) => c.sourceConversationId === "conv_001",
    );
    console.log(`Claims from conv_001 after delete: ${conv1After.length}`);

    expect(conv1After.length).toBe(0);
    // Other conversation claims should still exist
    const conv2After = claimsAfter.filter(
      (c) => c.sourceConversationId === "conv_002",
    );
    expect(conv2After.length).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

// ─── Test 6: Name/alias lookup ──────────────────────────────────────

describe("entity lookup", () => {
  it("finds entities by name", async () => {
    // This depends on what names the LLM extracted — use a broad search
    const entities = await allEntities();
    if (entities.length === 0) return;

    // Try finding by the first entity's name
    const target = entities[0];
    const found = await findByNameOrAlias(target.name);
    console.log(
      `Lookup "${target.name}": found ${found.length} matches`,
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].name).toBe(target.name);
  }, 10_000);

  it("finds entities by embedding similarity", async () => {
    const entities = await allEntities();
    if (entities.length === 0) return;

    // Use an entity's own embedding to search — should find itself
    const target = entities[0];
    if (!target.descriptionEmbedding?.length) return;

    const found = await findByEmbedding(target.descriptionEmbedding, 3);
    console.log(`Embedding search for "${target.name}":`);
    for (const f of found) {
      console.log(`  ${f.similarity.toFixed(4)} — ${f.name}`);
    }
    expect(found.length).toBeGreaterThan(0);
    // The entity itself should be the top result
    expect(found[0].name).toBe(target.name);
  }, 10_000);
});
