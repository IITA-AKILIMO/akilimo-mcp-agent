import { PrismaPg } from "@prisma/adapter-pg";
import type { DatabaseSettings } from "../../prisma/settings.js";
import { PrismaClient } from "../generated/prisma/client.js";

// Schema changes go through Prisma migrations (prisma/migrations), applied by
// `pnpm db:migrate` before the server starts.
export type Db = PrismaClient;

export async function connectDb(settings: DatabaseSettings): Promise<Db> {
  const db = new PrismaClient({
    // Separate fields, not a URL, so passwords with @ / : need no escaping
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
    throw new Error(`Database not ready: ${reason}. Run \`pnpm --filter @akilimo/server db:migrate\`.`);
  }
  return db;
}
