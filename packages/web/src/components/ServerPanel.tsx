import React, { useState } from 'react';
import { Server } from 'lucide-react';
import { MCP_SERVERS } from '../mcp/servers';
import type { ConnectionStatus, ServerState } from '../mcp/useMcpServers';

interface Props {
  servers: Record<string, ServerState>;
  onConnect: (id: string, key?: string) => void;
  onDisconnect: (id: string) => void;
}

const StatusBadge: Record<ConnectionStatus, string> = {
  disconnected: 'text-bg-secondary',
  connecting: 'text-bg-warning',
  connected: 'text-bg-success',
  error: 'text-bg-danger',
};

export const ServerPanel: React.FC<Props> = ({ servers, onConnect, onDisconnect }) => {
  // Keys live in component state only: never written to storage or sent anywhere but the proxy
  const [keys, setKeys] = useState<Record<string, string>>({});

  return (
    <div className="card shadow-sm flex-shrink-0">
      <div className="card-header d-flex align-items-center gap-2">
        <Server size={16} className="text-body-secondary" />
        <h2 className="h6 mb-0 text-uppercase small fw-semibold text-body-secondary">MCP servers</h2>
      </div>
      <ul className="list-group list-group-flush">
        {MCP_SERVERS.map(s => {
          const state = servers[s.id];
          const on = state.status === 'connected' || state.status === 'connecting';
          return (
            <li key={s.id} className="list-group-item">
              <div className="d-flex align-items-center gap-2">
                <div className="form-check form-switch mb-0">
                  <input className="form-check-input" type="checkbox" role="switch" id={`server-${s.id}`}
                    checked={on} disabled={state.status === 'connecting'}
                    onChange={e => (e.target.checked ? onConnect(s.id, keys[s.id]) : onDisconnect(s.id))} />
                  <label className="form-check-label fw-semibold" htmlFor={`server-${s.id}`}>{s.label}</label>
                </div>
                <span className={`badge ${StatusBadge[state.status]} ms-auto`}>
                  {state.status === 'connected' ? `${state.tools.length} tools` : state.status}
                </span>
              </div>
              <div className="small text-body-secondary">{s.description}</div>
              {s.needsKey && (
                <div className="mt-2">
                  <input type="password" className="form-control form-control-sm" autoComplete="off"
                    placeholder="Partner key" aria-label={`${s.label} key`} value={keys[s.id] ?? ''}
                    disabled={on} onChange={e => setKeys(prev => ({ ...prev, [s.id]: e.target.value }))} />
                  {s.keyHelp && <div className="form-text mt-0">{s.keyHelp}</div>}
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
