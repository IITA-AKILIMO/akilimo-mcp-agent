import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSpec } from "@akilimo/shared";
import type { Registry, ServerEntry } from "../gateway/registry.js";

export interface AgentTool {
  spec: ToolSpec;
  server: string;
  name: string;
}

// The tools of every enabled registry server for one chat turn. The server connects itself (with
// the key an admin saved for that server), so the browser only sends the user's messages.
export interface ToolSession {
  tools: AgentTool[];
  warnings: string[]; // servers that could not be reached, for the user to see
  callTool(server: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000; // compute calls are slow

// Function names must match ^[a-zA-Z0-9_-]{1,64}$, so "akilimo-1.0" + "get_reference_data"
// becomes "akilimo-1_0__get_reference_data"
const functionName = (server: string, tool: string) => `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}__${tool}`.slice(0, 64);

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} s`)), ms).unref()),
  ]);

async function connect(entry: ServerEntry, key: string | undefined): Promise<{ client: Client; tools: AgentTool[] }> {
  const headers: Record<string, string> = {};
  if (key && entry.auth.type === "bearer") headers.authorization = `Bearer ${key}`;
  if (key && entry.auth.type === "header") headers[entry.auth.header.toLowerCase()] = key;
  const client = new Client({ name: "akilimo-chat", version: "1.0.0" });
  try {
    await withTimeout(client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers } })), CONNECT_TIMEOUT_MS, entry.label);
    const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, entry.label);
    return {
      client,
      tools: tools.map((tool) => ({
        server: entry.id,
        name: tool.name,
        spec: {
          type: "function" as const,
          function: { name: functionName(entry.id, tool.name), description: `[${entry.label}] ${tool.description ?? tool.name}`, parameters: tool.inputSchema },
        },
      })),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export async function openTools(registry: Registry, keys: Record<string, string>): Promise<ToolSession> {
  const clients = new Map<string, Client>();
  const tools: AgentTool[] = [];
  const warnings: string[] = [];

  const entries = (await registry.list()).filter((e) => e.enabled);
  await Promise.all(entries.map(async (entry) => {
    // A server that needs a key and has none saved would only answer 401
    if (entry.auth.type !== "none" && !keys[entry.id]) {
      warnings.push(`${entry.label} was skipped: no key is saved for it`);
      return;
    }
    try {
      const connected = await connect(entry, keys[entry.id]);
      clients.set(entry.id, connected.client);
      tools.push(...connected.tools);
    } catch (error) {
      warnings.push(`${entry.label} is not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  // Keep the registry's order so the model sees the tools consistently
  const order = new Map(entries.map((e, i) => [e.id, i]));
  tools.sort((a, b) => (order.get(a.server) ?? 0) - (order.get(b.server) ?? 0));

  return {
    tools,
    warnings,
    async callTool(server, name, args, signal) {
      const client = clients.get(server);
      if (!client) throw new Error(`Server '${server}' is not connected`);
      return (await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, ...(signal ? { signal } : {}) })) as CallToolResult;
    },
    async close() {
      await Promise.all([...clients.values()].map((c) => c.close().catch(() => undefined)));
    },
  };
}
