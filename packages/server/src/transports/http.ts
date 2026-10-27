import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Router } from "express";
import cors from "cors";

interface HttpOptions {
  port: number;
  allowedOrigins: readonly string[];
  // Mounted at /gateway: MCP server registry and proxy (see gateway/routes.ts)
  gateway?: Router;
  // Mounted at /api: accounts, saved chats and activity (see accounts/routes.ts)
  api?: Router;
  // Mounted at /chat: provider settings and the server-side chat loop (see chat/routes.ts)
  chat?: Router;
}

// A Server instance serves one transport at a time, so every connection gets its own
export function startHttp(createServer: () => Server, { port, allowedOrigins, gateway, api, chat }: HttpOptions): void {
  const app = express();
  // Behind nginx / Dokploy: trust X-Forwarded-* so req.secure (Secure cookies) and req.ip (rate limits) are right
  app.set("trust proxy", "loopback, linklocal, uniquelocal");

  app.use(cors({
    origin: [...allowedOrigins],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    exposedHeaders: ['Mcp-Session-Id'],
  }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  if (gateway) app.use("/gateway", gateway);
  if (api) app.use("/api", api);
  if (chat) app.use("/chat", chat);

  // Streamable HTTP (current MCP transport), stateless: one server and transport per request
  app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless mode has no server-initiated stream or session to delete
  app.all("/mcp", (req, res) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  // Legacy SSE transport (Open WebUI, older clients), one transport per session id
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);
    res.on("close", () => sseTransports.delete(transport.sessionId));
    await createServer().connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const transport = sseTransports.get(String(req.query.sessionId));
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send("No SSE connection established for this sessionId");
    }
  });

  app.listen(port, () => {
    console.error(`Akilimo 1.0 MCP Agent listening on http://localhost:${port} (streamable HTTP at /mcp, SSE at /sse)`);
  });
}
