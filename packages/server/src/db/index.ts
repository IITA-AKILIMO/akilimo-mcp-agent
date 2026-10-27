import path from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";
import type { DatabaseSettings } from "./settings.js";

export { schema };
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

// Migration files written by `pnpm db:generate`; the folder sits next to the server (packages/server
// locally, /app in Docker). DB_MIGRATIONS_DIR overrides it.
const migrationsFolder = () => process.env.DB_MIGRATIONS_DIR || path.resolve("drizzle");

// Connects and applies pending migrations, so the schema always matches this version of the server.
// Fails at startup rather than on the first sign-in if the database is unreachable.
export async function connectDb(settings: DatabaseSettings): Promise<Db> {
  const pool = new pg.Pool({
    // Separate fields, not a URL, so passwords with @ /: need no escaping
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    max: 10,
  });
  // An idle connection dropped by the database must not crash the process
  pool.on("error", (error) => console.error("Database connection error:", error.message));
  const db = drizzle(pool, { schema });

  try {
    await migrate(db, { migrationsFolder: migrationsFolder(), migrationsSchema: settings.schema });
  } catch (error) {
    await pool.end().catch(() => undefined);
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    throw new Error(`Database not ready (${settings.host}:${settings.port}/${settings.database}): ${reason}`);
  }
  return db;
}

export const closeDb = (db: Db) => db.$client.end();
