import pg from "pg";

// Ordered schema changes; each runs once and is recorded in schema_migrations.
// Append new entries, never edit applied ones.
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Only a SHA-256 of the session token is stored, so a database leak does not expose sessions
      CREATE TABLE sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);

      CREATE TABLE conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL,
        model text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX conversations_user_idx ON conversations(user_id, updated_at DESC);

      -- The full model history, including tool calls and tool results, so a reopened chat keeps its context
      CREATE TABLE messages (
        id bigserial PRIMARY KEY,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content text NOT NULL DEFAULT '',
        tool_calls jsonb,
        tool_name text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX messages_conversation_idx ON messages(conversation_id, id);

      CREATE TABLE activity (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        server text NOT NULL,
        message text NOT NULL,
        payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX activity_user_idx ON activity(user_id, id DESC);
    `,
  },
];

export type Db = pg.Pool;

export async function connectDb(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialises migrations if several instances start at once
    await client.query("SELECT pg_advisory_xact_lock(4242001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return pool;
}
