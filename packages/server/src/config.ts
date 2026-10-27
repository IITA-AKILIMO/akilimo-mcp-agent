import { existsSync } from "node:fs";
import path from "node:path";
import { databaseSettings } from "../prisma/settings.js";

// Local development: load the repo-root .env (pnpm runs scripts from packages/server).
// Variables already set in the environment win; containers get theirs from compose.
for (const file of [path.resolve(".env"), path.resolve("../../.env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

export const config = {
  apiBaseUrl: process.env.AKILIMO_API_BASE_URL || "http://localhost:8600",
  apiKey: process.env.AKILIMO_API_KEY || "",
  deviceToken: process.env.AKILIMO_DEVICE_TOKEN || "",
  // "http" serves streamable HTTP (/mcp) and SSE (/sse); TRANSPORT=sse is kept for existing setups
  transport: ['http', 'sse'].includes(process.env.TRANSPORT ?? '') || process.argv.includes('--http') ? "http" : "stdio",
  // Containers set PORT=3000; the local default avoids 3000, which Dokploy and other tools often hold
  port: Number(process.env.PORT) || 3001,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  // MCP gateway (HTTP mode) registry file; only signed-in admins can change it
  gatewayDataFile: process.env.GATEWAY_DATA_FILE || path.resolve("data/mcp-servers.json"),
  // Admin account ensured on start and by `--seed-admin` (both need ADMIN_EMAIL and ADMIN_PASSWORD)
  adminSeed: process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
    ? { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME || "Administrator" }
    : null,
  // User accounts, saved chats and activity (HTTP mode): PostgreSQL from DB_*, shared with the
  // Prisma CLI; DB_HOST unset = guests only
  database: databaseSettings(),
} as const;
