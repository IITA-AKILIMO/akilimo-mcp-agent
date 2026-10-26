import React from 'react';
import type { MCPEvent } from '@akilimo/shared';
import { AlertTriangle, Database, Plug, Terminal, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  events: MCPEvent[];
  onClear: () => void;
}

// Bootstrap contextual colour per MCP server
const ServerColors: Record<string, string> = {
  'akilimo-1.0': 'success',
  'akilimo-2.0': 'info',
  default: 'secondary',
};

const IconMap: Record<MCPEvent['type'], React.ReactNode> = {
  connection: <Plug size={14} className="text-primary" />,
  tool_call: <Zap size={14} className="text-warning" />,
  tool_response: <Database size={14} className="text-success" />,
  error: <AlertTriangle size={14} className="text-danger" />,
};

export const ActivityFeed: React.FC<Props> = ({ events, onClear }) => {
  return (
    <div className="card shadow-sm flex-grow-1 min-h-0">
      <div className="card-header d-flex align-items-center gap-2">
        <Terminal size={16} className="text-body-secondary" />
        <h2 className="h6 mb-0 text-uppercase small fw-semibold text-body-secondary">Activity</h2>
        <span className="badge text-bg-secondary ms-auto">{events.length}</span>
        <button type="button" className="btn btn-sm btn-link p-0 small" onClick={onClear} disabled={events.length === 0}>
          Clear
        </button>
      </div>
      <div className="card-body overflow-y-auto overflow-x-hidden min-h-0 p-2">
        {events.length === 0 && (
          <p className="text-center text-body-secondary small mt-4 mb-0">
            Connections, tool calls and responses will appear here.
          </p>
        )}
        <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
          <AnimatePresence>
            {[...events].reverse().map((event) => {
              const color = event.type === 'error' ? 'danger' : (ServerColors[event.server] || ServerColors.default);
              return (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`border border-${color}-subtle border-start border-3 border-start-${color} rounded p-2 bg-body`}
                >
                  <div className="d-flex align-items-center gap-2 mb-1 small">
                    {IconMap[event.type]}
                    <span className={`badge text-bg-${ServerColors[event.server] || ServerColors.default}`}>{event.server}</span>
                    <span className="text-uppercase text-body-secondary" style={{ fontSize: '0.7rem' }}>
                      {event.type.replace('_', ' ')}
                    </span>
                    <span className="ms-auto text-body-secondary" style={{ fontSize: '0.7rem' }}>
                      {event.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="small text-break">{event.message}</div>
                  {event.payload !== undefined && (
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
