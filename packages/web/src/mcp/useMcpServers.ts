import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPEvent } from '@akilimo/shared';
import { loadKeys } from './keys';
import { gatewayUrl, listServers, needsKey, type McpServerConfig } from './servers';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerState {
  status: ConnectionStatus;
  tools: Tool[];
  error?: string;
}

const DISCONNECTED: ServerState = { status: 'disconnected', tools: [] };
const newId = () => crypto.randomUUID();

interface Options {
  // Called for every new activity event, e.g. to save it for a signed-in user
  onLog?: (event: MCPEvent) => void;
}

// Loads the MCP server registry from the gateway, connects over streamable HTTP through it,
// and logs every connection and call
export function useMcpServers({ onLog }: Options = {}) {
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const [configs, setConfigs] = useState<McpServerConfig[]>([]);
  const [editable, setEditable] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [servers, setServers] = useState<Record<string, ServerState>>({});
  const [events, setEvents] = useState<MCPEvent[]>([]);
  // Clients are not render state
  const clients = useRef<Record<string, Client>>({});
  const configsRef = useRef<McpServerConfig[]>([]);

  const log = useCallback((type: MCPEvent['type'], server: string, message: string, payload?: unknown) => {
    const event: MCPEvent = { id: newId(), timestamp: new Date(), type, server, message, payload };
    setEvents(prev => [...prev, event]);
    onLogRef.current?.(event);
  }, []);

  const update = (id: string, state: ServerState) => setServers(prev => ({ ...prev, [id]: state }));

  const disconnect = useCallback(async (id: string, quiet = false) => {
    const client = clients.current[id];
    if (!client) return;
    delete clients.current[id];
    await client.close().catch(() => undefined);
    update(id, DISCONNECTED);
    if (!quiet) log('connection', id, 'Disconnected');
  }, [log]);

  const connect = useCallback(async (id: string) => {
    const config = configsRef.current.find(s => s.id === id);
    if (!config) return;
    const key = loadKeys()[id];
    if (needsKey(config) && !key) {
      update(id, { status: 'error', tools: [], error: 'Enter a key first' });
      return;
    }

    await disconnect(id, true);
    update(id, { status: 'connecting', tools: [] });
    const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl(id), window.location.origin), {
      // The gateway forwards the key upstream in the form the registry entry specifies
      requestInit: key ? { headers: { 'X-Mcp-Key': key } } : undefined,
    });
    const client = new Client({ name: 'akilimo-web', version: '1.0.0' });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      clients.current[id] = client;
      update(id, { status: 'connected', tools });
      log('connection', id, `Connected, ${tools.length} tool(s) available`, { tools: tools.map(t => t.name) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.close().catch(() => undefined);
      update(id, { status: 'error', tools: [], error: message });
      log('error', id, `Connection failed: ${message}`);
    }
  }, [disconnect, log]);

  // Reloads the registry; servers that were removed or disabled are disconnected
  const reload = useCallback(async () => {
    try {
      const { servers: list, editable: canEdit } = await listServers();
      const enabled = list.filter(s => s.enabled);
      for (const id of Object.keys(clients.current)) {
        if (!enabled.some(s => s.id === id)) await disconnect(id);
      }
      configsRef.current = enabled;
      setConfigs(enabled);
      setEditable(canEdit);
      setRegistryError(null);
      setServers(prev => Object.fromEntries(enabled.map(s => [s.id, prev[s.id] ?? DISCONNECTED])));
      return enabled;
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : String(error));
      return [];
    }
  }, [disconnect]);

  // On load, connect every server that needs no key or has a remembered one
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    reload().then(list => {
      const keys = loadKeys();
      list.filter(s => !needsKey(s) || keys[s.id]).forEach(s => connect(s.id));
    });
  }, [reload, connect]);

  const callTool = useCallback(async (id: string, name: string, args: Record<string, unknown>) => {
    const client = clients.current[id];
    if (!client) throw new Error(`${id} is not connected`);

    log('tool_call', id, `Calling ${name}`, args);
    try {
      // Akilimo compute calls can take up to 120s
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 }) as CallToolResult;
      log(result.isError ? 'error' : 'tool_response', id, `${name} ${result.isError ? 'returned an error' : 'responded'}`, result.content);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', id, `${name} failed: ${message}`);
      throw error;
    }
  }, [log]);

  const clearEvents = useCallback(() => setEvents([]), []);
  // Shows saved history (e.g. after sign-in) followed by anything logged in this visit
  const replaceEvents = useCallback((saved: MCPEvent[]) => setEvents(prev => [...saved, ...prev]), []);

  return { configs, editable, registryError, servers, events, connect, disconnect, reload, callTool, clearEvents, replaceEvents };
}
