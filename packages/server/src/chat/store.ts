import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { llmProviders, mcpServerKeys } from "../db/schema.js";
import { keyHint, SecretBox } from "../secrets/crypto.js";
import { PROVIDERS, providerInfo, type ProviderId, type ProviderInfo, type ResolvedProvider } from "@akilimo/llm";

export class SettingsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  key: ProviderInfo["key"];
  keyUrl?: string;
  enabled: boolean;
  configured: boolean; // usable now: a key is saved, or none is needed
  baseUrl: string | null; // ollama and custom only
  keyHint: string | null; // last characters of the saved key, never the key
  editableBase: boolean;
}

// Provider settings and MCP server keys: plain settings and encrypted secrets in the accounts
// database. Without a database only Ollama (from OLLAMA_BASE_URL) is usable; without SECRETS_KEY
// secrets cannot be saved or read.
export class ChatSettings {
  constructor(
    private readonly db: Db | null,
    private readonly box: SecretBox | null,
    private readonly ollamaBaseUrl: string,
  ) {}

  private requireDb(): Db {
    if (!this.db) throw new SettingsError(503, "Saving settings needs the accounts database (DB_HOST)");
    return this.db;
  }

  private requireBox(): SecretBox {
    if (!this.box) throw new SettingsError(503, "Saving keys needs SECRETS_KEY on the server (generate one with: openssl rand -base64 32)");
    return this.box;
  }

  private async rows() {
    if (!this.db) return new Map<string, typeof llmProviders.$inferSelect>();
    return new Map((await this.db.select().from(llmProviders)).map((r) => [r.id, r]));
  }

  async statuses(): Promise<ProviderStatus[]> {
    const rows = await this.rows();
    return PROVIDERS.map((info): ProviderStatus => {
      const row = rows.get(info.id);
      const baseUrl = info.id === "ollama" ? row?.baseUrl || this.ollamaBaseUrl : info.id === "custom" ? row?.baseUrl ?? null : null;
      const hasKey = !!row?.apiKeyEnc;
      return {
        id: info.id,
        label: info.label,
        key: info.key,
        ...(info.keyUrl ? { keyUrl: info.keyUrl } : {}),
        enabled: row?.enabled ?? true,
        configured: info.id === "custom" ? !!baseUrl : info.key === "required" ? hasKey : true,
        baseUrl,
        keyHint: row?.keyHint ?? null,
        editableBase: info.id === "ollama" || info.id === "custom",
      };
    });
  }

  // The provider ready to call, or an error that says what is missing
  async resolve(id: string): Promise<ResolvedProvider> {
    const info = providerInfo(id);
    if (!info) throw new SettingsError(404, `Unknown provider '${id}'`);
    const row = (await this.rows()).get(info.id);
    if (row && !row.enabled) throw new SettingsError(409, `${info.label} is turned off`);
    const base = info.id === "ollama" ? row?.baseUrl || this.ollamaBaseUrl : info.id === "custom" ? row?.baseUrl ?? "" : info.base!;
    if (!base) throw new SettingsError(409, `${info.label} has no server URL yet; an administrator can set it`);
    let key = "";
    if (row?.apiKeyEnc) key = this.requireBox().decrypt(row.apiKeyEnc);
    if (info.key === "required" && !key) throw new SettingsError(409, `${info.label} has no API key yet; an administrator can add it`);
    return { info, base, key };
  }

  async updateProvider(id: string, change: { apiKey?: string | undefined; clearKey?: boolean | undefined; baseUrl?: string | undefined; enabled?: boolean | undefined }): Promise<void> {
    const info = providerInfo(id);
    if (!info) throw new SettingsError(404, `Unknown provider '${id}'`);
    const db = this.requireDb();
    const values: Partial<typeof llmProviders.$inferInsert> = { updatedAt: new Date() };
    if (change.apiKey !== undefined) {
      if (info.key === "none") throw new SettingsError(400, `${info.label} does not use a key`);
      values.apiKeyEnc = this.requireBox().encrypt(change.apiKey);
      values.keyHint = keyHint(change.apiKey);
    } else if (change.clearKey) {
      values.apiKeyEnc = null;
      values.keyHint = null;
    }
    if (change.baseUrl !== undefined) {
      if (info.id !== "ollama" && info.id !== "custom") throw new SettingsError(400, `${info.label} has a fixed address`);
      values.baseUrl = change.baseUrl || null;
    }
    if (change.enabled !== undefined) values.enabled = change.enabled;
    await db.insert(llmProviders).values({ id: info.id, ...values }).onConflictDoUpdate({ target: llmProviders.id, set: values });
  }

  // ── keys for upstream MCP servers ──────────────────────────────────────────

  async serverKeyHints(): Promise<Record<string, string>> {
    if (!this.db) return {};
    return Object.fromEntries((await this.db.select().from(mcpServerKeys)).map((r) => [r.serverId, r.keyHint]));
  }

  async serverKeys(): Promise<Record<string, string>> {
    if (!this.db) return {};
    const rows = await this.db.select().from(mcpServerKeys);
    if (rows.length === 0) return {};
    const box = this.requireBox();
    return Object.fromEntries(rows.map((r) => [r.serverId, box.decrypt(r.keyEnc)]));
  }

  async setServerKey(serverId: string, key: string): Promise<void> {
    const db = this.requireDb();
    const values = { keyEnc: this.requireBox().encrypt(key), keyHint: keyHint(key), updatedAt: new Date() };
    await db.insert(mcpServerKeys).values({ serverId, ...values }).onConflictDoUpdate({ target: mcpServerKeys.serverId, set: values });
  }

  async deleteServerKey(serverId: string): Promise<void> {
    await this.requireDb().delete(mcpServerKeys).where(eq(mcpServerKeys.serverId, serverId));
  }
}
