import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import { Registry, RegistryError, ServerEntrySchema } from "./registry.js";

// Request headers worth forwarding to an upstream MCP server, and response headers worth returning
const FORWARD_REQUEST = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const FORWARD_RESPONSE = ["content-type", "mcp-session-id", "cache-control", "www-authenticate"];

// The browser sends the user's key for an upstream server in this header; it is never stored here
const KEY_HEADER = "x-mcp-key";

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Registry edits need GATEWAY_ADMIN_TOKEN: an open registry would let anyone point the
// gateway at internal services (SSRF)
const requireAdmin = (adminToken: string) => (req: Request, res: Response, next: NextFunction) => {
  if (!adminToken) {
    res.status(403).json({ error: "Editing is disabled: set GATEWAY_ADMIN_TOKEN on the MCP server" });
    return;
  }
  const given = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!sameToken(given, adminToken)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
};

const sendError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: z.prettifyError(error) });
  } else if (error instanceof RegistryError) {
    res.status(error.status).json({ error: error.message });
  } else {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
};

export function gatewayRouter(registry: Registry, adminToken: string) {
  const router = express.Router();
  const admin = requireAdmin(adminToken);

  router.get("/servers", (req, res) => {
    res.json({ servers: registry.list(), editable: Boolean(adminToken) });
  });

  // Lets the UI check a token before showing edit controls
  router.get("/admin", admin, (req, res) => {
    res.status(204).end();
  });

  router.post("/servers", admin, express.json(), async (req, res) => {
    try {
      const entry = ServerEntrySchema.parse(req.body);
      await registry.add(entry);
      res.status(201).json(entry);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/servers/:id", admin, express.json(), async (req, res) => {
    try {
      const entry = ServerEntrySchema.parse(req.body);
      await registry.update(String(req.params.id), entry);
      res.json(entry);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/servers/:id", admin, async (req, res) => {
    try {
      await registry.remove(String(req.params.id));
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Streamable HTTP proxy to the registered server, streaming responses (SSE) back as they arrive
  router.all("/servers/:id/mcp", express.raw({ type: () => true, limit: "2mb" }), async (req, res) => {
    const entry = registry.get(String(req.params.id));
    if (!entry || !entry.enabled) {
      res.status(404).json({ error: `No enabled MCP server '${req.params.id}'` });
      return;
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARD_REQUEST) {
      const value = req.header(name);
      if (value) headers[name] = value;
    }
    const key = req.header(KEY_HEADER);
    if (key && entry.auth.type === "bearer") headers.authorization = `Bearer ${key}`;
    if (key && entry.auth.type === "header") headers[entry.auth.header.toLowerCase()] = key;

    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;
      const upstream = await fetch(entry.url, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        signal: abort.signal,
      });
      res.status(upstream.status);
      for (const name of FORWARD_RESPONSE) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (upstream.body) {
        Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      if (!res.headersSent) {
        res.status(502).json({ error: `Cannot reach ${entry.label}: ${error instanceof Error ? error.message : String(error)}` });
      } else {
        res.end();
      }
    }
  });

  return router;
}
