import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";

interface HttpOptions {
  port: number;
  allowedOrigins: readonly string[];
}

// A Server instance serves one transport at a time, so every connection gets its own
export function startHttp(createServer: () => Server, { port, allowedOrigins }: HttpOptions): void {
  const app = express();

  app.use(cors({
    origin: [...allowedOrigins],
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true,
    exposedHeaders: ['Mcp-Session-Id'],
  }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

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
