import { existsSync } from "node:fs";
import path from "node:path";
import { databaseSettings } from "./db/settings.js";
import { parseSecretsKey } from "./secrets/crypto.js";

// Local development: load the repo-root .env (pnpm runs scripts from packages/server).
// Variables already set in the environment win; containers get theirs from compose.
for (const file of [path.resolve(".env"), path.resolve("../../.env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

export const config = {
  apiBaseUrl: process.env.AKILIMO_API_BASE_URL || "https://api.akilimo.org",
  apiKey: process.env.AKILIMO_API_KEY || "",
  deviceToken: process.env.AKILIMO_DEVICE_TOKEN || "",
  // "http" serves streamable HTTP (/mcp) and SSE (/sse); TRANSPORT=sse is kept for existing setups
  transport: ['http', 'sse'].includes(process.env.TRANSPORT ?? '') || process.argv.includes('--http') ? "http" : "stdio",
  // Containers set PORT=3000; the local default avoids 3000, which Dokploy and other tools often hold
  port: Number(process.env.PORT) || 3001,
  // Browser origins allowed by CORS and by the MCP endpoints' Origin check
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || ['http://localhost:5173'],
  // Client keys for the MCP endpoints (comma-separated); when set, /mcp and /sse need one as
  // `Authorization: Bearer <key>` or `X-API-Key`, and a request with a valid key skips the Origin check
  mcpApiKeys: process.env.MCP_API_KEYS?.split(',').map((k) => k.trim()).filter(Boolean) ?? [],
  // Refuse MCP requests without a key even when MCP_API_KEYS is empty, e.g. when only the MCP keys
  // users create in the Akilimo API's playground (checked through the API) should get in
  mcpRequireKey: /^(1|true|yes)$/i.test(process.env.MCP_REQUIRE_KEY ?? ""),
  // Requests per minute and client IP on the MCP endpoints, and calls of compute_recommendations among them
  mcpRateLimit: Number(process.env.MCP_RATE_LIMIT) || 120,
  mcpComputeRateLimit: Number(process.env.MCP_COMPUTE_RATE_LIMIT) || 10,
  // Open legacy SSE sessions, in total and per client IP
  sseMaxSessions: Number(process.env.SSE_MAX_SESSIONS) || 200,
  sseMaxSessionsPerIp: Number(process.env.SSE_MAX_SESSIONS_PER_IP) || 5,
  // MCP gateway (HTTP mode) registry file; only signed-in admins can change it
  gatewayDataFile: process.env.GATEWAY_DATA_FILE || path.resolve("data/mcp-servers.json"),
  // Admin account ensured on start and by `--seed-admin` (both need ADMIN_EMAIL and ADMIN_PASSWORD;
  // without ADMIN_USERNAME the username comes from the email)
  adminSeed: process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
    ? {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      name: process.env.ADMIN_NAME || "Administrator",
      username: process.env.ADMIN_USERNAME || undefined,
    }
    : null,
  // Master key for the secrets kept in the database (LLM provider keys, MCP server keys); without
  // it the server still runs, but those secrets cannot be saved or used
  secretsKey: parseSecretsKey(process.env.SECRETS_KEY),
  // Ollama the chat's server-side model calls use unless an admin saved another URL
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, ""),
  // User accounts, saved chats and activity (HTTP mode): PostgreSQL from DB_*; DB_HOST unset = guests only
  database: databaseSettings(),
} as const;
