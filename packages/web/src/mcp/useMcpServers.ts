import { useCallback, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPEvent } from '@akilimo/shared';
import { MCP_SERVERS } from './servers';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerState {
  status: ConnectionStatus;
  tools: Tool[];
  error?: string;
}

const initialState = (): Record<string, ServerState> =>
  Object.fromEntries(MCP_SERVERS.map(s => [s.id, { status: 'disconnected', tools: [] }]));

const newId = () => crypto.randomUUID();

// Connects to the configured MCP servers over streamable HTTP and logs every call
export function useMcpServers() {
  const [servers, setServers] = useState<Record<string, ServerState>>(initialState);
  const [events, setEvents] = useState<MCPEvent[]>([]);
  // Clients are not render state; keys stay in memory only and are never persisted
  const clients = useRef<Record<string, Client>>({});

  const log = useCallback((type: MCPEvent['type'], server: string, message: string, payload?: unknown) => {
    setEvents(prev => [...prev, { id: newId(), timestamp: new Date(), type, server, message, payload }]);
  }, []);

  const update = (id: string, state: ServerState) => setServers(prev => ({ ...prev, [id]: state }));

  const connect = useCallback(async (id: string, key?: string) => {
    const config = MCP_SERVERS.find(s => s.id === id);
    if (!config) return;
    if (config.needsKey && !key?.trim()) {
      update(id, { status: 'error', tools: [], error: 'Enter a key first' });
      return;
    }

    update(id, { status: 'connecting', tools: [] });
    const transport = new StreamableHTTPClientTransport(new URL(config.url, window.location.origin), {
      requestInit: key ? { headers: { Authorization: `Bearer ${key.trim()}` } } : undefined,
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
  }, [log]);

  const disconnect = useCallback(async (id: string) => {
    await clients.current[id]?.close().catch(() => undefined);
    delete clients.current[id];
    update(id, { status: 'disconnected', tools: [] });
    log('connection', id, 'Disconnected');
  }, [log]);

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

  return { servers, events, connect, disconnect, callTool, clearEvents };
}
