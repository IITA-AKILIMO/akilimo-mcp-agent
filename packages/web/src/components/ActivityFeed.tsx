import React from 'react';
import type { MCPEvent } from '@akilimo/shared';
import { Terminal, Cpu, Database, MessageSquare, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  events: MCPEvent[];
  servers: string[];
  disabledServers: string[];
  onToggleServer: (id: string) => void;
}

// Bootstrap contextual colour per MCP server
const ServerColors: Record<string, string> = {
  'akilimo-1.0': 'success',
  'akilimo-2.0': 'info',
  weather: 'primary',
  market: 'warning',
  logistics: 'danger',
  default: 'secondary',
};

const IconMap = {
  thought: <Cpu size={14} className="text-primary" />,
  tool_call: <Zap size={14} className="text-warning" />,
  tool_response: <Database size={14} className="text-success" />,
  synthesis: <MessageSquare size={14} className="text-info" />,
};

export const ActivityFeed: React.FC<Props> = ({ events, servers, disabledServers, onToggleServer }) => {
  return (
    <div className="card h-100 shadow-sm">
      <div className="card-header d-flex align-items-center gap-2">
        <Terminal size={16} className="text-body-secondary" />
        <h2 className="h6 mb-0 text-uppercase small fw-semibold text-body-secondary">
          Multi-Agent Orchestrator
        </h2>
        <span className="badge text-bg-secondary ms-auto">{events.length}</span>
      </div>
      <div className="px-3 py-2 border-bottom">
        <div className="small text-body-secondary mb-1">MCP servers</div>
        <div className="d-flex flex-wrap column-gap-3 row-gap-1">
          {servers.map(id => {
            const enabled = !disabledServers.includes(id);
            return (
              <div key={id} className="form-check form-switch mb-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id={`server-${id}`}
                  checked={enabled}
                  onChange={() => onToggleServer(id)}
                />
                <label className="form-check-label" htmlFor={`server-${id}`}>
                  <span className={`badge ${enabled ? `text-bg-${ServerColors[id] || ServerColors.default}` : 'text-bg-secondary opacity-50 text-decoration-line-through'}`}>
                    {id}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card-body overflow-y-auto overflow-x-hidden min-h-0 p-2">
        {events.length === 0 && (
          <p className="text-center text-body-secondary small mt-4 mb-0">
            Tool calls and responses will appear here.
          </p>
        )}
        <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
          <AnimatePresence>
            {events.map((event) => {
              const color = ServerColors[event.server] || ServerColors.default;
              return (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`border border-${color}-subtle border-start border-3 border-start-${color} rounded p-2 bg-body`}
                >
                  <div className="d-flex align-items-center gap-2 mb-1 small">
                    {IconMap[event.type]}
                    <span className={`badge text-bg-${color}`}>{event.server || 'system'}</span>
                    <span className="text-uppercase text-body-secondary" style={{ fontSize: '0.7rem' }}>
                      {event.type.replace('_', ' ')}
                    </span>
                    <span className="ms-auto text-body-secondary" style={{ fontSize: '0.7rem' }}>
                      {event.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="small">{event.message}</div>
                  {event.payload && Object.keys(event.payload).length > 0 && (
                    <details className="mt-1">
                      <summary className="small text-body-secondary">Payload</summary>
                      <pre className="event-payload mt-1 mb-0 p-2 bg-body-secondary rounded text-success-emphasis overflow-auto">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
};
