import React, { useEffect, useRef, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, CalendarDays, Check, ChevronRight, Sparkles, Compass, History, Leaf, MessageSquare, Globe, Ruler, Shovel, Sprout, Store, Wheat, Loader2, MapPin, RotateCcw, Send, Settings2, Square, Trash2, User, Wrench, X } from 'lucide-react';
import {
  appendMessages, createConversation, deleteConversation, getConversation, listConversations,
  type ConversationSummary, type User as Account,
} from '../account/api';
import { fetchCapabilities, streamChat, type AgentStep, type ProviderId } from '../llm/api';
import type { ChatMessage } from '../llm/types';
import { adviceTypes, akilimoExamples, contextExamples, findCountry } from '@akilimo/shared';
import { useCountries } from '../mcp/countries';
import { useLlm } from '../llm/useLlm';
import { read, write } from '../mcp/keys';
import type { McpServerConfig } from '../mcp/servers';
import type { ServerState } from '../mcp/useMcpServers';
import { isGuidedEntry, type GuidedEntry } from '../mcp/guided';
import { ADVICE, ADVICE_ICONS, intercropCrop } from './AdviceScreens';
import { useCrops, savedCropKey, saveCropKey } from '../mcp/crops';
import { FertilizerPicker } from './FertilizerPicker';
import { FieldPicker, IntercropPicker, PracticesPicker, Shell } from './ChatPickers';
import { GuidedPanel } from './GuidedPanel';
import { WINDOWS, dateProblem, harvestRange, monthsFromNow, plantingMin, windowLabel } from './GuidedParts';
import { LlmSettings } from './LlmSettings';
import { MapPicker } from './MapPicker';

interface Props {
  configs: McpServerConfig[];
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  accountsEnabled: boolean;
  user: Account | null;
  // Saves the user's web search choice to their account (it then applies to every conversation)
  onWebSearchChange?: (on: boolean) => Promise<void>;
}

interface QueuedMessage { id: string; text: string }

type Item =
  | { id: string; kind: 'user' | 'assistant'; text: string }
  | { id: string; kind: 'step'; step: AgentStep };

const COUNTRY_KEY = 'chat-country';
const WEB_SEARCH_KEY = 'chat-web-search'; // the choice of a user without an account
const VIEW_KEY = 'chat-view';

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

export const ChatView: React.FC<Props> = ({ configs, servers, callTool, accountsEnabled, user, onWebSearchChange }) => {
  // The server's keys belong to the organisation, so with accounts enabled the chat needs a sign-in
  const canChat = !accountsEnabled || !!user;
  const llm = useLlm(canChat);
  const { model } = llm;
  const [showSettings, setShowSettings] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  // Guided mode (buttons and a form, answered by the AKILIMO tools directly) is the default and needs
  // no AI provider; "Ask AI" is the free-text chat
  const [view, setView] = useState<'guided' | 'ai'>(() => (read<string>(VIEW_KEY, 'guided') === 'ai' ? 'ai' : 'guided'));
  const chooseView = (next: 'guided' | 'ai') => {
    setView(next);
    setShowHistory(false);
    write(VIEW_KEY, next);
  };

  const [items, setItems] = useState<Item[]>([]);
  const history = useRef<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // The chat starts by asking where the user farms; the answer is remembered in this browser
  const [countryCode, setCountryCode] = useState<string>(() => read<string>(COUNTRY_KEY, ''));
  // The supported countries come from the Akilimo API (never from the code)
  const { countries, loading: countriesLoading, error: countriesError, reload: reloadCountries } = useCountries();
  const country = findCountry(countries, countryCode);
  // The crop selector: the list comes from the Akilimo API; a crop without recommendations only gets prices and information
  const crops = useCrops(countryCode || undefined);
  const [cropKey, setCropKey] = useState(savedCropKey);
  const crop = crops.find(c => c.key === cropKey) ?? crops[0];
  const adviceReady = crop?.advice_available !== false;
  const cropName = (crop?.name ?? 'cassava').toLowerCase();

  const [showMap, setShowMap] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [showFertilizers, setShowFertilizers] = useState(false);
  const [showAdvice, setShowAdvice] = useState(false);
  // Web search: only offered when the server has a search service, and always off until the user turns it on
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  // Signed in: the choice is part of the profile (saved to the account, so it follows the user to every
  // session and device). Without accounts there is no profile, so it is remembered in this browser instead.
  const [guestWebSearch, setGuestWebSearch] = useState<boolean>(() => read<boolean>(WEB_SEARCH_KEY, false) === true);
  const webSearch = user ? user.web_search : guestWebSearch;
  const toggleWebSearch = () => {
    if (user && onWebSearchChange) onWebSearchChange(!user.web_search).catch(e => setError(e instanceof Error ? e.message : String(e)));
    else { const next = !guestWebSearch; setGuestWebSearch(next); write(WEB_SEARCH_KEY, next); }
  };
  useEffect(() => {
    if (!canChat) { setWebSearchAvailable(false); return; }
    let live = true;
    fetchCapabilities().then(c => { if (live) { setWebSearchAvailable(c.webSearch.available); } }, () => { if (live) setWebSearchAvailable(false); });
    return () => { live = false; };
  }, [canChat]);
  const [picker, setPicker] = useState<'field' | 'practices' | 'intercrop' | null>(null);
  const [pickedInArea, setPickedInArea] = useState<boolean | null>(null); // is the picked spot inside the supported area
  const [dates, setDates] = useState({ planting: monthsFromNow(1), harvest: monthsFromNow(11), plantingWindow: 1, harvestWindow: 1 });
  const [picked, setPicked] = useState<{ lat?: number; lon?: number; country?: string }>(() => ({ country: countryCode || undefined }));

  // Saved conversation of a signed-in user; writes are chained so messages keep their order
  const conversationId = useRef<string | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

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

  // Guided mode keeps its own saved conversation: every finished step (a price, the fertilizer list, a
  // recommendation) is one message, with the request and result in `data`, so a session can be shown again
  const guidedConversationId = useRef<string | null>(null);
  const guidedChain = useRef<Promise<void>>(Promise.resolve());
  const [replay, setReplay] = useState<GuidedEntry[] | null>(null);

  const recordGuided = (entry: GuidedEntry) => {
    if (!user) return;
    guidedChain.current = guidedChain.current
      .then(async () => {
        if (!guidedConversationId.current) {
          guidedConversationId.current = (await createConversation(entry.title.slice(0, 80), undefined, 'guided')).id;
        }
        await appendMessages(guidedConversationId.current, [{ role: 'tool', content: entry.title, tool_name: entry.tool, data: entry }]);
        setSaveError(null);
      })
      .catch(e => setSaveError(`Not saved: ${e instanceof Error ? e.message : String(e)}`));
  };

  // The next step starts a new saved session
  const resetGuided = () => {
    guidedConversationId.current = null;
    setReplay(null);
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
    if (!message || !model || !country || !canChat) return;
    setInput('');
    if (busyRef.current) {
      setQueue([...queue.current, { id: newId(), text: message }]);
      return;
    }
    await run(message);
  };

  // retry: ask again for the answer to the last user message that failed, without repeating the message;
  // whatever the failed attempt added after it (half a tool exchange, for one) is dropped first so the
  // history stays valid for every provider
  const run = async (text: string, retry = false) => {
    let message = text;
    busyRef.current = true;
    setError(null);
    setNotices([]);
    if (retry) {
      const lastUser = history.current.map(m => m.role).lastIndexOf('user');
      if (lastUser < 0) { busyRef.current = false; return; }
      message = history.current[lastUser].content;
      history.current = history.current.slice(0, lastUser + 1);
    } else {
      add({ id: newId(), kind: 'user', text: message });
      const userMessage: ChatMessage = { role: 'user', content: message };
      history.current = [...history.current, userMessage];
      persist([userMessage], message);
    }

    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      // The server calls the model and the MCP tools; each message comes back as it is produced
      await streamChat({
        provider: llm.provider as ProviderId,
        model,
        country: country?.code,
        webSearch,
        ...(crop ? { crop: { key: crop.key, name: crop.name, advice_available: crop.advice_available } } : {}),
        messages: history.current,
        signal: controller.signal,
        onWarning: (text) => setNotices(prev => [...prev, text]),
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
    resetGuided();
    setShowHistory(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list shows the conversations of the mode that is on screen
  const toggleHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    setHistoryError(null);
    try {
      setConversations((await listConversations(view)).conversations);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  const openConversation = async (id: string) => {
    try {
      const { conversation, messages } = await getConversation(id);
      if (conversation.mode === 'guided') {
        // Show the saved steps; new steps are added to the same session
        const entries = messages.map(m => m.data).filter(isGuidedEntry);
        guidedConversationId.current = conversation.id;
        setReplay(entries);
        const saved = entries[0]?.country;
        if (saved) {
          setCountryCode(saved);
          write(COUNTRY_KEY, saved);
          setPicked(p => ({ ...p, country: saved }));
        }
        setSaveError(null);
        setShowHistory(false);
        return;
      }
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
      if (guidedConversationId.current === id) resetGuided();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  // Planting and harvest dates picked on a calendar, sent as one message the assistant can read exactly
  const harvestLimits = harvestRange(dates.planting);
  const datesProblem = dateProblem(dates.planting, dates.harvest);

  const sendDates = () => {
    if (datesProblem) return;
    setShowDates(false);
    const shift = (what: string, months: number) => (months === 0 ? `${what} cannot shift` : `${what} can shift by up to ${months} month${months > 1 ? 's' : ''}`);
    send(`I plan to plant on ${dates.planting} and harvest on ${dates.harvest}. Planting window: ${dates.plantingWindow}, harvest window: ${dates.harvestWindow} (${shift('planting', dates.plantingWindow)}, ${shift('harvest', dates.harvestWindow)}).`);
  };

  // What the farmer has already sent through the forms, read back from the conversation so it also works
  // for a conversation opened from the history; the chips reopen the matching form
  const sentTexts = items.flatMap(i => (i.kind === 'user' ? [i.text] : []));
  const sentBefore = (re: RegExp) => sentTexts.some(t => re.test(t));
  const DETAIL_ICONS: Record<string, React.ReactNode> = {
    location: <MapPin size={13} />, field: <Ruler size={13} />, dates: <CalendarDays size={13} />,
    fertilizers: <Leaf size={13} />, practices: <Shovel size={13} />, intercrop: <Wheat size={13} />,
  };
  const ADVICE_ICON_SM: Record<string, React.ReactNode> = {
    fertilizer: <Sprout size={13} />, practices: <Shovel size={13} />, schedule: <CalendarDays size={13} />, intercrop: <Wheat size={13} />, market: <Store size={13} />,
  };
  const CHIP_HINTS: Record<string, string> = {
    location: 'Pick your field on the map',
    field: 'Field size, current yield, cassava price, budget and risk attitude',
    dates: 'Planting and harvest dates',
    fertilizers: 'The fertilizers you can buy and their prices',
    practices: 'What you do now (ploughing, harrowing, ridging) and the costs',
    intercrop: 'How you sell the second crop grown between the cassava, and its price',
  };
  const detailChips = [
    { id: 'location', label: 'Location', done: sentBefore(/^My field is at /) },
    { id: 'field', label: 'Field', done: sentBefore(/^My field is \d/), picker: 'field' as const },
    { id: 'dates', label: 'Dates', done: sentBefore(/^I plan to plant on /) },
    { id: 'fertilizers', label: 'Fertilizers', done: sentBefore(/^These are the fertilizers I can buy/) },
    { id: 'practices', label: 'Practices', done: sentBefore(/^On this field I do now/), picker: 'practices' as const },
    ...(country && intercropCrop(country.code) ? [{ id: 'intercrop', label: intercropCrop(country.code)!.crop === 'maize' ? 'Maize' : 'Sweet potato', done: sentBefore(/^For intercropping I grow /), picker: 'intercrop' as const }] : []),
  ] as { id: string; label: string; done: boolean; picker?: 'field' | 'practices' | 'intercrop' }[];
  const sendLocation = () => {
    if (picked.lat === undefined || picked.lon === undefined) return;
    setShowMap(false);
    send(`My field is at ${picked.lat}, ${picked.lon}${picked.country ? ` (${picked.country})` : ''}`);
  };

  // Choosing a different country while a conversation is open starts a new one, so answers never mix countries
  const chooseCountry = (code: string) => {
    if (code === countryCode) return;
    if (countryCode && items.length > 0) reset();
    resetGuided();
    setCountryCode(code);
    write(COUNTRY_KEY, code);
    setPicked(p => ({ ...p, country: code || undefined }));
  };

  const exampleGroups = country
    ? [...akilimoExamples(country, cropName, countries).filter(g => adviceReady || g.title === 'Fertilizers and prices'), ...(hasContextTools(servers) ? [contextExamples(country, countries)] : [])]
    : [];

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-header d-flex flex-wrap align-items-center gap-2 position-relative">
        <Bot size={16} className="text-akilimo" />
        <span className="small fw-semibold">AKILIMO assistant</span>
        <div className="btn-group btn-group-sm ms-2" role="group" aria-label="Mode">
          <button type="button" className={`btn d-inline-flex align-items-center gap-1 ${view === 'guided' ? 'btn-akilimo' : 'btn-outline-secondary'}`}
            aria-pressed={view === 'guided'} onClick={() => chooseView('guided')} title="Answers from AKILIMO with buttons and a form; no AI needed">
            <Compass size={14} /> Guided
          </button>
          <button type="button" className={`btn d-inline-flex align-items-center gap-1 ${view === 'ai' ? 'btn-akilimo' : 'btn-outline-secondary'}`}
            aria-pressed={view === 'ai'} onClick={() => chooseView('ai')} title="Ask in your own words; needs an AI provider">
            <MessageSquare size={14} /> Ask AI
          </button>
        </div>
        <select className="form-select form-select-sm w-auto ms-auto" aria-label="Country" title="Your country: prices, fertilizers and advice are for this country" value={countryCode}
          onChange={e => chooseCountry(e.target.value)}>
          {!country && <option value="">Choose country…</option>}
          {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="form-select form-select-sm w-auto" aria-label="Crop" value={crop?.key ?? ''} disabled={busy}
          title={crop?.advice_available === false ? `${crop.name}: prices and information only, recommendations are not available yet` : 'The crop you want advice on'}
          onChange={e => { setCropKey(e.target.value); saveCropKey(e.target.value); }}>
          {crops.map(c => <option key={c.key} value={c.key}>{c.name}{c.advice_available ? '' : ' (no advice yet)'}</option>)}
        </select>
        {view === 'ai' && (
          <>
            <select className="form-select form-select-sm w-auto" aria-label="LLM provider" title="The AI provider that answers in Ask AI" value={llm.provider}
              onChange={e => llm.setProvider(e.target.value as ProviderId)} disabled={busy || llm.providers.length === 0}>
              {llm.providers.length === 0 && <option value="">No provider</option>}
              {llm.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select className="form-select form-select-sm w-auto" aria-label="Model" title="The AI model; it must support tool calling" value={model} style={{ maxWidth: '14rem' }}
              onChange={e => llm.setModel(e.target.value)} disabled={llm.models.length === 0 || busy}>
              {llm.models.length === 0 && <option value="">{llm.loading ? 'Loading models…' : 'No model'}</option>}
              {llm.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" className={`btn btn-sm ${showSettings ? 'btn-secondary' : 'btn-outline-secondary'}`}
              onClick={() => setShowSettings(v => !v)} aria-expanded={showSettings} title="Provider settings" aria-label="Provider settings">
              <Settings2 size={14} />
            </button>
          </>
        )}
        {user && (
          <button type="button" className={`btn btn-sm d-inline-flex align-items-center gap-1 ${showHistory ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={toggleHistory} aria-expanded={showHistory} disabled={view === 'ai' && busy}
            title={view === 'guided' ? 'Your saved guided sessions' : 'Your saved conversations'}>
            <History size={14} /> History
          </button>
        )}
        {view === 'ai' ? (
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            onClick={reset} disabled={items.length === 0} title="Start a new conversation">
            <RotateCcw size={14} /> New
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            onClick={resetGuided} title="Start a new guided session (the next step is saved as a new session)">
            <RotateCcw size={14} /> New
          </button>
        )}

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
                <button type="button" className="btn btn-sm btn-link text-danger flex-shrink-0" aria-label={`Delete ${c.title}`} title="Delete this saved conversation"
                  onClick={() => removeConversation(c.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {view === 'guided' ? <GuidedPanel country={country} crop={crop} servers={servers} callTool={callTool} onRecord={recordGuided} replay={replay} onLeaveReplay={() => setReplay(null)} /> : (
      <>
      {showSettings && <LlmSettings llm={llm} />}

      <div className="card-body overflow-auto min-h-0 d-flex flex-column gap-3">
        {!canChat && <div className="alert alert-info small mb-0">Sign in to chat with the AKILIMO assistant.</div>}
        {canChat && llm.error && <div className="alert alert-warning small mb-0">{llm.error}</div>}
        {canChat && !llm.error && !llm.loading && llm.providers.length === 0 && (
          <div className="alert alert-info small mb-0">No AI provider is set up yet. An administrator can add one under Manage, AI providers.</div>
        )}
        {notices.map(text => <div key={text} className="alert alert-warning small mb-0 py-1">{text}</div>)}

        {items.length === 0 && !country && (
          <div className="m-auto text-center" style={{ maxWidth: '36rem' }}>
            <Bot size={40} className="text-akilimo mb-2" />
            <p className="mb-1">Where do you farm?</p>
            <p className="small text-body-secondary">Choose your country first. I will use it for prices, fertilizers and the examples I suggest.</p>
            <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
              {countriesLoading && <span className="small text-body-secondary">Loading countries…</span>}
              {countriesError && (
                <div className="alert alert-warning small mb-0">
                  {countriesError} <button type="button" className="btn btn-sm btn-outline-secondary ms-2" onClick={reloadCountries} title="Try loading the countries again">Retry</button>
                </div>
              )}
              {countries.map(c => (
                <button key={c.code} type="button" className="btn btn-outline-success" onClick={() => chooseCountry(c.code)} title={`Use ${c.name}`}>{c.name}</button>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && country && (
          <div className="m-auto text-center" style={{ maxWidth: '36rem' }}>
            <Bot size={40} className="text-akilimo mb-2" />
            <p className="mb-1">{adviceReady ? `Ask about fertilizer for your ${cropName} field in ${country.name}.` : `Ask about ${cropName} prices and information in ${country.name}.`}</p>
            <p className="small text-body-secondary">I will ask for the details I need, such as where the field is and when you plan to plant. Pick an example to start, or type your own question. You can change the country at the top.</p>
            <div className="text-start mt-3">
              {!adviceReady && <div className="alert alert-info small">Recommendations for {crop?.name} are not available yet; you can still ask about prices and reference data.</div>}
              {adviceReady && <div className="small fw-semibold text-body-secondary mb-1">What would you like advice on?</div>}
              <div className="d-flex flex-column gap-2 mb-3">
                {adviceReady && adviceTypes(country, cropName).map(a => (
                  <button key={a.id} type="button" className="btn btn-outline-success text-start d-flex align-items-center gap-3 p-2" onClick={() => send(a.prompt)} disabled={!model || !canChat} title={a.prompt}>
                    <span className="flex-shrink-0">{a.id === 'fertilizer' ? <Sprout size={22} /> : a.id === 'market' ? <Store size={22} /> : ADVICE_ICONS[a.id]}</span>
                    <span className="flex-grow-1">
                      <span className="d-block fw-semibold">{a.id === 'fertilizer' ? 'Fertilizer recommendation' : a.id === 'market' ? 'Where to sell' : ADVICE[a.id].title}</span>
                      <span className="d-block small text-body-secondary">{a.id === 'fertilizer' ? `Which fertilizer to use in ${country.name}, and how much.` : a.id === 'market' ? `The open market or a starch factory in ${country.name}: where cassava sells best.` : ADVICE[a.id].text}</span>
                    </span>
                    <ChevronRight size={18} className="flex-shrink-0" />
                  </button>
                ))}
              </div>
              {exampleGroups.map(group => (
                <div key={group.title} className="mb-3">
                  <div className="small fw-semibold text-body-secondary mb-1">{group.title}</div>
                  <div className="d-flex flex-column gap-2">
                    {group.prompts.map(p => (
                      <button key={p} type="button" className="btn btn-sm btn-outline-success text-start"
                        onClick={() => send(p)} disabled={!model || !canChat}>{p}</button>
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
                {mine ? item.text : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children }) => <div className="table-responsive"><table className="table table-sm table-striped">{children}</table></div> }}>{item.text}</ReactMarkdown></div>}
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
        {error && (
          <div className="alert alert-danger small mb-0 d-flex align-items-center gap-2">
            <span className="flex-grow-1">{error}</span>
            <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" disabled={busy} title="Ask for the answer again" onClick={() => void run('', true)}>Try again</button>
          </div>
        )}
        {saveError && <div className="small text-warning-emphasis">{saveError}</div>}
        {accountsEnabled && !user && items.length > 0 && (
          <div className="small text-body-secondary text-center">Sign in to keep this conversation in your history.</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="card-footer">
        {showMap && (
          <Shell title="Where is the field?" onClose={() => setShowMap(false)}>
            <MapPicker lat={picked.lat} lon={picked.lon} country={picked.country}
              onChange={(lat, lon) => setPicked(p => ({ ...p, lat, lon }))}
              onCountry={(country) => setPicked(p => ({ ...p, country }))}
              onCoverage={setPickedInArea} />
            <button type="button" className="btn btn-sm btn-akilimo mt-2" onClick={sendLocation}
              disabled={picked.lat === undefined || pickedInArea === false}
              title={pickedInArea === false ? 'This spot is outside the supported area' : 'Send this spot to the assistant'}>
              Send this location
            </button>
          </Shell>
        )}
        {country && canChat && (
          <div className="d-flex flex-wrap align-items-center gap-1 mb-2">
            <span className="small text-body-secondary me-1">Details:</span>
            {detailChips.map(c => (
              <button key={c.id} type="button" className={`btn btn-sm py-0 d-inline-flex align-items-center gap-1 ${c.done ? 'btn-success' : 'btn-outline-secondary'}`} title={`${CHIP_HINTS[c.id] ?? c.label}${c.done ? " (sent; click to change it)" : ""}`}
                onClick={() => { setShowMap(c.id === 'location' ? !showMap : false); setShowDates(c.id === 'dates' ? !showDates : false); setShowFertilizers(c.id === 'fertilizers' ? !showFertilizers : false); setPicker(c.picker ? (picker === c.picker ? null : c.picker) : null); }}>
                {DETAIL_ICONS[c.id]}{c.label}{c.done && <Check size={13} />}
              </button>
            ))}
          </div>
        )}
        {showDates && (
          <Shell title="When will you plant and harvest?" onClose={() => setShowDates(false)}>
            <div className="row g-2">
              <div className="col-sm-6">
                <label className="form-label small mb-1" htmlFor="chat-plant">Planting date</label>
                <input id="chat-plant" type="date" className="form-control form-control-sm" value={dates.planting} min={plantingMin()}
                  onChange={e => setDates(d => ({ ...d, planting: e.target.value }))} />
              </div>
              <div className="col-sm-6">
                <label className="form-label small mb-1" htmlFor="chat-harvest">Harvest date</label>
                <input id="chat-harvest" type="date" className="form-control form-control-sm" value={dates.harvest}
                  min={harvestLimits.min} max={harvestLimits.max}
                  onChange={e => setDates(d => ({ ...d, harvest: e.target.value }))} />
              </div>
              <div className="col-sm-6">
                <label className="form-label small mb-1" htmlFor="chat-plant-window">Planting can shift by up to</label>
                <select id="chat-plant-window" className="form-select form-select-sm" value={dates.plantingWindow}
                  onChange={e => setDates(d => ({ ...d, plantingWindow: Number(e.target.value) }))}>
                  {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                </select>
              </div>
              <div className="col-sm-6">
                <label className="form-label small mb-1" htmlFor="chat-harvest-window">Harvest can shift by up to</label>
                <select id="chat-harvest-window" className="form-select form-select-sm" value={dates.harvestWindow}
                  onChange={e => setDates(d => ({ ...d, harvestWindow: Number(e.target.value) }))}>
                  {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-text">Planting up to 6 months back; harvest 8 to 12 months after planting (cassava is usually harvested 10 to 12).</div>
            <div className="d-flex align-items-center gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-akilimo" onClick={sendDates} disabled={!!datesProblem} title={datesProblem ?? 'Send these dates to the assistant'}>Send these dates</button>
              {datesProblem && <span className="small text-body-secondary">{datesProblem}</span>}
            </div>
          </Shell>
        )}
        {picker && country && (() => {
          const props = { country, servers, callTool, onClose: () => setPicker(null), onSend: (text: string) => { setPicker(null); send(text); } };
          return picker === 'field' ? <FieldPicker {...props} /> : picker === 'practices' ? <PracticesPicker {...props} /> : <IntercropPicker {...props} />;
        })()}
        {showFertilizers && country && (
          <FertilizerPicker country={country} servers={servers} callTool={callTool} onClose={() => setShowFertilizers(false)}
            onSend={text => { setShowFertilizers(false); send(text); }} />
        )}
        {showAdvice && country && (
          <>
            <div className="position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1040 }} onClick={() => setShowAdvice(false)} />
            <div className="dropdown-menu show shadow" style={{ position: 'absolute', bottom: '3.75rem', left: '0.75rem', zIndex: 1050, maxWidth: 'calc(100% - 1.5rem)' }}>
              {adviceTypes(country, cropName).map(a => (
                <button key={a.id} type="button" className="dropdown-item d-flex align-items-center gap-2 py-2" disabled={!model}
                  onClick={() => { setShowAdvice(false); send(a.prompt); }} title={a.prompt}>
                  {ADVICE_ICON_SM[a.id]}{a.label}
                </button>
              ))}
            </div>
          </>
        )}
        {view === 'ai' && webSearch && (
          <div className="small text-success-emphasis d-flex align-items-center gap-1 mb-2">
            <Globe size={13} /> Web search is on. Parts of what you ask can be sent to a search service. Turn it off with the globe button.
          </div>
        )}
        <form className="input-group" onSubmit={e => { e.preventDefault(); send(input); }}>
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowAdvice(v => !v); setShowMap(false); setShowDates(false); setShowFertilizers(false); setPicker(null); }}
            title="Get advice: fertilizer, planting practices, dates, intercropping" aria-label="Get advice" aria-expanded={showAdvice} disabled={!country || !canChat || !adviceReady}>
            <Sparkles size={16} />
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowMap(v => !v); setShowDates(false); setShowFertilizers(false); setPicker(null); }}
            title="Share the field location on a map" aria-label="Share field location" disabled={!country}>
            <MapPin size={16} />
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowDates(v => !v); setShowMap(false); setShowFertilizers(false); setPicker(null); }}
            title="Choose the planting and harvest dates" aria-label="Choose planting and harvest dates" disabled={!country}>
            <CalendarDays size={16} />
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowFertilizers(v => !v); setShowMap(false); setShowDates(false); setPicker(null); }}
            title="Choose the fertilizers you can buy and their prices" aria-label="Choose fertilizers and prices" disabled={!country}>
            <Leaf size={16} />
          </button>
          {view === 'ai' && webSearchAvailable && (
            <button type="button" className={`btn ${webSearch ? 'btn-success' : 'btn-outline-secondary'}`} aria-pressed={webSearch} onClick={toggleWebSearch} disabled={busy}
              title={webSearch ? "Web search is on: what you ask can be sent to a search service. Click to turn it off" : "Web search is off. Click to let the assistant search the internet"}
              aria-label="Search the web">
              <Globe size={16} />
            </button>
          )}
          <input className="form-control" placeholder={!canChat ? 'Sign in to chat…' : !country ? 'Choose your country first…' : model ? 'Type your question…' : 'Waiting for a model…'}
            value={input} onChange={e => setInput(e.target.value)} aria-label="Message" disabled={!model || !country || !canChat} />
          {busy && (
            <button type="button" className="btn btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => abort.current?.abort()}
              title="Stop the current answer; queued messages are still sent">
              <Square size={14} /> Stop
            </button>
          )}
          <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-1" disabled={!input.trim() || !model || !country || !canChat}
            title={busy ? 'Queue this message; it is sent when the current answer is done' : 'Send your message'}>
            <Send size={16} /> <span className="d-none d-sm-inline">{busy ? 'Queue' : 'Send'}</span>
          </button>
        </form>
      </div>
      </>
      )}
    </div>
  );
};
