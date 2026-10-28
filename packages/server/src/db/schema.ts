// Accounts database (PostgreSQL). After changing a table, create a migration with
// `pnpm --filter @akilimo/server db:generate` (drizzle-kit, no database needed) and review the SQL
// in drizzle/; migrations are applied when the server starts. See AGENTS.md.
//
// Table, index and constraint names match what Prisma created before this project moved to Drizzle,
// so databases created by either tool are the same.
import { randomUUID } from "node:crypto";
import { boolean, foreignKey, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 6, mode: "date" });

// Admins manage the shared MCP server registry and other users' roles
export const roleEnum = pgEnum("Role", ["user", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  email: text("email").notNull(),
  // Lowercase, 3-30 of a-z 0-9 . _ - (validated in the API); sign-in accepts it instead of the email
  username: text("username").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("user"),
  // The user's own choice to let the AI chat search the internet, for every conversation (off by default)
  webSearch: boolean("web_search").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_key").on(t.email),
  uniqueIndex("users_username_key").on(t.username),
]);

// Only a SHA-256 of the session token is stored, so a database leak does not expose sessions
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
}, (t) => [
  foreignKey({ name: "sessions_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade").onUpdate("cascade"),
  index("sessions_user_id_idx").on(t.userId),
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  model: text("model"),
  // "ai" = the free-text chat, "guided" = buttons and forms answered by the AKILIMO tools
  mode: text("mode").notNull().default("ai"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "conversations_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade").onUpdate("cascade"),
  // PostgreSQL's default for DESC is NULLS FIRST (drizzle-kit would otherwise write NULLS LAST)
  index("conversations_user_id_updated_at_idx").on(t.userId, t.updatedAt.desc().nullsFirst()),
]);

// The full model history, including tool calls and tool results, so a reopened chat keeps its context
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolCalls: jsonb("tool_calls").$type<unknown[]>(),
  toolName: text("tool_name"),
  // Guided conversations keep each step here: { action, country, request, result }
  data: jsonb("data").$type<unknown>(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "messages_conversation_id_fkey", columns: [t.conversationId], foreignColumns: [conversations.id] }).onDelete("cascade").onUpdate("cascade"),
  index("messages_conversation_id_id_idx").on(t.conversationId, t.id),
]);

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  server: text("server").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").$type<unknown>(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "activity_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade").onUpdate("cascade"),
  index("activity_user_id_id_idx").on(t.userId, t.id.desc().nullsFirst()),
]);

// The shared MCP server list (gateway and chat). Filled with the default servers on the first start
// and managed by admins from then on. Keys for servers that need one are in mcp_server_keys.
export const mcpServers = pgTable("mcp_servers", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  url: text("url").notNull(),
  authType: text("auth_type").notNull().default("none"), // none | bearer | header
  authHeader: text("auth_header"),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

// Settings of the chat's LLM providers, managed by admins. The API key is encrypted (see
// secrets/crypto.ts); key_hint only holds the last characters for display.
export const llmProviders = pgTable("llm_providers", {
  id: text("id").primaryKey(),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  keyHint: text("key_hint"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

// Keys for upstream MCP servers that need one (e.g. Akilimo 2.0), used when the server runs the
// chat's tool calls; encrypted like the provider keys
export const mcpServerKeys = pgTable("mcp_server_keys", {
  serverId: text("server_id").primaryKey(),
  keyEnc: text("key_enc").notNull(),
  keyHint: text("key_hint").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

// The chat's web search service, set by an admin (one row, id "default"). The key is encrypted like the
// provider keys; without a row the SEARCH_* environment variables are used, and enabled false turns
// search off whatever the environment says.
export const webSearchSettings = pgTable("web_search_settings", {
  id: text("id").primaryKey(),
  provider: text("provider"),
  baseUrl: text("base_url"),
  apiKeyEnc: text("api_key_enc"),
  keyHint: text("key_hint"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export type Role = (typeof roleEnum.enumValues)[number];
