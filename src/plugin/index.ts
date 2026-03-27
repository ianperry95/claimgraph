import type { Config } from "../config/index.js";
import { loadConfig } from "../config/index.js";
import { connect, disconnect, getDb } from "../db/connection.js";
import { initSchema } from "../db/schema.js";
import { writePipeline, type WriteResult } from "../pipeline/write.js";
import { retrieve, type RetrievalResult } from "../retrieval/retrieve.js";
import { runStalenessScan, type ScanResult } from "../background/staleness.js";
import { runDiscoveryPass, type DiscoveryResult } from "../background/discovery.js";
import { deleteConversationClaims } from "../db/claims.js";

/**
 * ClaimGraph — claims-backed knowledge graph memory.
 *
 * Provides long-term episodic memory for AI agents via 3-tier hybrid dedup,
 * predicate-aware supersession, and graph traversal. Usable as a library,
 * HTTP server, or MCP tool server.
 */
export class ClaimGraph {
  private config: Config;
  private initialized = false;

  constructor(overrides: Record<string, unknown> = {}) {
    this.config = loadConfig(overrides);
  }

  /**
   * Initialize the plugin: connect to SurrealDB and ensure schema exists.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    const db = await connect(this.config);
    await initSchema(db);
    this.initialized = true;
  }

  /**
   * Process a conversation transcript: extract, dedup, write claims/relationships.
   * Called post-session.
   */
  async ingest(
    transcript: string,
    conversationId: string,
    messageId: string = "unknown",
  ): Promise<WriteResult> {
    this.ensureInit();
    return writePipeline(this.config, transcript, conversationId, messageId);
  }

  /**
   * Retrieve relevant memory context for a query.
   * Called at session start.
   */
  async recall(query: string): Promise<RetrievalResult> {
    this.ensureInit();
    return retrieve(this.config, query);
  }

  /**
   * Delete all knowledge sourced from a specific conversation.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    this.ensureInit();
    await deleteConversationClaims(this.config, conversationId);
  }

  /**
   * Run background staleness scan.
   */
  async runStaleness(): Promise<ScanResult> {
    this.ensureInit();
    return runStalenessScan(this.config);
  }

  /**
   * Run background relationship discovery pass.
   */
  async runDiscovery(): Promise<DiscoveryResult> {
    this.ensureInit();
    return runDiscoveryPass(this.config);
  }

  /**
   * Gracefully shut down: disconnect from SurrealDB.
   */
  async shutdown(): Promise<void> {
    await disconnect();
    this.initialized = false;
  }

  /**
   * Get the current configuration (read-only).
   */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error("ClaimGraph not initialized. Call init() first.");
    }
  }
}
