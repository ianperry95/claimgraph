import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ClaimGraph } from "../plugin/index.js";

/**
 * Lightweight REST API wrapping a ClaimGraph instance.
 * No external dependencies — uses node:http directly.
 */

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function parseJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

type Route = (
  req: IncomingMessage,
  res: ServerResponse,
  graph: ClaimGraph,
  params: Record<string, string>,
) => Promise<void>;

const routes: { method: string; pattern: RegExp; handler: Route }[] = [
  {
    method: "POST",
    pattern: /^\/ingest$/,
    handler: async (_req, res, graph) => {
      const body = await parseJson(_req);
      const transcript = body.transcript as string | undefined;
      const conversationId = body.conversationId as string | undefined;
      const messageId = (body.messageId as string) ?? "unknown";
      if (!transcript || !conversationId) {
        return json(res, 400, { error: "transcript and conversationId are required" });
      }
      const result = await graph.ingest(transcript, conversationId, messageId);
      json(res, 200, result);
    },
  },
  {
    method: "POST",
    pattern: /^\/recall$/,
    handler: async (_req, res, graph) => {
      const body = await parseJson(_req);
      const query = body.query as string | undefined;
      if (!query) {
        return json(res, 400, { error: "query is required" });
      }
      const result = await graph.recall(query);
      json(res, 200, result);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/conversations\/([^/]+)$/,
    handler: async (_req, res, graph, params) => {
      await graph.deleteConversation(params.id);
      json(res, 200, { deleted: params.id });
    },
  },
  {
    method: "POST",
    pattern: /^\/maintenance\/staleness$/,
    handler: async (_req, res, graph) => {
      const result = await graph.runStaleness();
      json(res, 200, result);
    },
  },
  {
    method: "POST",
    pattern: /^\/maintenance\/discovery$/,
    handler: async (_req, res, graph) => {
      const result = await graph.runDiscovery();
      json(res, 200, result);
    },
  },
  {
    method: "GET",
    pattern: /^\/health$/,
    handler: async (_req, res) => {
      json(res, 200, { status: "ok" });
    },
  },
];

export interface HttpServerOptions {
  port?: number;
  host?: string;
  graph: ClaimGraph;
}

export function createHttpServer(options: HttpServerOptions) {
  const { graph, port = 3377, host = "127.0.0.1" } = options;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      if (match[1]) params.id = decodeURIComponent(match[1]);

      try {
        await route.handler(req, res, graph, params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { error: message });
      }
      return;
    }

    json(res, 404, { error: "not found" });
  });

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, host, () => resolve());
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    server,
    address: `http://${host}:${port}`,
  };
}
