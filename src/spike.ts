/**
 * Phase 1 Spike: Validate SurrealDB + ollama integration end-to-end.
 *
 * Run with: npx tsx src/spike.ts
 */
import { Surreal, RecordId, StringRecordId } from "surrealdb";
import OpenAI from "openai";

const SURREAL_URL = "http://localhost:8001";
const SURREAL_USER = "root";
const SURREAL_PASS = "root";
const SURREAL_NS = "openclaw";
const SURREAL_DB = "spike_test";

const OLLAMA_URL = "http://localhost:11434/v1";
const EMBED_MODEL = "nomic-embed-text:latest";
const LLM_MODEL = "llama3.1:8b";

async function main() {
  console.log("=== Phase 1 Spike ===\n");

  // --- 1. Connect to SurrealDB ---
  console.log("1. Connecting to SurrealDB...");
  const db = new Surreal();
  await db.connect(SURREAL_URL);
  await db.signin({ username: SURREAL_USER, password: SURREAL_PASS });
  await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${SURREAL_NS}`);
  await db.use({ namespace: SURREAL_NS, database: SURREAL_DB });
  console.log("   Connected.\n");

  // --- 2. Define schema ---
  console.log("2. Defining schema...");
  await db.query(`
    DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS type ON entity TYPE string;
    DEFINE FIELD IF NOT EXISTS name ON entity TYPE string;
    DEFINE FIELD IF NOT EXISTS aliases ON entity TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS summary ON entity TYPE string DEFAULT '';
    DEFINE FIELD IF NOT EXISTS properties ON entity TYPE object;
    DEFINE FIELD IF NOT EXISTS descriptionEmbedding ON entity TYPE array<float>;
    DEFINE FIELD IF NOT EXISTS createdAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS lastSeenAt ON entity TYPE datetime;
    DEFINE FIELD IF NOT EXISTS stale ON entity TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS archived ON entity TYPE bool DEFAULT false;
  `);
  await db.query(`
    DEFINE INDEX IF NOT EXISTS idx_entity_name ON entity FIELDS name;
    DEFINE INDEX IF NOT EXISTS idx_entity_embedding ON entity FIELDS descriptionEmbedding
      HNSW DIMENSION 768 DIST COSINE;
  `);
  await db.query(`
    DEFINE TABLE IF NOT EXISTS related SCHEMAFULL TYPE RELATION IN entity OUT entity;
    DEFINE FIELD IF NOT EXISTS label ON related TYPE string;
    DEFINE FIELD IF NOT EXISTS confidence ON related TYPE float;
  `);
  console.log("   Schema defined.\n");

  // --- 3. Test embedding ---
  console.log("3. Testing embedding (nomic-embed-text)...");
  const oai = new OpenAI({ baseURL: OLLAMA_URL, apiKey: "ollama" });

  const t0 = performance.now();
  const embResponse = await oai.embeddings.create({
    model: EMBED_MODEL,
    input: "Ian Perry is a systems administrator active in local church community in Kansas City.",
  });
  const embTime = (performance.now() - t0).toFixed(0);
  const embedding = embResponse.data[0].embedding;
  console.log(`   Embedding dim: ${embedding.length}, latency: ${embTime}ms`);

  // Batch test
  const t1 = performance.now();
  const batchResponse = await oai.embeddings.create({
    model: EMBED_MODEL,
    input: [
      "Maundy Thursday service at United Believers Community Church",
      "BetaCorp software company in Kansas City",
      "Annual church reenactment of the Last Supper",
    ],
  });
  const batchTime = (performance.now() - t1).toFixed(0);
  console.log(`   Batch of 3: ${batchTime}ms (${batchResponse.data.length} vectors)\n`);

  // --- 4. Insert entities with embeddings ---
  console.log("4. Inserting entities...");
  const now = new Date();

  const entities = [
    {
      id: "ian_perry",
      type: "person",
      name: "Ian Perry",
      summary: "Systems administrator, active in local church community in Kansas City.",
      input: "Ian Perry is a systems administrator active in local church community in Kansas City.",
    },
    {
      id: "maundy_thursday",
      type: "event",
      name: "Maundy Thursday Last Supper Reenactment",
      summary: "Annual reenactment at United Believers, April 2 2026 at 6pm.",
      input: "Maundy Thursday Last Supper Reenactment at United Believers Community Church, annual event.",
    },
    {
      id: "betacorp",
      type: "organization",
      name: "BetaCorp",
      summary: "Software company in Kansas City where Ian Perry works.",
      input: "BetaCorp is a software company in Kansas City.",
    },
    {
      id: "united_believers",
      type: "organization",
      name: "United Believers Community Church",
      summary: "Church in Kansas City MO where the Maundy Thursday reenactment takes place.",
      input: "United Believers Community Church in Kansas City MO, hosts annual Maundy Thursday reenactment.",
    },
  ];

  // Embed all descriptions in one batch
  const allEmbeddings = await oai.embeddings.create({
    model: EMBED_MODEL,
    input: entities.map((e) => e.input),
  });
  const vectors = allEmbeddings.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    await db.create(new RecordId("entity", e.id)).content({
      type: e.type,
      name: e.name,
      aliases: [] as string[],
      summary: e.summary,
      properties: {},
      descriptionEmbedding: vectors[i],
      createdAt: now,
      lastSeenAt: now,
      stale: false,
      archived: false,
    });
  }
  console.log(`   Inserted ${entities.length} entities.\n`);

  // --- 5. Create relationships ---
  console.log("5. Creating relationships...");
  await db.query(
    `RELATE $from->related->$to SET label = 'works_at', confidence = 0.95`,
    {
      from: new RecordId("entity", "ian_perry"),
      to: new RecordId("entity", "betacorp"),
    },
  );
  await db.query(
    `RELATE $from->related->$to SET label = 'participant', confidence = 0.92`,
    {
      from: new RecordId("entity", "ian_perry"),
      to: new RecordId("entity", "maundy_thursday"),
    },
  );
  await db.query(
    `RELATE $from->related->$to SET label = 'hosted_at', confidence = 0.97`,
    {
      from: new RecordId("entity", "maundy_thursday"),
      to: new RecordId("entity", "united_believers"),
    },
  );
  console.log("   Created 3 edges.\n");

  // --- 6. Vector similarity search ---
  console.log("6. Vector similarity search...");
  const queryEmb = await oai.embeddings.create({
    model: EMBED_MODEL,
    input: "church events in Kansas City",
  });
  const qVec = queryEmb.data[0].embedding;

  const t2 = performance.now();
  const results = await db.query<[Array<{ id: unknown; name: string; type: string; similarity: number }>]>(
    `SELECT id, name, type, vector::similarity::cosine(descriptionEmbedding, $emb) AS similarity
     FROM entity
     WHERE archived = false
     ORDER BY similarity DESC
     LIMIT 5`,
    { emb: qVec },
  );
  const searchTime = (performance.now() - t2).toFixed(0);

  console.log(`   Query: "church events in Kansas City" (${searchTime}ms)`);
  for (const r of results[0] ?? []) {
    console.log(`   ${r.similarity.toFixed(4)} — ${r.name} (${r.type})`);
  }
  console.log();

  // --- 7. Graph traversal ---
  console.log("7. Graph traversal from ian_perry (2 hops)...");
  const t3 = performance.now();
  const hop1out = await db.query<[Array<{ neighbor: unknown; label: string }>]>(
    `SELECT out AS neighbor, label FROM related WHERE in = $eid`,
    { eid: new RecordId("entity", "ian_perry") },
  );
  const hop1in = await db.query<[Array<{ neighbor: unknown; label: string }>]>(
    `SELECT in AS neighbor, label FROM related WHERE out = $eid`,
    { eid: new RecordId("entity", "ian_perry") },
  );
  const neighbors1 = [...(hop1out[0] ?? []), ...(hop1in[0] ?? [])];
  console.log(`   Hop 1 (${(performance.now() - t3).toFixed(0)}ms): ${neighbors1.length} neighbors`);
  for (const n of neighbors1) {
    console.log(`     → ${n.label} → ${n.neighbor}`);
  }

  // Hop 2 from each neighbor
  for (const n of neighbors1) {
    const nId = n.neighbor;
    const h2out = await db.query<[Array<{ neighbor: unknown; label: string }>]>(
      `SELECT out AS neighbor, label FROM related WHERE in = $eid AND out != $origin`,
      { eid: nId, origin: new RecordId("entity", "ian_perry") },
    );
    const h2in = await db.query<[Array<{ neighbor: unknown; label: string }>]>(
      `SELECT in AS neighbor, label FROM related WHERE out = $eid AND in != $origin`,
      { eid: nId, origin: new RecordId("entity", "ian_perry") },
    );
    const neighbors2 = [...(h2out[0] ?? []), ...(h2in[0] ?? [])];
    if (neighbors2.length > 0) {
      console.log(`   Hop 2 from ${nId}:`);
      for (const n2 of neighbors2) {
        console.log(`     → ${n2.label} → ${n2.neighbor}`);
      }
    }
  }
  console.log();

  // --- 8. LLM extraction test ---
  console.log("8. LLM extraction test...");
  const t4 = performance.now();
  const llmResponse = await oai.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `Extract entities and relationships from the conversation. Output JSON only:
{"entities":[{"ref":"e1","name":"...","type":"person|place|org|event","description":"...","salience":0.0-1.0}],"relationships":[{"from":"e1","to":"e2","label":"...","confidence":0.0-1.0}],"propertyClaims":[{"subject":"e1","predicate":"...","value":"...","confidence":0.0-1.0}]}`,
      },
      {
        role: "user",
        content: `User: I just found out that the rehearsal for the Maundy Thursday reenactment got moved to Tuesday March 31st at 7pm instead of 6pm. Also, I started my new job at BetaCorp last week.
Assistant: Got it! I'll remember the rehearsal is now March 31st at 7pm, and congratulations on the new position at BetaCorp!`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const llmTime = (performance.now() - t4).toFixed(0);
  const extraction = llmResponse.choices[0]?.message?.content ?? "{}";
  console.log(`   LLM latency: ${llmTime}ms`);
  console.log(`   Output:\n${JSON.stringify(JSON.parse(extraction), null, 2)}\n`);

  // --- 9. Cleanup ---
  console.log("9. Cleaning up spike_test database...");
  await db.query("REMOVE TABLE entity");
  await db.query("REMOVE TABLE related");
  console.log("   Done.\n");

  await db.close();
  console.log("=== Spike complete ===");
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
