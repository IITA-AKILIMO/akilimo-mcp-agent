import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, Plug, RefreshCw, Square, TriangleAlert, XCircle } from 'lucide-react';
import { pullModel, type PullProgress } from '../llm/ollama';
import type { useLlm } from '../llm/useLlm';

interface Props {
  llm: ReturnType<typeof useLlm>;
}

// Models known to call tools reliably; anything from https://ollama.com/library can be typed in
const SUGGESTED_OLLAMA_MODELS = ['qwen3:8b', 'qwen3:4b', 'qwen3:14b', 'llama3.1:8b', 'qwen2.5:7b', 'mistral-nemo', 'llama3.2:3b'];

const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

const TestResult: React.FC<{ llm: Props['llm'] }> = ({ llm }) => {
  const { test } = llm;
  if (!test) return null;
  // `in` narrows without strictNullChecks, which this project's tsconfig leaves off
  if (!('result' in test)) {
    return <div className="d-flex align-items-center gap-1 text-body-secondary"><Loader2 size={14} className="spin" /> Testing{llm.model ? ` ${llm.model}` : ''}…</div>;
  }
  const r = test.result;
  if (!r.ok) {
    return <div className="d-flex align-items-start gap-1 text-danger"><XCircle size={14} className="flex-shrink-0 mt-1" /> <span>Connection failed: {r.error}</span></div>;
  }
  return (
    <div className="d-flex flex-column gap-1">
      <div className="d-flex align-items-start gap-1 text-success-emphasis">
        <CheckCircle2 size={14} className="flex-shrink-0 mt-1 text-success" />
        <span>Connected in {r.ms} ms, {r.models} model{r.models === 1 ? '' : 's'} available{r.model ? `; ${r.model} answered` : ''}.</span>
      </div>
      {r.model && !r.toolCall && (
        <div className="d-flex align-items-start gap-1 text-warning-emphasis">
          <TriangleAlert size={14} className="flex-shrink-0 mt-1" />
          <span>{r.model} did not call the test tool, so it may not use the AKILIMO tools reliably. Try another model.{r.reply ? ` It said: “${r.reply}”` : ''}</span>
        </div>
      )}
      {r.model && r.toolCall && <div className="text-body-secondary ms-3">Tool calling works.</div>}
    </div>
  );
};

// Downloads Ollama models with progress; the model list refreshes when a pull finishes
const OllamaPull: React.FC<{ onPulled: () => void }> = ({ onPulled }) => {
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pulling = progress !== null;

  const pull = async (e: React.FormEvent) => {
    e.preventDefault();
    const model = name.trim();
    if (!model || pulling) return;
    const controller = new AbortController();
    abort.current = controller;
    setStatus(null);
    setProgress({ status: 'starting' });
    try {
      await pullModel(model, setProgress, controller.signal);
      setStatus({ ok: true, text: `${model} is ready. Only models that support tools appear in the model list.` });
      setName('');
      onPulled();
    } catch (err) {
      setStatus(controller.signal.aborted
        ? { ok: false, text: 'Download stopped. Pulling again resumes it.' }
        : { ok: false, text: `Could not pull ${model}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const percent = progress?.total ? Math.floor(((progress.completed ?? 0) / progress.total) * 100) : null;

  return (
    <form onSubmit={pull}>
      <label className="form-label mb-1" htmlFor="ollama-pull">Download a model</label>
      <div className="input-group input-group-sm">
        <input id="ollama-pull" className="form-control font-monospace" list="ollama-suggestions" placeholder="e.g. qwen3:8b"
          autoComplete="off" spellCheck={false} value={name} onChange={e => setName(e.target.value)} disabled={pulling} />
        <datalist id="ollama-suggestions">
          {SUGGESTED_OLLAMA_MODELS.map(m => <option key={m} value={m} />)}
        </datalist>
        {pulling ? (
          <button type="button" className="btn btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => abort.current?.abort()}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-outline-success d-inline-flex align-items-center gap-1" disabled={!name.trim()}>
            <Download size={14} /> Pull
          </button>
        )}
      </div>
      <div className="form-text">
        Downloads into the Ollama this site uses. Suggested models call tools reliably; see the <a href="https://ollama.com/search?c=tools" target="_blank" rel="noreferrer">Ollama library</a> for more.
      </div>
      {progress && (
        <div className="mt-1">
          <div className="d-flex justify-content-between text-body-secondary">
            <span>{progress.status}</span>
            {percent !== null && <span>{percent}% of {formatBytes(progress.total!)}</span>}
          </div>
          <div className="progress" role="progressbar" aria-label="Download progress" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100} style={{ height: '0.4rem' }}>
            <div className={`progress-bar bg-success ${percent === null ? 'progress-bar-striped progress-bar-animated w-100' : ''}`}
              style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
        </div>
      )}
      {status && <div className={`mt-1 ${status.ok ? 'text-success-emphasis' : 'text-danger'}`}>{status.text}</div>}
    </form>
  );
};

// Model list status, and for admins the connection test and (for Ollama) model downloads, shown
// under the chat header. Provider keys and URLs are managed in the admin dialog, not here.
export const LlmSettings: React.FC<Props> = ({ llm }) => {
  const { provider } = llm;
  return (
    <div className="border-bottom px-3 py-2 bg-body-tertiary d-flex flex-column gap-2 small">
      <div className="d-flex flex-wrap align-items-center gap-2">
        {llm.isAdmin && (
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            onClick={llm.runTest} disabled={!provider || llm.test?.running}
            title={llm.model ? `Check the connection and that ${llm.model} can call tools` : 'Check the connection'}>
            <Plug size={14} /> Test connection
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
          onClick={llm.refresh} disabled={llm.loading || !provider}>
          {llm.loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Reload models
        </button>
        <span className="text-body-secondary">
          {!provider ? 'No provider is set up yet' : llm.loading ? 'Loading models…' : llm.error ? 'Could not load models' : `${llm.models.length} model${llm.models.length === 1 ? '' : 's'} available`}
        </span>
      </div>
      {llm.isAdmin
        ? <div className="text-body-secondary">Provider keys and addresses are saved encrypted on the server: open <strong>Manage</strong> and the <strong>AI providers</strong> tab.</div>
        : <div className="text-body-secondary">The AI providers are set up by your administrators.</div>}
      {llm.isAdmin && <TestResult llm={llm} />}
      {llm.isAdmin && provider === 'ollama' && <OllamaPull onPulled={llm.refresh} />}
    </div>
  );
};
