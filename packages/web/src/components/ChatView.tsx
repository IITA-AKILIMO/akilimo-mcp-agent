import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Bot, History, Loader2, MapPin, RotateCcw, Send, Settings2, Square, Trash2, User, Wrench, X } from 'lucide-react';
import {
  appendMessages, createConversation, deleteConversation, getConversation, listConversations,
  type ConversationSummary, type User as Account,
} from '../account/api';
import { buildTools, runAgent, type AgentStep } from '../llm/agent';
import { PROVIDERS, type ProviderId } from '../llm/providers';
import type { ChatMessage } from '../llm/types';
import { COUNTRIES, akilimoExamples, contextExamples, findCountry } from '../llm/countries';
import { useLlm } from '../llm/useLlm';
import { read, write } from '../mcp/keys';
import type { McpServerConfig } from '../mcp/servers';
import type { ServerState } from '../mcp/useMcpServers';
import { LlmSettings } from './LlmSettings';
import { MapPicker } from './MapPicker';

interface Props {
  configs: McpServerConfig[];
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  accountsEnabled: boolean;
  user: Account | null;
}

interface QueuedMessage { id: string; text: string }

type Item =
  | { id: string; kind: 'user' | 'assistant'; text: string }
  | { id: string; kind: 'step'; step: AgentStep };

const COUNTRY_KEY = 'chat-country';

const hasContextTools = (servers: Record<string, ServerState>) =>
  Object.values(servers).some(s => s.tools.some(t => /weather|soil|climate|forecast|agriculture_profile|compare_countries/i.test(t.name)));

const newId = () => crypto.randomUUID();

// Only the fields the model needs; saved messages also carry ids and timestamps
const toChatMessage = (m: ChatMessage): ChatMessage => ({
  role: m.role,
  content: m.content ?? '',
  ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
  ...(m.tool_name ? { tool_name: m.tool_name } : {}),
});

export const ChatView: React.FC<Props> = ({ configs, servers, callTool, accountsEnabled, user }) => {
  const llm = useLlm();
  const { model } = llm;
  const [showSettings, setShowSettings] = useState(false);
  // Open the provider settings when a key or URL is missing; they stay open while it is typed in
  useEffect(() => {
    if (llm.setup) setShowSettings(true);
  }, [llm.setup]);

  const [items, setItems] = useState<Item[]>([]);
  const history = useRef<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // The chat starts by asking where the user farms; the answer is remembered in this browser
  const [countryCode, setCountryCode] = useState<string>(() => read<string>(COUNTRY_KEY, ''));
  const country = findCountry(countryCode);

  const [showMap, setShowMap] = useState(false);
  const [picked, setPicked] = useState<{ lat?: number; lon?: number; country?: string }>(() => ({ country: countryCode || undefined }));

  // Saved conversation of a signed-in user; writes are chained so messages keep their order
  const conversationId = useRef<string | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const tools = useMemo(() => buildTools(configs, servers), [configs, servers]);

  const persist = (messages: ChatMessage[], titleHint: string) => {
    if (!user) return;
    saveChain.current = saveChain.current
      .then(async () => {
        if (!conversationId.current) {
          conversationId.current = (await createConversation(titleHint.slice(0, 80) || 'Conversation', llm.label)).id;
        }
        await appendMessages(conversationId.current, messages.map(toChatMessage));
        setSaveError(null);
      })
      .catch(e => setSaveError(`Not saved: ${e instanceof Error ? e.message : String(e)}`));
  };

  // Maps "akilimo-1_0__get_cassava_price" back to the registered server id and tool name
  const splitToolName = (name = '') => {
    const [prefix, ...rest] = name.split('__');
    const server = configs.find(c => c.id.replace(/[^a-zA-Z0-9_-]/g, '_') === prefix)?.id ?? prefix;
    return { server, tool: rest.join('__') || name };
  };

  const itemsFromHistory = (messages: ChatMessage[]): Item[] => messages.flatMap((m): Item[] => {
    if (m.role === 'user') return [{ id: newId(), kind: 'user', text: m.content }];
    if (m.role === 'tool') {
      return [{ id: newId(), kind: 'step', step: { type: 'tool_result', ...splitToolName(m.tool_name), result: m.content, isError: m.content.startsWith('Error:') } }];
    }
    if (m.role === 'assistant') {
      return [
        ...(m.tool_calls ?? []).map((c): Item => ({ id: newId(), kind: 'step', step: { type: 'tool_call', ...splitToolName(c.function.name), args: c.function.arguments } })),
        ...(m.content ? [{ id: newId(), kind: 'assistant' as const, text: m.content }] : []),
      ];
    }
    return [];
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items, busy]);

  const add = (item: Item) => setItems(prev => [...prev, item]);

  // Messages typed while an answer is still being produced wait here and are sent in order
  const queue = useRef<QueuedMessage[]>([]);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const busyRef = useRef(false);
  const latestRun = useRef<(message: string) => Promise<void>>(async () => {});

  const setQueue = (next: QueuedMessage[]) => {
    queue.current = next;
    setQueued(next);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || !model || !country) return;
    setInput('');
    if (busyRef.current) {
      setQueue([...queue.current, { id: newId(), text: message }]);
      return;
    }
    await run(message);
  };

  const run = async (message: string) => {
    busyRef.current = true;
    setError(null);
    add({ id: newId(), kind: 'user', text: message });
    const userMessage: ChatMessage = { role: 'user', content: message };
    history.current = [...history.current, userMessage];
    persist([userMessage], message);

    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      await runAgent({
        chat: llm.chat,
        history: history.current,
        tools,
        callTool,
        signal: controller.signal,
        country,
        onMessage: (m) => {
          history.current = [...history.current, m];
          persist([m], message);
          if (m.role === 'assistant' && m.content) add({ id: newId(), kind: 'assistant', text: m.content });
        },
        onStep: (step) => add({ id: newId(), kind: 'step', step }),
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      abort.current = null;
      const [next, ...rest] = queue.current;
      if (next) {
        setQueue(rest);
        void latestRun.current(next.text);
      }
    }
  };
  latestRun.current = run;

  const reset = () => {
    setQueue([]);
    abort.current?.abort();
    history.current = [];
    conversationId.current = null;
    setItems([]);
    setError(null);
    setSaveError(null);
  };

  // A different account (or signing out) never continues the previous person's chat
  useEffect(() => {
    reset();
    setShowHistory(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    setHistoryError(null);
    try {
      setConversations((await listConversations()).conversations);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  const openConversation = async (id: string) => {
    try {
      const { conversation, messages } = await getConversation(id);
      setQueue([]);
      abort.current?.abort();
      const restored = messages.map(toChatMessage);
      history.current = restored;
      conversationId.current = conversation.id;
      setItems(itemsFromHistory(restored));
      setError(null);
      setSaveError(null);
      setShowHistory(false);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (conversationId.current === id) reset();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendLocation = () => {
    if (picked.lat === undefined || picked.lon === undefined) return;
    setShowMap(false);
    send(`My field is at ${picked.lat}, ${picked.lon}${picked.country ? ` (${picked.country})` : ''}`);
  };

  // Choosing a different country while a conversation is open starts a new one, so answers never mix countries
  const chooseCountry = (code: string) => {
    if (code === countryCode) return;
    if (countryCode && items.length > 0) reset();
    setCountryCode(code);
    write(COUNTRY_KEY, code);
    setPicked(p => ({ ...p, country: code || undefined }));
  };

  const noTools = tools.length === 0;
  const exampleGroups = country
    ? [...akilimoExamples(country), ...(hasContextTools(servers) ? [contextExamples(country)] : [])]
    : [];

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-header d-flex flex-wrap align-items-center gap-2 position-relative">
        <Bot size={16} className="text-akilimo" />
        <span className="small fw-semibold">AKILIMO assistant</span>
        <select className="form-select form-select-sm w-auto ms-auto" aria-label="Country" value={countryCode}
          onChange={e => chooseCountry(e.target.value)}>
          {!country && <option value="">Choose country…</option>}
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="form-select form-select-sm w-auto" aria-label="LLM provider" value={llm.provider}
          onChange={e => llm.setProvider(e.target.value as ProviderId)} disabled={busy}>
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select className="form-select form-select-sm w-auto" aria-label="Model" value={model} style={{ maxWidth: '14rem' }}
          onChange={e => llm.setModel(e.target.value)} disabled={llm.models.length === 0 || busy}>
          {llm.models.length === 0 && <option value="">{llm.loading ? 'Loading models…' : 'No model'}</option>}
          {llm.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="button" className={`btn btn-sm ${showSettings ? 'btn-secondary' : 'btn-outline-secondary'}`}
          onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings} title="Provider settings" aria-label="Provider settings">
          <Settings2 size={14} />
        </button>
        {user && (
          <button type="button" className={`btn btn-sm d-inline-flex align-items-center gap-1 ${showHistory ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={toggleHistory} aria-expanded={showHistory} disabled={busy} title="Your saved conversations">
            <History size={14} /> History
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
          onClick={reset} disabled={items.length === 0} title="Start a new conversation">
          <RotateCcw size={14} /> New
        </button>

        {showHistory && (
          <div className="dropdown-menu show end-0 top-100 me-2 shadow p-0" style={{ width: 'min(24rem, 90vw)', maxHeight: '22rem', overflowY: 'auto' }}>
            {historyError && <div className="alert alert-danger small m-2">{historyError}</div>}
            {!historyError && conversations.length === 0 && <div className="small text-body-secondary p-3">No saved conversations yet.</div>}
            {conversations.map(c => (
              <div key={c.id} className="d-flex align-items-center border-bottom">
                <button type="button" className="dropdown-item text-truncate py-2" onClick={() => openConversation(c.id)} title={c.title}>
                  <div className="text-truncate">{c.title}</div>
                  <div className="small text-body-secondary">{new Date(c.updated_at).toLocaleString()}</div>
                </button>
                <button type="button" className="btn btn-sm btn-link text-danger flex-shrink-0" aria-label={`Delete ${c.title}`}
                  onClick={() => removeConversation(c.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {showSettings && <LlmSettings llm={llm} />}

      <div className="card-body overflow-auto min-h-0 d-flex flex-column gap-3">
        {llm.error && <div className="alert alert-warning small mb-0">{llm.error}</div>}
        {noTools && !llm.error && (
          <div className="alert alert-info small mb-0">Connecting to the AKILIMO servers… switch one on in the MCP servers panel if this persists.</div>
        )}

        {items.length === 0 && !country && (
          <div className="m-auto text-center" style={{ maxWidth: '36rem' }}>
            <Bot size={40} className="text-akilimo mb-2" />
            <p className="mb-1">Where do you farm?</p>
            <p className="small text-body-secondary">Choose your country first. I will use it for prices, fertilizers and the examples I suggest.</p>
            <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
              {COUNTRIES.map(c => (
                <button key={c.code} type="button" className="btn btn-outline-success" onClick={() => chooseCountry(c.code)}>{c.name}</button>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && country && (
          <div className="m-auto text-center" style={{ maxWidth: '36rem' }}>
            <Bot size={40} className="text-akilimo mb-2" />
            <p className="mb-1">Ask about fertilizer for your cassava field in {country.name}.</p>
            <p className="small text-body-secondary">I will ask for the details I need, such as where the field is and when you plan to plant. Pick an example to start, or type your own question. You can change the country at the top.</p>
            <div className="text-start mt-3">
              {exampleGroups.map(group => (
                <div key={group.title} className="mb-3">
                  <div className="small fw-semibold text-body-secondary mb-1">{group.title}</div>
                  <div className="d-flex flex-column gap-2">
                    {group.prompts.map(p => (
                      <button key={p} type="button" className="btn btn-sm btn-outline-success text-start"
                        onClick={() => send(p)} disabled={!model || noTools}>{p}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.map(item => {
          if (item.kind === 'step') {
            const { step } = item;
            return (
              <details key={item.id} className="small text-body-secondary ms-5">
                <summary className={step.isError ? 'text-danger' : undefined}>
                  <Wrench size={12} className="me-1" />
                  {step.type === 'tool_call' ? 'Using' : step.isError ? 'Failed' : 'Got result from'} {step.tool}
                  <span className="badge text-bg-secondary ms-1">{step.server}</span>
                </summary>
                <pre className="event-payload p-2 bg-body-secondary rounded mt-1 mb-0">
                  {step.type === 'tool_call' ? JSON.stringify(step.args, null, 2) : step.result}
                </pre>
              </details>
            );
          }
          const mine = item.kind === 'user';
          return (
            <div key={item.id} className={`d-flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <div className={`avatar rounded-circle d-flex align-items-center justify-content-center ${mine ? 'bg-akilimo' : 'bg-secondary'}`}>
                {mine ? <User size={18} color="white" /> : <Bot size={18} color="white" />}
              </div>
              <div className={`chat-bubble px-3 py-2 rounded-3 ${mine ? 'bg-akilimo text-white' : 'bg-body-tertiary border'}`}>
                {mine ? item.text : <div className="markdown"><ReactMarkdown>{item.text}</ReactMarkdown></div>}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="d-flex gap-2 align-items-center text-body-secondary small">
            <Loader2 size={16} className="spin" /> Thinking…
          </div>
        )}
        {queued.map(q => (
          <div key={q.id} className="d-flex gap-2 flex-row-reverse align-items-center">
            <div className="avatar rounded-circle d-flex align-items-center justify-content-center bg-akilimo opacity-50">
              <User size={18} color="white" />
            </div>
            <div className="chat-bubble px-3 py-2 rounded-3 bg-akilimo text-white opacity-50">{q.text}</div>
            <span className="badge text-bg-secondary">Queued</span>
            <button type="button" className="btn btn-sm btn-link text-body-secondary p-0" aria-label="Remove queued message"
              title="Remove from the queue" onClick={() => setQueue(queue.current.filter(m => m.id !== q.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
        {error && <div className="alert alert-danger small mb-0">{error}</div>}
        {saveError && <div className="small text-warning-emphasis">{saveError}</div>}
        {accountsEnabled && !user && items.length > 0 && (
          <div className="small text-body-secondary text-center">Sign in to keep this conversation in your history.</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="card-footer">
        {showMap && (
          <div className="border rounded p-2 mb-2 bg-body">
            <div className="d-flex align-items-center mb-1">
              <span className="small fw-semibold">Where is the field?</span>
              <button type="button" className="btn btn-sm btn-link ms-auto p-0" onClick={() => setShowMap(false)} aria-label="Close map">
                <X size={16} />
              </button>
            </div>
            <MapPicker lat={picked.lat} lon={picked.lon} country={picked.country}
              onChange={(lat, lon) => setPicked(p => ({ ...p, lat, lon }))}
              onCountry={(country) => setPicked(p => ({ ...p, country }))} />
            <button type="button" className="btn btn-sm btn-akilimo mt-2" onClick={sendLocation}
              disabled={picked.lat === undefined}>
              Send this location
            </button>
          </div>
        )}
        <form className="input-group" onSubmit={e => { e.preventDefault(); send(input); }}>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setShowMap(v => !v)}
            title="Share the field location on a map" aria-label="Share field location" disabled={!country}>
            <MapPin size={16} />
          </button>
          <input className="form-control" placeholder={!country ? 'Choose your country first…' : model ? 'Type your question…' : 'Waiting for a model…'}
            value={input} onChange={e => setInput(e.target.value)} aria-label="Message" disabled={!model || !country} />
          {busy && (
            <button type="button" className="btn btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => abort.current?.abort()}
              title="Stop the current answer; queued messages are still sent">
              <Square size={14} /> Stop
            </button>
          )}
          <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-1" disabled={!input.trim() || !model || !country || noTools}
            title={busy ? 'Queue this message; it is sent when the current answer is done' : undefined}>
            <Send size={16} /> <span className="d-none d-sm-inline">{busy ? 'Queue' : 'Send'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
