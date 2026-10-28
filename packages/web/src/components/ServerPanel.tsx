import React, { useState } from 'react';
import { Server, Settings2 } from 'lucide-react';
import { loadKeys, saveKey } from '../mcp/keys';
import { describeAuth, needsKey, type McpServerConfig } from '../mcp/servers';
import type { ConnectionStatus, ServerState } from '../mcp/useMcpServers';

interface Props {
  configs: McpServerConfig[];
  servers: Record<string, ServerState>;
  registryError: string | null;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  // Only admins see Manage; registry changes are checked server-side as well
  canManage: boolean;
  onManage: () => void;
}

const StatusBadge: Record<ConnectionStatus, string> = {
  disconnected: 'text-bg-secondary',
  connecting: 'text-bg-warning',
  connected: 'text-bg-success',
  error: 'text-bg-danger',
};

export const ServerPanel: React.FC<Props> = ({ configs, servers, registryError, onConnect, onDisconnect, canManage, onManage }) => {
  // Remembered in this browser (see mcp/keys.ts); sent only with requests to that server
  const [keys, setKeys] = useState<Record<string, string>>(loadKeys);

  const setKey = (id: string, key: string) => {
    setKeys(prev => ({ ...prev, [id]: key }));
    saveKey(id, key);
  };

  return (
    <div className="card shadow-sm flex-shrink-0">
      <div className="card-header d-flex align-items-center gap-2">
        <Server size={16} className="text-body-secondary" />
        <h2 className="h6 mb-0 text-uppercase small fw-semibold text-body-secondary">MCP servers</h2>
        {canManage && (
          <button type="button" className="btn btn-sm btn-outline-secondary ms-auto d-inline-flex align-items-center gap-1" onClick={onManage} title="Manage MCP servers, AI providers and users">
            <Settings2 size={14} /> Manage
          </button>
        )}
      </div>
      {registryError && <div className="alert alert-danger small m-2 mb-0">Cannot load the server list: {registryError}</div>}
      {!registryError && configs.length === 0 && (
        <div className="small text-body-secondary p-3">
          No servers configured.{canManage ? ' Use Manage to add one.' : ' An admin can add them.'}
        </div>
      )}
      <ul className="list-group list-group-flush">
        {configs.map(s => {
          const state = servers[s.id] ?? { status: 'disconnected', tools: [] };
          const on = state.status === 'connected' || state.status === 'connecting';
          return (
            <li key={s.id} className="list-group-item">
              <div className="d-flex align-items-center gap-2">
                <div className="form-check form-switch mb-0">
                  <input className="form-check-input" type="checkbox" role="switch" id={`server-${s.id}`}
                    checked={on} disabled={state.status === 'connecting'}
                    onChange={e => (e.target.checked ? onConnect(s.id) : onDisconnect(s.id))} />
                  <label className="form-check-label fw-semibold" htmlFor={`server-${s.id}`}>{s.label}</label>
                </div>
                <span className={`badge ${StatusBadge[state.status]} ms-auto`}>
                  {state.status === 'connected' ? `${state.tools.length} tools` : state.status}
                </span>
              </div>
              {s.description && <div className="small text-body-secondary">{s.description}</div>}
              {needsKey(s) && (
                <div className="mt-2">
                  <input type="password" className="form-control form-control-sm" autoComplete="off"
                    placeholder="Key" aria-label={`${s.label} key`} value={keys[s.id] ?? ''}
                    disabled={on} onChange={e => setKey(s.id, e.target.value)} />
                  <div className="form-text mt-0">{describeAuth(s.auth)}; remembered in this browser</div>
                </div>
              )}
              {state.status === 'error' && state.error && (
                <div className="small text-danger mt-1 text-break">{state.error}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
