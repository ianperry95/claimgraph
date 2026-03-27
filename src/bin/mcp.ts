#!/usr/bin/env node

/**
 * Start ClaimGraph as an MCP (Model Context Protocol) stdio server.
 *
 * Usage:
 *   claimgraph-mcp
 *
 * Designed to be launched by MCP-compatible clients (Claude, Cursor, etc.)
 * via their MCP server configuration. Communicates over stdin/stdout using
 * the MCP JSON-RPC protocol.
 *
 * Environment variables override config:
 *   CLAIMGRAPH_LLM_BASE_URL, CLAIMGRAPH_LLM_API_KEY, CLAIMGRAPH_LLM_MODEL
 *   CLAIMGRAPH_EMBEDDING_BASE_URL, CLAIMGRAPH_EMBEDDING_API_KEY, CLAIMGRAPH_EMBEDDING_MODEL
 *   CLAIMGRAPH_SURREAL_MODE, CLAIMGRAPH_SURREAL_URL, CLAIMGRAPH_SURREAL_PATH
 */

import { ClaimGraph } from "../plugin/index.js";
import { serveMcp } from "../server/mcp.js";

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

const graph = new ClaimGraph(configFromEnv());
serveMcp(graph).catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
