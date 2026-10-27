// Client for the MCP gateway on the Akilimo 1.0 server (packages/server/src/gateway), reached
// through the same-origin /gateway path (Vite proxy in dev, nginx in Docker). Registry changes
// are authorised by the signed-in admin's session cookie.
const BASE = '/gateway';

export type ServerAuth = { type: 'none' } | { type: 'bearer' } | { type: 'header'; header: string };

export interface McpServerConfig {
  id: string;
  label: string;
  description: string;
  url: string; // upstream URL, as registered
  auth: ServerAuth;
  enabled: boolean;
}

export const gatewayUrl = (id: string) => `${BASE}/servers/${encodeURIComponent(id)}/mcp`;
export const needsKey = (s: McpServerConfig) => s.auth.type !== 'none';
export const describeAuth = (auth: ServerAuth) =>
  auth.type === 'none' ? 'No key' : auth.type === 'bearer' ? 'Key sent as Authorization: Bearer' : `Key sent as ${auth.header}`;

const request = async <T,>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    // Writes are always JSON: the gateway rejects other content types (CSRF guard)
    headers: method === 'GET' ? extraHeaders : { 'Content-Type': 'application/json', ...extraHeaders },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    throw new Error(message || `Gateway responded ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
};

// `editable` is true when the signed-in user is an admin
export const listServers = () =>
  request<{ servers: McpServerConfig[]; editable: boolean }>('GET', '/servers');
export const addServer = (server: McpServerConfig) => request<McpServerConfig>('POST', '/servers', server);
export const updateServer = (id: string, server: McpServerConfig) =>
  request<McpServerConfig>('PUT', `/servers/${encodeURIComponent(id)}`, server);
export const removeServer = (id: string) => request<void>('DELETE', `/servers/${encodeURIComponent(id)}`);

export interface ConnectionTest {
  ok: boolean;
  ms: number;
  server?: { name: string; version: string };
  tools?: string[];
  error?: string;
}
// Admin only: the gateway connects to the URL and lists its tools, without saving anything
export const testServer = (server: Pick<McpServerConfig, 'url' | 'auth'>, key?: string) =>
  request<ConnectionTest>('POST', '/test', { url: server.url, auth: server.auth }, key ? { 'X-Mcp-Key': key } : {});
