#!/usr/bin/env node

/**
 * Start ClaimGraph as an HTTP server.
 *
 * Usage:
 *   claimgraph-serve [--port 3377] [--host 127.0.0.1]
 *
 * Environment variables override config:
 *   CLAIMGRAPH_LLM_BASE_URL, CLAIMGRAPH_LLM_API_KEY, CLAIMGRAPH_LLM_MODEL
 *   CLAIMGRAPH_EMBEDDING_BASE_URL, CLAIMGRAPH_EMBEDDING_API_KEY, CLAIMGRAPH_EMBEDDING_MODEL
 *   CLAIMGRAPH_SURREAL_MODE, CLAIMGRAPH_SURREAL_URL, CLAIMGRAPH_SURREAL_PATH
 */

import { ClaimGraph } from "../plugin/index.js";
import { createHttpServer } from "../server/http.js";

function parseArgs(argv: string[]): { port: number; host: string } {
  let port = 3377;
  let host = "127.0.0.1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) port = parseInt(argv[++i], 10);
    if (argv[i] === "--host" && argv[i + 1]) host = argv[++i];
  }
  return { port, host };
}

function configFromEnv(): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  const env = process.env;

  if (env.CLAIMGRAPH_LLM_BASE_URL || env.CLAIMGRAPH_LLM_MODEL) {
    cfg.llm = {
      baseURL: env.CLAIMGRAPH_LLM_BASE_URL,
      apiKey: env.CLAIMGRAPH_LLM_API_KEY,
      model: env.CLAIMGRAPH_LLM_MODEL,
    };
  }
  if (env.CLAIMGRAPH_EMBEDDING_BASE_URL || env.CLAIMGRAPH_EMBEDDING_MODEL) {
    cfg.embedding = {
      baseURL: env.CLAIMGRAPH_EMBEDDING_BASE_URL,
      apiKey: env.CLAIMGRAPH_EMBEDDING_API_KEY,
      model: env.CLAIMGRAPH_EMBEDDING_MODEL,
    };
  }
  if (env.CLAIMGRAPH_SURREAL_MODE || env.CLAIMGRAPH_SURREAL_URL) {
    cfg.surrealdb = {
      mode: env.CLAIMGRAPH_SURREAL_MODE,
      url: env.CLAIMGRAPH_SURREAL_URL,
      path: env.CLAIMGRAPH_SURREAL_PATH,
    };
  }

  return cfg;
}

async function main() {
  const { port, host } = parseArgs(process.argv.slice(2));
  const graph = new ClaimGraph(configFromEnv());
  await graph.init();

  const http = createHttpServer({ graph, port, host });
  await http.start();
  console.log(`ClaimGraph HTTP server listening on ${http.address}`);

  const shutdown = async () => {
    console.log("\nShutting down...");
    await http.stop();
    await graph.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
