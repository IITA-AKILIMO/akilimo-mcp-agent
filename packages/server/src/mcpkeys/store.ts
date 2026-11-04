import { createHash, randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { mcpClientKeys } from "../db/schema.js";
import type { KeyGrant, KeyVerifier } from "../transports/guards.js";
import { recordKeyEvent } from "./events.js";

// Keys admins issue for MCP clients (partner apps, Open WebUI, desktop clients). The key is random, starts
// with `amk_` (so the other verifiers skip it and it is easy to spot in a config) and is shown once; only
// its SHA-256 is stored. Users still create their own `ak_` MCP keys in the Akilimo API's playground (see
// api/keys.ts), and operators can still list keys in MCP_API_KEYS: all three kinds are accepted.
export const KEY_PREFIX = "amk_";
const LAST_USED_EVERY_MS = 60_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export interface ClientKey {
  id: string;
  name: string;
  key_hint: string;
  per_minute: number | null;
  per_day: number | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  use_count: number;
  created_at: Date;
  status: "active" | "expired" | "revoked";
}

export interface NewClientKey {
  name: string;
  perMinute?: number | null;
  perDay?: number | null;
  expiresAt?: Date | null;
  createdBy?: string | null;
}

type Row = typeof mcpClientKeys.$inferSelect;

const toJson = (r: Row, now = Date.now()): ClientKey => ({
  id: r.id,
  name: r.name,
  key_hint: r.keyHint,
  per_minute: r.perMinute,
  per_day: r.perDay,
  expires_at: r.expiresAt,
  revoked_at: r.revokedAt,
  last_used_at: r.lastUsedAt,
  use_count: r.useCount,
  created_at: r.createdAt,
  status: r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt.getTime() <= now ? "expired" : "active",
});

export class ClientKeyStore {
  // Requests seen since the last write of use_count, by key id
  private readonly pending = new Map<string, number>();

  constructor(private readonly db: Db) {}

  // The new key in plain text, once: it cannot be read back afterwards
  async create(input: NewClientKey): Promise<{ key: string; record: ClientKey }> {
    const key = KEY_PREFIX + randomBytes(32).toString("base64url");
    // Something to recognise the key by that does not help to guess it: the prefix and the last 4 characters
    const hint = `${KEY_PREFIX}…${key.slice(-4)}`;
    const [row] = await this.db.insert(mcpClientKeys).values({
      name: input.name,
      keyHash: sha256(key),
      keyHint: hint,
      perMinute: input.perMinute ?? null,
      perDay: input.perDay ?? null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.createdBy ?? null,
    }).returning();
    await recordKeyEvent(this.db, {
      actorId: input.createdBy, kind: "client", ref: row!.id, label: input.name, action: "created",
      detail: { hint, per_minute: input.perMinute ?? null, per_day: input.perDay ?? null, expires_at: input.expiresAt ?? null },
    });
    return { key, record: toJson(row!) };
  }

  async list(): Promise<ClientKey[]> {
    const now = Date.now();
    return (await this.db.select().from(mcpClientKeys).orderBy(desc(mcpClientKeys.createdAt))).map((r) => toJson(r, now));
  }

  // Change the name or the limits (null = back to the server defaults); false when the key does not exist
  async update(id: string, change: { name?: string; perMinute?: number | null; perDay?: number | null }, actorId?: string): Promise<boolean> {
    const values: Partial<typeof mcpClientKeys.$inferInsert> = {};
    if (change.name !== undefined) values.name = change.name;
    if (change.perMinute !== undefined) values.perMinute = change.perMinute;
    if (change.perDay !== undefined) values.perDay = change.perDay;
    if (Object.keys(values).length === 0) return (await this.db.select({ id: mcpClientKeys.id }).from(mcpClientKeys).where(eq(mcpClientKeys.id, id)).limit(1)).length > 0;
    const [row] = await this.db.update(mcpClientKeys).set(values).where(eq(mcpClientKeys.id, id)).returning({ id: mcpClientKeys.id, name: mcpClientKeys.name });
    if (row) await recordKeyEvent(this.db, { actorId, kind: "client", ref: id, label: row.name, action: "changed", detail: change });
    return row !== undefined;
  }

  // Stops the key at once (the row stays, so the list still shows what it was and when it was used)
  async revoke(id: string, actorId?: string): Promise<boolean> {
    const [row] = await this.db.update(mcpClientKeys).set({ revokedAt: new Date() }).where(eq(mcpClientKeys.id, id)).returning({ id: mcpClientKeys.id, name: mcpClientKeys.name });
    if (row) await recordKeyEvent(this.db, { actorId, kind: "client", ref: id, label: row.name, action: "revoked" });
    return row !== undefined;
  }

  // For checkAccess: the key's grant (id and own limits) when it is known, not revoked and not expired
  verifier(): KeyVerifier {
    return async (key) => {
      if (!key.startsWith(KEY_PREFIX)) return false;
      const [row] = await this.db.select().from(mcpClientKeys).where(eq(mcpClientKeys.keyHash, sha256(key))).limit(1);
      if (!row || toJson(row).status !== "active") return false;
      // Count the request, and write when it was last used and the requests counted since, at most once a minute so a
      // busy key does not write on every request
      const pending = (this.pending.get(row.id) ?? 0) + 1;
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
        this.pending.delete(row.id);
        this.db.update(mcpClientKeys).set({ lastUsedAt: new Date(), useCount: sql`${mcpClientKeys.useCount} + ${pending}` }).where(eq(mcpClientKeys.id, row.id)).catch(() => undefined);
      } else {
        this.pending.set(row.id, pending);
      }
      const grant: KeyGrant = { id: row.id, perMinute: row.perMinute, perDay: row.perDay };
      return grant;
    };
  }
}
