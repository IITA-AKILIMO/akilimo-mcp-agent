import React from 'react';
import { MCPEvent } from '../types/mcp';
import { Terminal, Cpu, Database, MessageSquare, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  events: MCPEvent[];
}

const ServerColors: Record<string, string> = {
  akilimo: 'text-green-400 border-green-900/50 bg-green-900/10',
  weather: 'text-blue-400 border-blue-900/50 bg-blue-900/10',
  market: 'text-yellow-400 border-yellow-900/50 bg-yellow-900/10',
  logistics: 'text-purple-400 border-purple-900/50 bg-purple-900/10',
  default: 'text-slate-400 border-slate-700/50 bg-slate-800/50',
};

const IconMap = {
  thought: <Cpu className="w-4 h-4 text-blue-400" />,
  tool_call: <Zap className="w-4 h-4 text-yellow-400" />,
  tool_response: <Database className="w-4 h-4 text-green-400" />,
  synthesis: <MessageSquare className="w-4 h-4 text-purple-400" />,
};

export const ActivityFeed: React.FC<Props> = ({ events }) => {
  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 overflow-hidden">
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
        <Terminal className="w-5 h-5 text-slate-400" />
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-slate-400">
          Multi-Agent Orchestrator
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
        <AnimatePresence>
          {events.map((event) => {
            const colorClass = ServerColors[event.server] || ServerColors.default;
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-3 rounded-lg border ${colorClass} shadow-sm`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {IconMap[event.type]}
                  <span className="font-bold uppercase text-[10px]">
                    {event.server ? `[${event.server}]` : '[System]'} {event.type.replace('_', ' ')}
                  </span>
                  <span className="ml-auto text-slate-500 opacity-70">
                    {event.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-slate-300 leading-relaxed">
                  {event.message}
                </div>
                {event.payload && (
                  <div className="mt-2 p-2 bg-black/40 rounded border border-slate-700 text-green-400 overflow-x-auto">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(event.payload, null, 2)}</pre>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
