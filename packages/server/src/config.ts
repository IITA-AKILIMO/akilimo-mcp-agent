import { existsSync } from "node:fs";
import path from "node:path";

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
} as const;
