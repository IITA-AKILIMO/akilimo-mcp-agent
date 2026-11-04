import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import { loadUser, requireAdmin, requireJson } from "../accounts/auth.js";
import type { Db } from "../db/index.js";
import { countToolCalls, sharedKeyMessage, type CallQuota } from "./quota.js";
import { RegistryError, ServerEntrySchema, type Registry } from "./registry.js";
import { testConnection } from "./test.js";

// The keys an admin saved for upstream servers (table mcp_server_keys): signed-in users without a key of
// their own use them, within SharedKeyQuota
export interface SharedKeySource {
  serverKeys(): Promise<Record<string, string>>;
  serverKeyHints(): Promise<Record<string, string>>;
  // The keys a user saved for themselves (encrypted in the database): used before the shared key, never limited
  userKeys(userId: string): Promise<Record<string, string>>;
  userKeyHints(userId: string): Promise<Record<string, string>>;
  touchUserKey(userId: string, serverId: string): Promise<void>;
}

// Request headers worth forwarding to an upstream MCP server, and response headers worth returning
const FORWARD_REQUEST = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const FORWARD_RESPONSE = ["content-type", "mcp-session-id", "cache-control", "www-authenticate"];

// The browser sends the user's key for an upstream server in this header; it is never stored here
const KEY_HEADER = "x-mcp-key";

const noAccounts = (req: Request, res: Response) => {
  res.status(403).json({ error: "Editing needs user accounts: configure the database and sign in as an admin" });
};

const passThrough = (req: Request, res: Response, next: NextFunction) => next();

const sendError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: z.prettifyError(error) });
  } else if (error instanceof RegistryError) {
    res.status(error.status).json({ error: error.message });
  } else {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
};

// Registry edits need a signed-in admin: an open registry would let anyone point the gateway at
// internal services (SSRF). Without a database there are no accounts, so the registry is read-only.
export function gatewayRouter(registry: Registry, db: Db | null, shared: SharedKeySource, quota: CallQuota) {
  const router = express.Router();
  // Session lookup on registry routes and on proxied calls that may use a shared key
  const withUser = db ? loadUser(db) : passThrough;
  const admin = db ? [withUser, requireJson, requireAdmin] : [noAccounts];
  const lookUp = (req: Request, res: Response) => new Promise<void>((resolve, reject) => withUser(req, res, (error?: unknown) => (error ? reject(error) : resolve())));

  router.get("/servers", withUser, async (req, res) => {
    try {
      // Which servers have a shared key, so a signed-in user can connect without entering one (only ids, never the key)
      const sharedKeys = req.user ? Object.keys(await shared.serverKeyHints().catch(() => ({}))) : [];
      // ... and which servers the user already saved a key for (the last characters only), so nothing is asked of them
      const ownKeys = req.user ? await shared.userKeyHints(req.user.id).catch(() => ({})) : {};
      res.json({ servers: await registry.list(), editable: req.user?.role === "admin", shared_keys: sharedKeys, own_keys: ownKeys });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/servers", express.json(), ...admin, async (req, res) => {
    try {
      const entry = ServerEntrySchema.parse(req.body);
      await registry.add(entry);
      res.status(201).json(entry);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/servers/:id", express.json(), ...admin, async (req, res) => {
    try {
      const entry = ServerEntrySchema.parse(req.body);
      await registry.update(String(req.params.id), entry);
      res.json(entry);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/servers/:id", ...admin, async (req, res) => {
    try {
      await registry.remove(String(req.params.id));
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Try a URL and key setting before saving it (admins only, for the same SSRF reason as edits).
  // The key, if any, comes in X-Mcp-Key as for the proxy and is not stored.
  router.post("/test", express.json(), ...admin, async (req, res) => {
    try {
      const entry = ServerEntrySchema.pick({ url: true, auth: true }).parse(req.body);
      res.json(await testConnection(entry, req.header(KEY_HEADER) || undefined));
    } catch (error) {
      sendError(res, error);
    }
  });

  // Streamable HTTP proxy to the registered server, streaming responses (SSE) back as they arrive
  router.all("/servers/:id/mcp", express.raw({ type: () => true, limit: "2mb" }), async (req, res) => {
    const entry = await registry.get(String(req.params.id)).catch(() => undefined);
    if (!entry || !entry.enabled) {
      res.status(404).json({ error: `No enabled MCP server '${req.params.id}'` });
      return;
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARD_REQUEST) {
      const value = req.header(name);
      if (value) headers[name] = value;
    }
    let key = req.header(KEY_HEADER);
    // No key of their own: a signed-in user gets the shared key of this server, if an admin saved one. A
    // user's own key is never limited here, and neither is an admin using the shared key; everyone else is.
    if (!key && entry.auth.type !== "none" && db) {
      try {
        await lookUp(req, res);
        if (req.user) {
          // The key the user saved for this server comes first and is never limited; else the admin's shared key
          const mine = (await shared.userKeys(req.user.id))[entry.id];
          if (mine) shared.touchUserKey(req.user.id, entry.id).catch(() => undefined);
          key = mine ?? (await shared.serverKeys())[entry.id];
          const calls = key && !mine ? countToolCalls(req.body) : 0;
          const verdict = req.user.role === "admin" ? ({ ok: true } as const) : quota.take(req.user.id, calls);
          if (!verdict.ok) {
            res.status(429).setHeader("Retry-After", verdict.retryAfter).json({ jsonrpc: "2.0", error: { code: -32000, message: sharedKeyMessage(verdict) }, id: null });
            return;
          }
        }
      } catch (error) {
        console.error("Shared key lookup failed:", error);
        res.status(503).json({ error: "Could not look up the shared key, try again later" });
        return;
      }
    }
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
        // pipeline handles errors on both sides; a bare .pipe() left the abort error raised when
        // the client disconnects mid-stream unhandled, which crashed the whole server
        await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res);
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
