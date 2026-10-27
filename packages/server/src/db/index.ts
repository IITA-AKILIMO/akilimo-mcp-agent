import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import type { DatabaseSettings } from "../../prisma/settings.js";
import { PrismaClient as PgClient } from "../generated/pgsql/client.js";
import { PrismaClient as SqliteClient } from "../generated/sqlite/client.js";

// Both generated clients expose the same models (the schemas are kept in sync), so the
// PostgreSQL client's type stands for either. Schema changes go through Prisma migrations
// (prisma/<connection>/migrations), applied by `pnpm db:migrate` before the server starts.
export type Db = PgClient;

export async function connectDb(settings: DatabaseSettings): Promise<Db> {
  const db = settings.connection === "sqlite"
    ? new SqliteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${settings.file}` }) }) as unknown as Db
    // Separate fields, not a URL, so passwords with @ / : need no escaping
    : new PgClient({
        adapter: new PrismaPg({
          host: settings.host,
          port: settings.port,
          database: settings.database,
          user: settings.user,
          password: settings.password,
          max: 10,
        }),
      });

  // Fail at startup rather than on the first sign-in if the database is unreachable or unmigrated
  try {
    await db.user.count();
  } catch (error) {
    await db.$disconnect().catch(() => undefined);
    const reason = error instanceof Error ? error.message.split("\n").find(Boolean) : String(error);
    throw new Error(`Database not ready (${settings.connection}): ${reason}. Run \`pnpm --filter @akilimo/server db:migrate\`.`);
  }
  return db;
}
