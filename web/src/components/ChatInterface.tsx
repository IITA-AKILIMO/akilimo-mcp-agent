import React, { useState } from 'react';
import { Message, Scenario } from '../types/mcp';
import { Send, Play, User, Bot } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  messages: Message[];
  scenarios: Scenario[];
  onSendMessage: (text: string) => void;
  onRunScenario: (scenario: Scenario) => void;
  isTyping: boolean;
}

export const ChatInterface: React.FC<Props> = ({ 
  messages, 
  scenarios, 
  onSendMessage, 
  onRunScenario, 
  isTyping 
}) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="p-6 border-b border-slate-800 bg-slate-900/30">
        <h1 className="text-2xl font-bold text-white">Akilimo <span className="text-akilimo-lightGreen">Intelligence</span></h1>
        <p className="text-slate-400 text-sm">AI Agricultural Consultant powered by MCP</p>
      </div>

      {/* Scenarios */}
      <div className="p-4 flex gap-2 overflow-x-auto no-scrollbar">
        {scenarios.map(s => (
          <button
            key={s.id}
            onClick={() => onRunScenario(s)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-akilimo-green text-slate-200 rounded-full text-xs whitespace-nowrap transition-all border border-slate-700"
          >
            <Play className="w-3 h-3 fill-current" />
            {s.name}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${m.role === 'user' ? 'bg-akilimo-green' : 'bg-slate-700'}`}>
              {m.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
            </div>
            <div className={`max-w-[80%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-akilimo-green text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
              <p className="text-sm leading-relaxed">{m.text}</p>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="bg-slate-800 p-4 rounded-2xl rounded-tl-none">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-6 bg-slate-900/50 border-t border-slate-800">
        <div className="flex gap-3 max-w-4xl mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about fertilizer, crop pricing or planting..."
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-akilimo-green transition-all"
          />
          <button
            onClick={handleSend}
            className="p-3 bg-akilimo-green hover:bg-green-700 text-white rounded-xl transition-all"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
