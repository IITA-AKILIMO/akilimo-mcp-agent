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

// One schema and migrations folder per database type, chosen by DB_CONNECTION. Without a
// database (e.g. `prisma generate` in CI) the PostgreSQL schema is used with an empty URL.
const settings = databaseSettings();
const connection = settings?.connection ?? "pgsql";

export default defineConfig({
  schema: `prisma/${connection}/schema.prisma`,
  migrations: { path: `prisma/${connection}/migrations` },
  datasource: { url: settings ? databaseUrl(settings) : "" },
});
