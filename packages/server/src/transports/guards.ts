import { createHash, timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "../accounts/auth.js";

const jsonRpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

// The server's own calls (the chat and the gateway reach /mcp over 127.0.0.1) are not limited.
// With `trust proxy` req.ip is the client behind Caddy, so a forwarded header cannot fake loopback.
export const isLoopback = (req: Request) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip ?? "");

const sha256 = (value: string) => createHash("sha256").update(value).digest();

// The key a client sent, as `Authorization: Bearer <key>` or `X-API-Key: <key>`
function presentedKey(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header.trim() : undefined;
}

export type KeyVerifier = (key: string) => Promise<boolean>;

// The operator's keys from MCP_API_KEYS, compared as hashes so every comparison takes the same time
export function staticKeyVerifier(keys: readonly string[]): KeyVerifier {
  const hashes = keys.map(sha256);
  return async (key) => {
    const hash = sha256(key);
    return hashes.reduce((found, h) => timingSafeEqual(h, hash) || found, false);
  };
}

// A key is valid when any verifier accepts it (operator keys first, then users' own keys)
export const anyKeyVerifier = (verifiers: KeyVerifier[]): KeyVerifier => async (key) => {
  for (const verify of verifiers) if (await verify(key)) return true;
  return false;
};

interface AccessOptions {
  // Refuse requests without a valid key (MCP_REQUIRE_KEY, or MCP_API_KEYS set)
  required: boolean;
  verifyKey: KeyVerifier;
}

// Who may use the MCP endpoints:
// - a valid key (MCP_API_KEYS or a key a user created) passes, whatever its Origin;
// - a wrong key gets 401, and so does a request without one when keys are required, except the
//   server's own calls over loopback (the chat and the gateway);
// - otherwise the endpoints are public, and only the spec's DNS-rebinding check applies:
//   a browser Origin must be in ALLOWED_ORIGINS, clients that send none pass.
export function checkAccess(allowedOrigins: readonly string[], { required, verifyKey }: AccessOptions): RequestHandler {
  const refuse = (res: Response, keySent: boolean) => {
    res.status(401)
      .set("WWW-Authenticate", keySent ? 'Bearer realm="akilimo-mcp", error="invalid_token"' : 'Bearer realm="akilimo-mcp"')
      .json(jsonRpcError(-32001, keySent ? "Invalid API key" : "API key required: send Authorization: Bearer <key> or X-API-Key"));
  };

  return async (req, res, next) => {
    const key = presentedKey(req);
    if (key) {
      let valid: boolean;
      try {
        valid = await verifyKey(key);
      } catch (error) {
        console.error("API key check failed:", error);
        res.status(503).json(jsonRpcError(-32000, "Could not check the API key, try again later"));
        return;
      }
      if (valid) next();
      else refuse(res, true);
      return;
    }
    if (required && !isLoopback(req)) {
      refuse(res, false);
      return;
    }
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
      next();
      return;
    }
    res.status(403).json(jsonRpcError(-32000, "Origin not allowed"));
  };
}

// Headers for an API that serves no pages: no sniffing, framing or referrer, HSTS over HTTPS
export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
};

const TOO_MANY = jsonRpcError(-32000, "Too many requests, try again in a minute");

// Every MCP request (POST /mcp, GET /sse, POST /messages), per client IP
export const mcpRateLimit = (perMinute: number) => rateLimit(perMinute, 60_000, { body: TOO_MANY, skip: isLoopback });

// compute_recommendations keeps the R service busy for up to two minutes, so it has its own lower limit
export function computeRateLimit(perMinute: number): RequestHandler {
  const limit = rateLimit(perMinute, 60_000, { body: TOO_MANY, skip: isLoopback });
  return (req, res, next) => {
    const messages = Array.isArray(req.body) ? req.body : [req.body];
    const computes = messages.some((m) => m?.method === "tools/call" && m?.params?.name === "compute_recommendations");
    if (computes) limit(req, res, next);
    else next();
  };
}

// Malformed JSON gets a JSON-RPC parse error instead of Express's HTML page
export const jsonRpcErrors: ErrorRequestHandler = (error, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json(jsonRpcError(-32700, "Parse error"));
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json(jsonRpcError(-32600, "Request too large"));
    return;
  }
  console.error("MCP request failed:", error);
  res.status(500).json(jsonRpcError(-32603, "Internal error"));
};

// Last handler of the app: no stack traces or HTML, and nothing about the internals
export const finalErrors: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = Number(error?.status ?? error?.statusCode) || 500;
  if (status >= 500) console.error("Request failed:", error);
  res.status(status).json({ error: status >= 500 ? "Internal error" : "Bad request" });
};
