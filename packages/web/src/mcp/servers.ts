// Client for the MCP gateway on the Akilimo 1.0 server (packages/server/src/gateway), reached
// through the same-origin /gateway path (Vite proxy in dev, nginx in Docker)
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

const request = async <T,>(method: string, path: string, adminToken?: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    throw new Error(message || `Gateway responded ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
};

export const listServers = () =>
  request<{ servers: McpServerConfig[]; editable: boolean }>('GET', '/servers');
export const checkAdmin = (token: string) => request<void>('GET', '/admin', token);
export const addServer = (token: string, server: McpServerConfig) => request<McpServerConfig>('POST', '/servers', token, server);
export const updateServer = (token: string, id: string, server: McpServerConfig) =>
  request<McpServerConfig>('PUT', `/servers/${encodeURIComponent(id)}`, token, server);
export const removeServer = (token: string, id: string) => request<void>('DELETE', `/servers/${encodeURIComponent(id)}`, token);
