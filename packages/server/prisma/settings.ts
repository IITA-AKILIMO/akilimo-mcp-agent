// Database settings from Laravel-style variables, shared by the server (src/config.ts) and the
// Prisma CLI (prisma.config.ts) so both always point at the same PostgreSQL database:
//   DB_HOST, DB_PORT (5432), DB_DATABASE, DB_USERNAME, DB_PASSWORD
// DB_CONNECTION is optional and must be pgsql if set. Without DB_HOST the app runs guest-only.

export interface DatabaseSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function databaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings | null {
  if (env.DB_CONNECTION && env.DB_CONNECTION !== "pgsql") {
    throw new Error(`Unsupported DB_CONNECTION '${env.DB_CONNECTION}': only pgsql (PostgreSQL) is supported`);
  }
  if (!env.DB_HOST) return null;
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 5432,
    database: env.DB_DATABASE || "akilimo",
    user: env.DB_USERNAME || "akilimo",
    password: env.DB_PASSWORD || "",
  };
}

// Connection URL for the Prisma CLI (the server itself passes separate fields to the adapter)
export function databaseUrl(settings: DatabaseSettings): string {
  const e = encodeURIComponent;
  return `postgresql://${e(settings.user)}:${e(settings.password)}@${settings.host}:${settings.port}/${e(settings.database)}`;
}
