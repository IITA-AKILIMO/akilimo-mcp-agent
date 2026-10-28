import React, { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Link2, Loader2, Plug, Save, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import {
  deleteServerKey, fetchModels, fetchProviders, getServerKeys, setServerKey, testProvider, updateProvider,
  type LlmTest, type ProviderChange, type ProviderId, type ProviderStatus,
} from '../llm/api';
import { listServers, needsKey, type McpServerConfig } from '../mcp/servers';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// What each provider is, and a brand-ish colour for its badge
const META: Record<ProviderId, { tagline: string; color: string }> = {
  ollama: { tagline: 'Open models on your own hardware; no key needed', color: '#475569' },
  'ollama-cloud': { tagline: 'Large open models hosted by Ollama; needs an API key', color: '#0f172a' },
  openai: { tagline: 'GPT models', color: '#10a37f' },
  anthropic: { tagline: 'Claude models', color: '#d97757' },
  gemini: { tagline: 'Google Gemini models', color: '#4285f4' },
  deepseek: { tagline: 'DeepSeek chat models', color: '#4d6bfe' },
  groq: { tagline: 'Fast hosted open models', color: '#f55036' },
  mistral: { tagline: 'Mistral models', color: '#fa520f' },
  openrouter: { tagline: 'One key for many hosted models', color: '#6467f2' },
  opencode: { tagline: 'GLM, Kimi, Qwen, DeepSeek and more through one OpenCode key', color: '#211e1e' },
  custom: { tagline: 'Any OpenAI-compatible server (LM Studio, vLLM, llama.cpp, ...)', color: '#6c757d' },
};

const initials = (label: string) => label.replace(/\(.*\)/, '').trim().slice(0, 2).toUpperCase();

type TestState = { running: true } | { running: false; result: LlmTest } | null;

const StatusPill: React.FC<{ provider: ProviderStatus }> = ({ provider: p }) => {
  if (!p.configured) return <span className="badge rounded-pill text-bg-warning">Needs setup</span>;
  if (!p.enabled) return <span className="badge rounded-pill text-bg-secondary">Off</span>;
  return <span className="badge rounded-pill text-bg-success">Ready</span>;
};

const TestOutcome: React.FC<{ state: TestState }> = ({ state }) => {
  if (!state) return null;
  // `in` narrows without strictNullChecks, which this project's tsconfig leaves off
  if (!('result' in state)) {
    return <div className="small text-body-secondary d-flex align-items-center gap-1"><Loader2 size={14} className="spin" /> Testing…</div>;
  }
  const r = state.result;
  if (!r.ok) {
    return <div className="small text-danger d-flex align-items-start gap-1"><XCircle size={14} className="flex-shrink-0 mt-1" /> <span>{r.error}</span></div>;
  }
  return (
    <div className="small d-flex flex-column gap-1">
      <div className="text-success-emphasis d-flex align-items-start gap-1">
        <CheckCircle2 size={14} className="flex-shrink-0 mt-1 text-success" />
        <span>Connected in {r.ms} ms · {r.models} model{r.models === 1 ? '' : 's'}{r.model ? ` · ${r.model} answered` : ''}</span>
      </div>
      {r.model && r.toolCall && <div className="text-success-emphasis ms-3">Tool calling works</div>}
      {r.model && !r.toolCall && (
        <div className="text-warning-emphasis d-flex align-items-start gap-1">
          <TriangleAlert size={14} className="flex-shrink-0 mt-1" />
          <span>{r.model} did not call the test tool, so it may not use the AKILIMO tools reliably. Try another model.</span>
        </div>
      )}
    </div>
  );
};

// One provider card: its saved key (only the last characters are known here), address, on/off switch
// and a connection test. A key typed here is sent once and stored encrypted; it is never shown again.
const ProviderCard: React.FC<{ provider: ProviderStatus; onSaved: (providers: ProviderStatus[]) => void }> = ({ provider: p, onSaved }) => {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>(null);
  const meta = META[p.id];

  const save = async (change: ProviderChange, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      onSaved((await updateProvider(p.id, change)).providers);
      setTest(null); // the result described the previous settings
      after?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  // Lists the models (reachability and key), then sends the default model one tiny tool-calling request
  const runTest = async () => {
    setTest({ running: true });
    try {
      const { default: model } = await fetchModels(p.id);
      setTest({ running: false, result: await testProvider(p.id, model ?? '') });
    } catch (e) {
      setTest({ running: false, result: { ok: false, ms: 0, error: message(e) } });
    }
  };

  return (
    <div className={`card shadow-sm ${p.enabled ? '' : 'opacity-75'}`}>
      <div className="card-body">
        <div className="d-flex align-items-center gap-3">
          <div className="provider-badge rounded-3 d-flex align-items-center justify-content-center text-white fw-semibold flex-shrink-0"
            style={{ background: meta.color }} aria-hidden="true">{initials(p.label)}</div>
          <div className="flex-grow-1 min-w-0">
            <div className="fw-semibold d-flex align-items-center gap-2 flex-wrap">{p.label} <StatusPill provider={p} /></div>
            <div className="small text-body-secondary text-truncate">{meta.tagline}</div>
          </div>
          <div className="form-check form-switch mb-0" title={p.enabled ? 'Offered to users' : 'Hidden from users'}>
            <input className="form-check-input" type="checkbox" role="switch" aria-label={`${p.label} enabled`} checked={p.enabled}
              disabled={busy} onChange={e => save({ enabled: e.target.checked })} />
          </div>
        </div>

        {(p.key !== 'none' || p.editableBase) && (
          <div className="row g-3 mt-0">
            {p.key !== 'none' && (
              <div className="col-12">
                <label className="form-label small fw-semibold mb-1 d-flex align-items-center gap-1" htmlFor={`key-${p.id}`}>
                  <KeyRound size={14} /> API key{p.key === 'optional' && <span className="text-body-secondary fw-normal">(optional)</span>}
                  {p.keyUrl && (
                    <a className="ms-auto fw-normal d-inline-flex align-items-center gap-1" href={p.keyUrl} target="_blank" rel="noreferrer">
                      Get a key <ExternalLink size={12} />
                    </a>
                  )}
                </label>
                <div className="input-group input-group-sm">
                  <input id={`key-${p.id}`} type="password" className="form-control" autoComplete="off" value={key}
                    placeholder={p.keyHint ? `Saved (${p.keyHint}) · type to replace` : 'Paste the key'} onChange={e => setKey(e.target.value.trim())} />
                  <button type="button" className="btn btn-outline-success d-inline-flex align-items-center gap-1" disabled={busy || !key}
                    onClick={() => save({ apiKey: key }, () => setKey(''))}>
                    <Save size={14} /> Save
                  </button>
                  {p.keyHint && (
                    <button type="button" className="btn btn-outline-danger" disabled={busy} title="Remove the saved key" aria-label="Remove the saved key"
                      onClick={() => save({ clearKey: true })}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
            {p.editableBase && (
              <div className="col-12">
                <label className="form-label small fw-semibold mb-1 d-flex align-items-center gap-1" htmlFor={`url-${p.id}`}>
                  <Link2 size={14} /> Server address
                </label>
                <div className="input-group input-group-sm">
                  <input id={`url-${p.id}`} className="form-control font-monospace" value={baseUrl} spellCheck={false}
                    placeholder={p.id === 'ollama' ? 'http://host.docker.internal:11434' : 'http://localhost:1234/v1'} onChange={e => setBaseUrl(e.target.value.trim())} />
                  <button type="button" className="btn btn-outline-success d-inline-flex align-items-center gap-1" disabled={busy || baseUrl === (p.baseUrl ?? '')}
                    onClick={() => save({ baseUrl })}>
                    <Save size={14} /> Save
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && <div className="small text-danger mt-2">{error}</div>}
      </div>

      <div className="card-footer bg-transparent d-flex flex-column gap-2">
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={runTest}
            disabled={busy || !p.configured || !p.enabled || (test !== null && 'running' in test && test.running)}
            title={!p.configured ? 'Finish the setup first' : !p.enabled ? 'Turn the provider on to test it' : 'Check the connection and that the default model can call tools'}>
            <Plug size={14} /> Test connection
          </button>
          {!p.configured && <span className="small text-body-secondary">{p.key === 'required' ? 'Add an API key to use this provider' : 'Add the server address to use this provider'}</span>}
        </div>
        <TestOutcome state={test} />
      </div>
    </div>
  );
};

// Keys the server uses when it calls MCP servers that need one (e.g. Akilimo 2.0), stored encrypted
const ServerKeys: React.FC = () => {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setServers((await listServers()).servers.filter(needsKey));
        setHints((await getServerKeys()).keys);
      } catch (e) {
        setError(message(e));
      }
    })();
  }, []);

  const act = async (id: string, run: () => Promise<{ keys: Record<string, string> }>) => {
    try {
      setHints((await run()).keys);
      setDrafts(prev => ({ ...prev, [id]: '' }));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  if (servers.length === 0 && !error) return null;
  return (
    <section className="mt-4">
      <h3 className="h6 mb-1">Keys for MCP servers</h3>
      <p className="small text-body-secondary">The chat runs its tool calls on the server, so servers that need a key use the one saved here (stored encrypted, shared by all users).</p>
      {error && <div className="alert alert-danger small">{error}</div>}
      <div className="d-flex flex-column gap-3">
        {servers.map(s => (
          <div key={s.id} className="card shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center gap-2 mb-2">
                <div className="fw-semibold">{s.label}</div>
                <span className="font-monospace small text-body-secondary">{s.id}</span>
                <span className={`badge rounded-pill ms-auto ${hints[s.id] ? 'text-bg-success' : 'text-bg-warning'}`}>{hints[s.id] ? 'Key saved' : 'No key'}</span>
              </div>
              <div className="input-group input-group-sm">
                <input type="password" className="form-control" autoComplete="off" aria-label={`${s.label} key`} value={drafts[s.id] ?? ''}
                  placeholder={hints[s.id] ? `Saved (${hints[s.id]}) · type to replace` : 'Paste the key'}
                  onChange={e => setDrafts(prev => ({ ...prev, [s.id]: e.target.value.trim() }))} />
                <button type="button" className="btn btn-outline-success d-inline-flex align-items-center gap-1" disabled={!drafts[s.id]}
                  onClick={() => act(s.id, () => setServerKey(s.id, drafts[s.id]!))}>
                  <Save size={14} /> Save
                </button>
                {hints[s.id] && (
                  <button type="button" className="btn btn-outline-danger" title="Remove the saved key" aria-label="Remove the saved key"
                    onClick={() => act(s.id, () => deleteServerKey(s.id))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export const ProvidersTab: React.FC = () => {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { providers: list } = await fetchProviders();
        setProviders(list.filter((p): p is ProviderStatus => 'configured' in p));
      } catch (e) {
        setError(`Cannot load providers: ${message(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ready = providers.filter(p => p.configured && p.enabled).length;

  return (
    <>
      <div className="d-flex align-items-start gap-3 mb-3">
        <p className="small text-body-secondary mb-0 flex-grow-1">
          The chat calls these providers from the server, so users never handle keys. Keys are encrypted before they are stored and cannot be read back.
        </p>
        {providers.length > 0 && <span className="badge rounded-pill text-bg-light border flex-shrink-0">{ready} of {providers.length} ready</span>}
      </div>
      {loading && <div className="small text-body-secondary d-flex align-items-center gap-1"><Loader2 size={14} className="spin" /> Loading…</div>}
      {error && <div className="alert alert-danger small">{error}</div>}
      <div className="d-flex flex-column gap-3">
        {providers.map(p => <ProviderCard key={p.id} provider={p} onSaved={setProviders} />)}
      </div>
      <ServerKeys />
    </>
  );
};
