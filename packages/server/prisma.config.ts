import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { databaseSettings, databaseUrl } from "./prisma/settings.ts";

// Same .env handling as src/config.ts: repo-root .env locally, real environment in containers
for (const file of [path.resolve(".env"), path.resolve("../../.env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

// The URL is built from DB_*; without a database (e.g. `prisma generate` in CI) it stays empty
const settings = databaseSettings();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: settings ? databaseUrl(settings) : "" },
});
