# ClaimGraph

Claims-backed knowledge graph memory for AI agents. Entities are stable identity anchors; mutable knowledge lives in versioned property claims with full provenance. Drop-in self-hosted alternative to pure vector memory.

**Key ideas:** 3-tier hybrid deduplication (exact match, embedding similarity, LLM arbitration), type-aware staleness management, graph traversal for context retrieval, and predicate-specific claim semantics -- all backed by SurrealDB.

Usable as a **TypeScript library**, **REST server**, or **MCP tool server**.

## Quick start

Requires Node.js 20+, a running [SurrealDB](https://surrealdb.com/) instance (or use embedded mode), and an OpenAI-compatible inference endpoint (e.g. [Ollama](https://ollama.com/)).

```bash
npm install
npm run build
```

### As a library

```typescript
import { ClaimGraph } from "claimgraph";

const cg = new ClaimGraph();
await cg.init();

await cg.ingest(
  "Alice started working at Initech last Monday.",
  "conv-001"
);

const result = await cg.recall("Where does Alice work?");
console.log(result.contextBlock);

await cg.shutdown();
```

### As an HTTP server

```bash
npm run serve          # default: http://127.0.0.1:3377
# or after build:
claimgraph-serve --port 3377
```

### As an MCP server (stdio)

```bash
npm run mcp
# or after build:
claimgraph-mcp
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "claimgraph": {
      "command": "npx",
      "args": ["claimgraph-mcp"]
    }
  }
}
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ingest` | Ingest a conversation transcript |
| `POST` | `/recall` | Retrieve relevant memories for a query |
| `DELETE` | `/conversations/:id` | Delete all claims from a conversation |
| `POST` | `/maintenance/staleness` | Run staleness scan |
| `POST` | `/maintenance/discovery` | Run relationship discovery |
| `GET` | `/health` | Health check |

### Examples

```bash
# Ingest
curl -X POST http://localhost:3377/ingest \
  -H 'Content-Type: application/json' \
  -d '{"transcript": "Bob moved to Berlin in January.", "conversationId": "conv-42"}'

# Recall
curl -X POST http://localhost:3377/recall \
  -H 'Content-Type: application/json' \
  -d '{"query": "Where does Bob live?"}'
```

## MCP tools

| Tool | Description |
|------|-------------|
| `memory_ingest` | Ingest conversation transcript |
| `memory_recall` | Retrieve relevant memories |
| `memory_delete_conversation` | Delete claims from a conversation |
| `memory_staleness_scan` | Run staleness maintenance |
| `memory_discovery` | Run relationship discovery |

## How it works

### Write path

1. **Extract** -- LLM parses the transcript into entities, relationships, and property claims with salience scores.
2. **Deduplicate** -- 3-tier pipeline resolves each extracted entity against the graph:
   - Tier 1: exact name/alias match
   - Tier 2: embedding cosine similarity (default threshold: 0.92)
   - Tier 3: LLM arbitration for the ambiguous zone (0.75--0.92)
3. **Write** -- Claims are persisted with predicate-aware semantics. New claims can supersede, coexist with, or temporally succeed prior claims depending on the predicate mode.
4. **Project** -- Entity properties are materialized from their active claims.

### Read path

1. **Seed** -- Embed the query and vector-search for the top-K entities.
2. **Traverse** -- Walk the graph outward from seeds (configurable hop depth).
3. **Rank** -- Score candidates by similarity, recency, and staleness.
4. **Summarize** -- LLM generates a context block within a token budget.

### Predicate modes

| Mode | Behavior | Example predicates |
|------|----------|--------------------|
| `additive` | Claims accumulate | `alias` |
| `single-current` | New value supersedes old | `status`, `event.date` |
| `temporal` | Prior claim gets a `validTo` timestamp | `works_at`, `lives_in` |
| `multi-valued` | All values coexist | `participant`, `member_of` |

### Background tasks

- **Staleness scan** -- marks claims as stale based on type-aware TTLs (events: 30d, facts: 180d), archives entities unseen for over a year, and repairs dirty projections.
- **Discovery pass** -- finds potential cross-cluster relationships between entities that were never co-extracted, using embedding similarity and LLM verification.

## Configuration

ClaimGraph resolves config from constructor overrides, with sensible defaults for local Ollama usage. Key sections:

| Section | Key options | Defaults |
|---------|-------------|----------|
| `surrealdb` | `mode`, `path`, `url` | embedded, `~/.claimgraph/data` |
| `llm` | `baseURL`, `apiKey`, `model` | `localhost:11434/v1`, `llama3.1:8b-instruct-q8_0` |
| `embedding` | `baseURL`, `apiKey`, `model` | `localhost:11434/v1`, `nomic-embed-text:v1.5` |
| `dedup` | `similarityThreshold`, `ambiguousZoneLow` | 0.92, 0.75 |
| `traversal` | `hopDepth`, `topK`, `totalResultCap` | 2, 5, 30 |
| `staleness` | `eventTTLDays`, `factTTLDays`, `archiveAfterDays` | 30, 180, 365 |

### Environment variables

Override any LLM/embedding/SurrealDB setting via environment:

```
CLAIMGRAPH_LLM_BASE_URL
CLAIMGRAPH_LLM_API_KEY
CLAIMGRAPH_LLM_MODEL
CLAIMGRAPH_EMBEDDING_BASE_URL
CLAIMGRAPH_EMBEDDING_API_KEY
CLAIMGRAPH_EMBEDDING_MODEL
CLAIMGRAPH_SURREAL_MODE
CLAIMGRAPH_SURREAL_URL
CLAIMGRAPH_SURREAL_PATH
```

## Development

```bash
npm run dev            # watch mode
npm run test           # unit tests (vitest)
npm run test:watch     # tests in watch mode
npm run lint           # eslint
```

Integration tests require running SurrealDB and Ollama:

```bash
npx vitest run src/integration.test.ts --timeout 120000
```

## License

[AGPL-3.0-only](LICENSE)
