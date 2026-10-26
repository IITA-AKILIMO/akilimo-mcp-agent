import React, { useEffect, useRef, useState } from 'react';
import type { Message, Scenario } from '@akilimo/shared';
import { Send, Play, User, Bot, MessagesSquare } from 'lucide-react';

interface Props {
  messages: Message[];
  scenarios: Scenario[];
  onSendMessage: (text: string) => void;
  onRunScenario: (scenario: Scenario) => void;
  isTyping: boolean;
  busy: boolean;
}

export const ChatInterface: React.FC<Props> = ({
  messages,
  scenarios,
  onSendMessage,
  onRunScenario,
  isTyping,
  busy
}) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="card h-100 shadow-sm">
      {/* Scenarios */}
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <span className="small text-body-secondary me-1">Demo scenarios</span>
        {scenarios.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => onRunScenario(s)}
            disabled={busy}
            title={s.description}
            className="btn btn-sm btn-outline-secondary rounded-pill d-inline-flex align-items-center gap-1"
          >
            <Play size={12} />
            {s.name}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="card-body overflow-auto min-h-0 d-flex flex-column gap-3">
        {messages.length === 0 && !isTyping && (
          <div className="m-auto text-center text-body-secondary">
            <MessagesSquare size={40} className="mb-2 opacity-50" />
            <p className="mb-0">Pick a demo scenario above or ask a question below.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`d-flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`avatar rounded-circle d-flex align-items-center justify-content-center ${m.role === 'user' ? 'bg-akilimo' : 'bg-secondary'}`}>
              {m.role === 'user' ? <User size={18} color="white" /> : <Bot size={18} color="white" />}
            </div>
            <div className={`chat-bubble px-3 py-2 rounded-3 small ${m.role === 'user' ? 'bg-akilimo text-white' : 'bg-body-tertiary border'}`}>
              {m.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="d-flex gap-2">
            <div className="avatar rounded-circle bg-secondary d-flex align-items-center justify-content-center">
              <Bot size={18} color="white" />
            </div>
            <div className="px-3 py-2 rounded-3 bg-body-tertiary border d-flex align-items-center gap-1" aria-label="Assistant is typing">
              <span className="spinner-grow spinner-grow-sm text-secondary" />
              <span className="spinner-grow spinner-grow-sm text-secondary" />
              <span className="spinner-grow spinner-grow-sm text-secondary" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="card-footer">
        <form className="input-group" onSubmit={handleSend}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about fertilizer, crop pricing or planting..."
            className="form-control"
            aria-label="Message"
          />
          <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-1" disabled={busy || !input.trim()}>
            <Send size={16} />
            <span className="d-none d-sm-inline">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
