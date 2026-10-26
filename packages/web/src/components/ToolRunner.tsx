import React, { useEffect, useMemo, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Braces, Loader2, Play, Plug, Wand2, Wrench } from 'lucide-react';
import { TOOL_PRESETS, type ToolPreset } from '../mcp/presets';
import { MCP_SERVERS } from '../mcp/servers';
import type { ServerState } from '../mcp/useMcpServers';
import { SchemaForm, type JsonSchema } from './SchemaForm';

interface Props {
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
}

// Pretty-prints JSON text content, falls back to the raw text
const renderContent = (result: CallToolResult) =>
  result.content.map(c => {
    if (c.type !== 'text') return `[${c.type} content]`;
    try { return JSON.stringify(JSON.parse(c.text), null, 2); } catch { return c.text; }
  }).join('\n\n');

export const ToolRunner: React.FC<Props> = ({ servers, callTool }) => {
  const connected = MCP_SERVERS.filter(s => servers[s.id]?.status === 'connected');
  const options = useMemo(
    () => connected.flatMap(s => servers[s.id].tools.map(tool => ({ key: `${s.id}::${tool.name}`, server: s, tool }))),
    [servers] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [selected, setSelected] = useState('');
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [showJson, setShowJson] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallToolResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [presetBusy, setPresetBusy] = useState<string | null>(null);
  const [presetNote, setPresetNote] = useState<{ text: string; error?: boolean } | null>(null);

  const current = options.find(o => o.key === selected);
  const presets = TOOL_PRESETS[selected];

  const applyPreset = async (preset: ToolPreset) => {
    if (!current) return;
    setPresetBusy(preset.label);
    setPresetNote(null);
    try {
      const { args: next, message } = await preset.apply(args, (name, a) => callTool(current.server.id, name, a));
      setArgs(next);
      if (message) setPresetNote({ text: message });
    } catch (error) {
      setPresetNote({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setPresetBusy(null);
    }
  };

  // Pick the first tool when servers connect, clear the selection when its server goes away
  useEffect(() => {
    if (!current) setSelected(options[0]?.key ?? '');
  }, [options, current]);

  // Each tool starts with an empty form
  useEffect(() => {
    setArgs({});
    setResult(null);
    setFailure(null);
    setPresetNote(null);
  }, [selected]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setRunning(true);
    setResult(null);
    setFailure(null);
    try {
      setResult(await callTool(current.server.id, current.tool.name, args));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  if (options.length === 0) {
    return (
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column align-items-center justify-content-center text-center text-body-secondary">
          <Plug size={40} className="mb-2 opacity-50" />
          <p className="mb-1">No MCP server connected.</p>
          <p className="small mb-0">Switch on a server in the MCP servers panel to see its tools.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="card h-100 shadow-sm" onSubmit={run} noValidate>
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <Wrench size={16} className="text-body-secondary" />
        <label htmlFor="tool-select" className="small text-body-secondary">Tool</label>
        <select id="tool-select" className="form-select form-select-sm w-auto flex-grow-1" value={selected}
          onChange={e => setSelected(e.target.value)}>
          {connected.map(s => (
            <optgroup key={s.id} label={s.label}>
              {servers[s.id].tools.map(t => <option key={t.name} value={`${s.id}::${t.name}`}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className={`btn btn-sm ${showJson ? 'btn-secondary' : 'btn-outline-secondary'} d-inline-flex align-items-center gap-1`}
          onClick={() => setShowJson(v => !v)} aria-pressed={showJson}>
          <Braces size={14} /> JSON
        </button>
      </div>

      <div className="card-body overflow-auto min-h-0">
        {current && (
          <>
            <div className="d-flex align-items-center gap-2 mb-1">
              <h2 className="h6 mb-0 font-monospace">{current.tool.name}</h2>
              <span className="badge text-bg-secondary">{current.server.label}</span>
            </div>
            {current.tool.description && <p className="small text-body-secondary">{current.tool.description}</p>}

            {presets && (
              <div className="border rounded p-2 mb-3 bg-body-tertiary">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span className="small fw-semibold me-1">Prefill</span>
                  {presets.map(preset => {
                    const blocked = preset.blockedReason?.(args) ?? null;
                    return (
                      <button key={preset.label} type="button"
                        className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                        disabled={!!blocked || !!presetBusy || running}
                        title={blocked ?? preset.description}
                        onClick={() => applyPreset(preset)}>
                        {presetBusy === preset.label ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div className={`small mt-1 ${presetNote?.error ? 'text-danger' : 'text-body-secondary'}`}>
                  {presetNote?.text ?? presets.map(p => `${p.label}: ${p.blockedReason?.(args) ?? p.description}`).join(' ')}
                </div>
              </div>
            )}

            <SchemaForm key={selected} idPrefix={selected.replace(/[^\w-]/g, '-')}
              schema={current.tool.inputSchema as JsonSchema} value={args} onChange={setArgs} />

            {showJson && (
              <div className="mt-3">
                <div className="small text-body-secondary mb-1">Arguments that will be sent</div>
                <pre className="event-payload p-2 bg-body-secondary rounded mb-0">{JSON.stringify(args, null, 2)}</pre>
              </div>
            )}

            {failure && <div className="alert alert-danger small mt-3 mb-0">{failure}</div>}
            {result && (
              <div className="mt-3">
                <div className={`small mb-1 ${result.isError ? 'text-danger' : 'text-success'}`}>
                  {result.isError ? 'The tool returned an error' : 'Result'}
                </div>
                <pre className={`result-output p-2 rounded mb-0 ${result.isError ? 'bg-danger-subtle text-danger-emphasis' : 'bg-body-secondary'}`}>
                  {renderContent(result)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card-footer d-flex align-items-center gap-2">
        <span className="small text-body-secondary me-auto">Fields marked <span className="text-danger">*</span> are required; empty fields use the server's defaults.</span>
        <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-1" disabled={running || !current}>
          {running ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          {running ? 'Running…' : 'Run tool'}
        </button>
      </div>
    </form>
  );
};
