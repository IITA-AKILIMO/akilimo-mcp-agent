import path from "node:path";

// Database settings from Laravel-style variables, shared by the server (src/config.ts) and the
// Prisma CLI (prisma.config.ts) so both always point at the same database.
//   DB_CONNECTION=pgsql  -> DB_HOST, DB_PORT (5432), DB_DATABASE, DB_USERNAME, DB_PASSWORD
//   DB_CONNECTION=sqlite -> DB_DATABASE is the database file (default data/akilimo.db)
// Without DB_CONNECTION, DB_HOST implies pgsql; with neither the app runs guest-only.

export type DatabaseSettings =
  | { connection: "pgsql"; host: string; port: number; database: string; user: string; password: string }
  | { connection: "sqlite"; file: string };

export function databaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings | null {
  const connection = env.DB_CONNECTION || (env.DB_HOST ? "pgsql" : "");
  if (!connection) return null;

  if (connection === "sqlite") {
    // Relative paths resolve from the working directory (packages/server locally, /app in Docker)
    return { connection, file: path.resolve(env.DB_DATABASE || "data/akilimo.db") };
  }
  if (connection === "pgsql") {
    if (!env.DB_HOST) throw new Error("DB_CONNECTION=pgsql needs DB_HOST");
    return {
      connection,
      host: env.DB_HOST,
      port: Number(env.DB_PORT) || 5432,
      database: env.DB_DATABASE || "akilimo",
      user: env.DB_USERNAME || "akilimo",
      password: env.DB_PASSWORD || "",
    };
  }
  throw new Error(`Unsupported DB_CONNECTION '${connection}': use pgsql or sqlite`);
}

// Connection URL for the Prisma CLI (the server itself passes separate fields to the adapter)
export function databaseUrl(settings: DatabaseSettings): string {
  if (settings.connection === "sqlite") return `file:${settings.file}`;
  const e = encodeURIComponent;
  return `postgresql://${e(settings.user)}:${e(settings.password)}@${settings.host}:${settings.port}/${e(settings.database)}`;
}
