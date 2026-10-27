import { readFile } from "node:fs/promises";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "../db/index.js";
import { mcpServerKeys, mcpServers } from "../db/schema.js";

// How the browser-supplied key is passed to the upstream server
export const AuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer") }),
  z.object({ type: z.literal("header"), header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Header name may only contain letters, digits and dashes") }),
]);

export const ServerEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/, "Use 1-40 lowercase letters, digits, dots or dashes"),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(""),
  url: z.url({ protocol: /^https?$/, error: "Use an http(s) URL of a streamable HTTP MCP endpoint" }),
  auth: AuthSchema.default({ type: "none" }),
  enabled: z.boolean().default(true),
});

export type ServerEntry = z.infer<typeof ServerEntrySchema>;

// First-run contents; both entries can be edited or removed like any other
const defaults = (port: number): ServerEntry[] => [
  {
    id: "akilimo-1.0",
    label: "Akilimo 1.0",
    description: "This repository's agent on the Akilimo 1.0 API",
    url: `http://127.0.0.1:${port}/mcp`,
    auth: { type: "none" },
    enabled: true,
  },
  {
    id: "akilimo-2.0",
    label: "Akilimo 2.0",
    description: "Hosted agent of the Akilimo 2.0 platform; needs a partner key from Hub operations",
    url: "https://mcp.akilimo.org/mcp",
    auth: { type: "bearer" },
    enabled: true,
  },
];

export class RegistryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The shared MCP server list. With a database it is the `mcp_servers` table (editable by admins);
// without one it is read-only (see FileRegistry).
export interface Registry {
  load(): Promise<void>;
  list(): Promise<ServerEntry[]>;
  get(id: string): Promise<ServerEntry | undefined>;
  add(entry: ServerEntry): Promise<void>;
  update(id: string, entry: ServerEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

// A registry JSON file written by earlier versions (GATEWAY_DATA_FILE); null when there is none
async function readEntriesFile(file: string): Promise<ServerEntry[] | null> {
  try {
    return z.array(ServerEntrySchema).parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read MCP registry ${file}: ${error.message}`);
  }
}

// No database, no accounts, so nobody can edit: serves the registry file if one exists, otherwise
// the default servers
export class FileRegistry implements Registry {
  private entries: ServerEntry[] = [];

  constructor(private readonly file: string, private readonly port: number) {}

  async load(): Promise<void> {
    this.entries = (await readEntriesFile(this.file)) ?? defaults(this.port);
  }

  async list() {
    return this.entries;
  }

  async get(id: string) {
    return this.entries.find((e) => e.id === id);
  }

  private readOnly(): never {
    throw new RegistryError(403, "The MCP server list can only be edited with the accounts database (DB_HOST)");
  }

  async add(): Promise<void> {
    this.readOnly();
  }

  async update(): Promise<void> {
    this.readOnly();
  }

  async remove(): Promise<void> {
    this.readOnly();
  }
}

type Row = typeof mcpServers.$inferSelect;

const toEntry = (row: Row): ServerEntry => ({
  id: row.id,
  label: row.label,
  description: row.description,
  url: row.url,
  auth: row.authType === "header" ? { type: "header", header: row.authHeader ?? "X-API-Key" } : { type: row.authType as "none" | "bearer" },
  enabled: row.enabled,
});

const toRow = (entry: ServerEntry) => ({
  id: entry.id,
  label: entry.label,
  description: entry.description,
  url: entry.url,
  authType: entry.auth.type,
  authHeader: entry.auth.type === "header" ? entry.auth.header : null,
  enabled: entry.enabled,
});

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

// The `mcp_servers` table. On the first start with an empty table it is filled from the registry
// file of earlier versions if there is one, otherwise with the default servers; from then on the
// table is the only source.
export class DbRegistry implements Registry {
  constructor(private readonly db: Db, private readonly file: string, private readonly port: number) {}

  async load(): Promise<void> {
    if ((await this.db.$count(mcpServers)) > 0) return;
    const fromFile = await readEntriesFile(this.file);
    const initial = fromFile ?? defaults(this.port);
    await this.db.insert(mcpServers).values(initial.map((e, i) => ({ ...toRow(e), sortOrder: i }))).onConflictDoNothing();
    console.error(`MCP servers: registered ${initial.length} in the database (${fromFile ? `from ${this.file}` : "defaults"})`);
  }

  async list() {
    return (await this.db.select().from(mcpServers).orderBy(asc(mcpServers.sortOrder), asc(mcpServers.id))).map(toEntry);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
    return row ? toEntry(row) : undefined;
  }

  async add(entry: ServerEntry): Promise<void> {
    try {
      await this.db.insert(mcpServers).values({
        ...toRow(entry),
        sortOrder: sql`(select coalesce(max(${mcpServers.sortOrder}), -1) + 1 from ${mcpServers})`,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new RegistryError(409, `A server with id '${entry.id}' already exists`);
      throw error;
    }
  }

  async update(id: string, entry: ServerEntry): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const { id: _id, ...values } = toRow(entry);
        const updated = await tx.update(mcpServers).set({ id: entry.id, ...values, updatedAt: new Date() }).where(eq(mcpServers.id, id)).returning({ id: mcpServers.id });
        if (updated.length === 0) throw new RegistryError(404, `No server with id '${id}'`);
        // A saved key follows the server when its id changes
        if (entry.id !== id) await tx.update(mcpServerKeys).set({ serverId: entry.id }).where(eq(mcpServerKeys.serverId, id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new RegistryError(409, `A server with id '${entry.id}' already exists`);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await tx.delete(mcpServers).where(eq(mcpServers.id, id)).returning({ id: mcpServers.id });
      if (removed.length === 0) throw new RegistryError(404, `No server with id '${id}'`);
      await tx.delete(mcpServerKeys).where(eq(mcpServerKeys.serverId, id));
    });
  }
}
