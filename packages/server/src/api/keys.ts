import { createHash } from "node:crypto";
import type { AkilimoApiClient } from "./client.js";

// MCP keys users create in the Akilimo API's playground (API keys > type "MCP key", ability
// mcp:use; they start with `ak_`). The API checks them at POST /v1/mcp/verify-key, which needs
// this server's own AKILIMO_API_KEY with the mcp:verify-keys ability. Answers are cached, so a
// revoked key stops working within VALID_TTL_MS.
const VALID_TTL_MS = 60_000;
const INVALID_TTL_MS = 30_000;
const MAX_CACHE = 10_000;

export function akilimoKeyVerifier(api: AkilimoApiClient) {
  const cache = new Map<string, { valid: boolean; until: number }>();

  return async (key: string): Promise<boolean> => {
    if (!key.startsWith("ak_")) return false;
    const id = createHash("sha256").update(key).digest("hex");
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && hit.until > now) return hit.valid;

    // Errors (API down, this server's key missing the ability) propagate: checkAccess answers 503
    const { valid } = await api.post<{ valid: boolean }>("/v1/mcp/verify-key", { key });

    if (cache.size >= MAX_CACHE) for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    if (cache.size < MAX_CACHE) cache.set(id, { valid: valid === true, until: now + (valid ? VALID_TTL_MS : INVALID_TTL_MS) });
    return valid === true;
  };
}
