import { ClaimGraph } from "../plugin/index.js";

/**
 * MCP (Model Context Protocol) stdio server exposing ClaimGraph as tools.
 *
 * Implements the MCP JSON-RPC protocol over stdin/stdout so any
 * MCP-compatible client (Claude, Cursor, etc.) can use ClaimGraph
 * as a memory backend.
 */

// --- MCP JSON-RPC types (minimal, no external dependency) ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "memory_ingest",
    description:
      "Ingest a conversation transcript into long-term memory. Extracts entities, relationships, and claims from the text and stores them in the knowledge graph.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript: {
          type: "string",
          description: "The conversation transcript to ingest",
        },
        conversationId: {
          type: "string",
          description: "Unique identifier for the conversation",
        },
        messageId: {
          type: "string",
          description: "Optional message identifier within the conversation",
        },
      },
      required: ["transcript", "conversationId"],
    },
  },
  {
    name: "memory_recall",
    description:
      "Recall relevant memories for a given query. Returns a context block summarizing relevant entities and relationships from the knowledge graph.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The query to search memories for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_delete_conversation",
    description:
      "Delete all knowledge sourced from a specific conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversationId: {
          type: "string",
          description: "The conversation ID whose claims should be removed",
        },
      },
      required: ["conversationId"],
    },
  },
  {
    name: "memory_staleness_scan",
    description:
      "Run a background staleness scan: mark expired claims as stale, archive old entities, and repair dirty projections.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "memory_discovery",
    description:
      "Run a background relationship discovery pass to find connections between entities that were never co-extracted.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

const SERVER_INFO = {
  name: "claimgraph",
  version: "0.1.0",
};

const CAPABILITIES = {
  tools: {},
};

// --- Tool dispatch ---

async function handleToolCall(
  graph: ClaimGraph,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let result: unknown;

  switch (name) {
    case "memory_ingest": {
      const transcript = args.transcript as string;
      const conversationId = args.conversationId as string;
      const messageId = (args.messageId as string) ?? "unknown";
      result = await graph.ingest(transcript, conversationId, messageId);
      break;
    }
    case "memory_recall": {
      const query = args.query as string;
      const recall = await graph.recall(query);
      result = {
        contextBlock: recall.contextBlock,
        entityCount: recall.entities.length,
        topEntities: recall.entities.slice(0, 5).map((e) => ({
          name: e.entity.name,
          type: e.entity.type,
          score: e.score,
          summary: e.entity.summary,
        })),
      };
      break;
    }
    case "memory_delete_conversation": {
      const conversationId = args.conversationId as string;
      await graph.deleteConversation(conversationId);
      result = { deleted: conversationId };
      break;
    }
    case "memory_staleness_scan":
      result = await graph.runStaleness();
      break;
    case "memory_discovery":
      result = await graph.runDiscovery();
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// --- stdio transport ---

function send(msg: JsonRpcResponse): void {
  const body = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function makeResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function serveMcp(graph: ClaimGraph): Promise<void> {
  await graph.init();

  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;

    // Parse Content-Length framed messages
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) break;

      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);

      try {
        const msg = JSON.parse(body) as JsonRpcRequest;
        await dispatch(graph, msg);
      } catch {
        send(makeError(null, -32700, "Parse error"));
      }
    }
  });

  process.stdin.on("end", async () => {
    await graph.shutdown();
    process.exit(0);
  });
}

async function dispatch(graph: ClaimGraph, msg: JsonRpcRequest): Promise<void> {
  const id = msg.id ?? null;

  switch (msg.method) {
    case "initialize":
      send(
        makeResponse(id, {
          protocolVersion: "2024-11-05",
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        }),
      );
      break;

    case "notifications/initialized":
      // No response needed for notifications
      break;

    case "tools/list":
      send(makeResponse(id, { tools: TOOLS }));
      break;

    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      try {
        const result = await handleToolCall(graph, name, args);
        send(makeResponse(id, result));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(makeResponse(id, {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        }));
      }
      break;
    }

    default:
      if (id !== null) {
        send(makeError(id, -32601, `Method not found: ${msg.method}`));
      }
  }
}
