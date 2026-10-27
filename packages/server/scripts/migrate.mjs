// Applies pending Prisma migrations (`prisma migrate deploy`) before the server starts; skips
// when no database is configured (guest-only mode).
// Run from packages/server locally or /app in Docker, next to prisma.config.ts.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

for (const file of [path.resolve(".env"), path.resolve("../../.env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

if (!process.env.DB_HOST) {
  console.error("No database configured (DB_HOST); skipping migrations");
  process.exit(0);
}

// Call the CLI through node rather than npx or .bin shims, which differ per platform
const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, "migrate", "deploy"], { stdio: "inherit" });
process.exit(result.status ?? 1);
