import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerEntry } from "./registry.js";

export interface ConnectionTest {
  ok: boolean;
  ms: number;
  server?: { name: string; version: string };
  tools?: string[];
  error?: string;
}

const TIMEOUT_MS = 20_000;

// fetch hides the reason ("fetch failed") in error.cause; a web page instead of JSON-RPC usually
// means a wrong path
const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  if (error.message === "fetch failed" && cause) return `Cannot connect: ${cause.code ?? cause.message}`;
  if (/<(!doctype|html)/i.test(error.message)) return "The URL answered with a web page, not an MCP endpoint. Check the path (usually /mcp).";
  // The SDK appends the raw response body; show a JSON body's error text instead
  const body = error.message.indexOf("{");
  if (body >= 0) {
    try {
      const parsed = JSON.parse(error.message.slice(body));
      const text = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
      if (typeof text === "string") return `${error.message.slice(0, body).replace(/[:\s]+$/, "")}: ${text}`;
    } catch { /* not JSON */ }
  }
  return error.message.length > 400 ? `${error.message.slice(0, 400)}…` : error.message;
};

// Connects to an MCP server the way the gateway would (same URL and key header) and lists its
// tools, so an admin can check an entry before saving it
export async function testConnection(entry: Pick<ServerEntry, "url" | "auth">, key: string | undefined): Promise<ConnectionTest> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (key && entry.auth.type === "bearer") headers.authorization = `Bearer ${key}`;
  if (key && entry.auth.type === "header") headers[entry.auth.header.toLowerCase()] = key;

  const client = new Client({ name: "akilimo-gateway-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers } });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`No answer within ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS).unref());
  try {
    await Promise.race([client.connect(transport), timeout]);
    const { tools } = await Promise.race([client.listTools(), timeout]);
    const info = client.getServerVersion();
    return {
      ok: true,
      ms: Date.now() - started,
      ...(info ? { server: { name: info.name, version: info.version } } : {}),
      tools: tools.map(t => t.name),
    };
  } catch (error) {
    const message = describe(error);
    const needsKey = /\b401\b|unauthori[sz]ed|missing api key/i.test(message);
    return {
      ok: false,
      ms: Date.now() - started,
      error: needsKey && !key ? `${message} (this server probably needs a key: enter it to test)` : message,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
