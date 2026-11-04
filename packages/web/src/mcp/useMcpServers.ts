import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPEvent } from '@akilimo/shared';
import { deleteMyKey, saveMyKey } from '../llm/api';
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
  // Servers an admin saved a shared key for (offered to signed-in users)
  const [sharedKeys, setSharedKeys] = useState<string[]>([]);
  const sharedKeysRef = useRef<string[]>([]);
  // The keys the signed-in user saved in their account (last characters), so nothing is asked of them for those servers
  const [ownKeys, setOwnKeys] = useState<Record<string, string>>({});
  const ownKeysRef = useRef<Record<string, string>>({});
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
    // Without a key of their own, a signed-in user is served with the shared key (the gateway adds it, within a limit)
    if (needsKey(config) && !key && !ownKeysRef.current[id] && !sharedKeysRef.current.includes(id)) {
      // The list can be out of date (an admin saved a shared key after this page loaded): ask the gateway again first
      try {
        const fresh = await listServers();
        sharedKeysRef.current = fresh.shared_keys ?? [];
        setSharedKeys(sharedKeysRef.current);
        ownKeysRef.current = fresh.own_keys ?? {};
        setOwnKeys(ownKeysRef.current);
      } catch { /* keep the old list */ }
      if (!ownKeysRef.current[id] && !sharedKeysRef.current.includes(id)) {
        update(id, { status: 'error', tools: [], error: 'Enter your key in the box above, or ask an admin to save a shared key' });
        return;
      }
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
      const { servers: list, editable: canEdit, shared_keys, own_keys } = await listServers();
      const enabled = list.filter(s => s.enabled);
      sharedKeysRef.current = shared_keys ?? [];
      setSharedKeys(sharedKeysRef.current);
      ownKeysRef.current = own_keys ?? {};
      setOwnKeys(ownKeysRef.current);
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
      list.filter(s => !needsKey(s) || keys[s.id] || ownKeysRef.current[s.id] || sharedKeysRef.current.includes(s.id)).forEach(s => connect(s.id));
    });
  }, [reload, connect]);

  // After signing in or out the shared keys on offer change: drop the servers that lost their key and connect
  // the ones that gained one
  const refreshAccess = useCallback(async () => {
    const list = await reload();
    const own = loadKeys();
    for (const s of list.filter(needsKey)) {
      const eligible = Boolean(own[s.id]) || Boolean(ownKeysRef.current[s.id]) || sharedKeysRef.current.includes(s.id);
      if (!eligible && clients.current[s.id]) await disconnect(s.id);
      else if (eligible && !clients.current[s.id]) await connect(s.id);
    }
  }, [reload, disconnect, connect]);

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

  // Save or remove the key of the signed-in user for a server in their account, then connect or drop it accordingly
  const saveOwnKey = useCallback(async (id: string, key: string) => {
    await saveMyKey(id, key);
    await refreshAccess();
    await disconnect(id, true);
    await connect(id);
  }, [refreshAccess, disconnect, connect]);
  const removeOwnKey = useCallback(async (id: string) => {
    await deleteMyKey(id);
    await refreshAccess();
  }, [refreshAccess]);

  return { configs, editable, sharedKeys, ownKeys, saveOwnKey, removeOwnKey, registryError, servers, events, connect, disconnect, reload, refreshAccess, callTool, clearEvents, replaceEvents };
}
