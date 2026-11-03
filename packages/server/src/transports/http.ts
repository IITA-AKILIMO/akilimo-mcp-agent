import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Router } from "express";
import cors from "cors";
import type { CallQuota } from "../gateway/quota.js";
import { checkAccess, computeRateLimit, finalErrors, jsonRpcErrors, mcpRateLimit, securityHeaders, type KeyVerifier } from "./guards.js";

interface HttpOptions {
  port: number;
  allowedOrigins: readonly string[];
  // Key check for /mcp and /sse (see checkAccess in guards.ts)
  access: { verifyKey: KeyVerifier; keyQuota: CallQuota };
  limits: {
    // Per client IP and minute, on /mcp, /sse and /messages
    requestsPerMinute: number;
    computePerMinute: number;
    // Open legacy SSE sessions
    sseSessions: number;
    sseSessionsPerIp: number;
  };
  // Mounted at /gateway: MCP server registry and proxy (see gateway/routes.ts)
  gateway?: Router;
  // Mounted at /api: accounts, saved chats and activity (see accounts/routes.ts)
  api?: Router;
  // Mounted at /chat: provider settings and the server-side chat loop (see chat/routes.ts)
  chat?: Router;
  // Mounted at /api/coverage, ahead of /api: the supported area for the map (see coverage/routes.ts)
  coverage?: Router;
  // Mounted at /api/crops, ahead of /api: the crop list for the selector (see crops/routes.ts)
  crops?: Router;
  // Mounted at /api/countries, ahead of /api: the supported countries (see countries/routes.ts)
  countries?: Router;
}

// An SSE session with no message for this long is closed
const SSE_IDLE_MS = 30 * 60 * 1000;

// A Server instance serves one transport at a time, so every connection gets its own
export function startHttp(createServer: () => Server, { port, allowedOrigins, access, limits, gateway, api, chat, coverage, crops, countries }: HttpOptions): void {
  const app = express();
  app.disable("x-powered-by");
  // Behind nginx / Dokploy: trust X-Forwarded-* so req.secure (Secure cookies) and req.ip (rate limits) are right
  app.set("trust proxy", "loopback, linklocal, uniquelocal");

  app.use(securityHeaders);
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
  if (coverage) app.use("/api/coverage", coverage);
  if (crops) app.use("/api/crops", crops);
  if (countries) app.use("/api/countries", countries);
  if (api) app.use("/api", api);
  if (chat) app.use("/chat", chat);

  // Rate limit first, so failed keys count too, then the key or Origin check
  const rateLimited = mcpRateLimit(limits.requestsPerMinute);
  const mcpGuards = [rateLimited, checkAccess(allowedOrigins, access)];

  // Streamable HTTP (current MCP transport), stateless: one server and transport per request
  app.post("/mcp", ...mcpGuards, express.json({ limit: "1mb" }), computeRateLimit(limits.computePerMinute), async (req, res) => {
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
  const sseTransports = new Map<string, { transport: SSEServerTransport; ip: string; idle: NodeJS.Timeout }>();
  const sseCount = (ip: string) => [...sseTransports.values()].filter((s) => s.ip === ip).length;
  const closeSse = (sessionId: string) => {
    const session = sseTransports.get(sessionId);
    if (!session) return;
    clearTimeout(session.idle);
    sseTransports.delete(sessionId);
    void session.transport.close();
  };

  app.get("/sse", ...mcpGuards, async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (sseTransports.size >= limits.sseSessions || sseCount(ip) >= limits.sseSessionsPerIp) {
      res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many open SSE sessions" }, id: null });
      return;
    }
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    sseTransports.set(sessionId, { transport, ip, idle: setTimeout(() => closeSse(sessionId), SSE_IDLE_MS) });
    res.on("close", () => closeSse(sessionId));
    await createServer().connect(transport);
  });

  // The session id is a random UUID only the client that opened /sse (and passed the checks) knows
  app.post("/messages", rateLimited, async (req, res) => {
    const session = sseTransports.get(String(req.query.sessionId));
    if (session) {
      session.idle.refresh();
      await session.transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No SSE connection established for this sessionId" }, id: null });
    }
  });

  app.use(["/mcp", "/sse", "/messages"], jsonRpcErrors);
  app.use(finalErrors);

  app.listen(port, () => {
    console.error(`Akilimo 1.0 MCP Agent listening on http://localhost:${port} (streamable HTTP at /mcp, SSE at /sse)`);
  });
}
