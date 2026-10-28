import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { GuidedEntry } from '../mcp/guided';
import type { ServerState } from '../mcp/useMcpServers';

// Small pieces shared by the guided screens (GuidedPanel.tsx and AdviceScreens.tsx)

export type Record_ = (entry: GuidedEntry) => void;
export type Call = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type Row = Record<string, unknown>;

export interface FertilizerOption { key: string; name: string; fertilizer_type: string; bag_weight_kg: number; price_bands_per_bag: number[]; typical_price_per_bag: number | null }
export interface FertilizerData { country: string; currency: string | null; fertilizers: FertilizerOption[] }
export interface PriceData { country: string; currency: string | null; unit: string; price_bands: { min: number; max: number; average: number }[]; typical_price_per_tonne: number | null }

// A tool call on whichever connected server offers the tool (several servers can offer the AKILIMO tools,
// and a newer tool may exist on only some of them)
export const makeCall = (
  servers: Record<string, ServerState>,
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): Call => async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
  const target = Object.entries(servers).find(([, s]) => s.status === 'connected' && s.tools.some(t => t.name === name))?.[0];
  if (!target) throw new Error(`No connected AKILIMO server offers the tool ${name}`);
  const result = await callTool(target, name, args);
  const text = result.content.find(c => c.type === 'text')?.text ?? '';
  if (result.isError) throw new Error(text || `${name} failed`);
  return JSON.parse(text) as T;
};

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '–');
export const label = (key: string) => { const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addMonths = (base: Date | string, months: number, days = 0) => {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  if (days) d.setDate(d.getDate() + days);
  return isoDate(d);
};
export const monthsFromNow = (months: number) => addMonths(new Date(), months);

// ── price sanity check (check_price) ───────────────────────────────────────────────────────────

export type PriceItem = 'cassava' | 'maize_cob' | 'maize_grain' | 'sweet_potato' | 'fertilizer';

interface PriceCheck { ok: boolean | null; message: string }

// Asks the check_price tool whether a typed price is believable, a moment after typing stops. An
// answer of false is a warning, never a block: the farmer may know better. Errors mean no warning.
export function usePriceCheck(call: Call, country: string, item: PriceItem, value: string, fertilizerKey?: string): PriceCheck | null {
  const [result, setResult] = useState<PriceCheck | null>(null);
  useEffect(() => {
    const price = Number(value);
    if (!(price > 0)) { setResult(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      call<PriceCheck>('check_price', { countryCode: country, item, value: price, ...(fertilizerKey ? { fertilizerKey } : {}) })
        .then(r => live && setResult(r), () => live && setResult(null));
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [value, country, item, fertilizerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}

// The warning under a price field; nothing while the price is fine or cannot be checked
export const PriceHint: React.FC<{ call: Call; country: string; item: PriceItem; value: string; fertilizerKey?: string }> = ({ call, country, item, value, fertilizerKey }) => {
  const check = usePriceCheck(call, country, item, value, fertilizerKey);
  if (!check || check.ok !== false) return null;
  return <div className="small text-warning-emphasis mt-1">{check.message}</div>;
};

// The cassava yield classes of the AKILIMO app, in t/ha of fresh roots; the value sent as
// yieldInfo.current_field_yield. The compute service treats 15 or more as a high yield: for planting
// practices tillage only pays on high-yield fields, so a low class always ends in "do not plough".
export const YIELD_CLASSES = [
  { value: 3.75, label: 'Very low: under 7.5 t/ha' },
  { value: 11.25, label: 'Low: 7.5 to 15 t/ha' },
  { value: 18.75, label: 'Medium: 15 to 22.5 t/ha' },
  { value: 26.25, label: 'High: 22.5 to 30 t/ha' },
  { value: 33.75, label: 'Very high: over 30 t/ha' },
];

export const YieldSelect: React.FC<{ id: string; value: number; onChange: (value: number) => void }> = ({ id, value, onChange }) => (
  <>
    <label className="form-label small mb-1" htmlFor={id}>What cassava yield do you get now (fresh roots per hectare)?</label>
    <select id={id} className="form-select" value={value} onChange={e => onChange(Number(e.target.value))}>
      {YIELD_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
    <div className="form-text">In a normal season; 1 acre is about 0.4 ha. The advice depends on it: ploughing and ridging only pay on fields yielding 15 t/ha or more.</div>
  </>
);

// The farmer's risk attitude (user_info.risk_attitude). The compute service only recommends fertilizer when
// the extra income is at least 1.8 times the cost (0), 1.0 times (1) or 0.2 times (2), so a cautious farmer
// is told far more often that fertilizer does not pay. The anonymous default has been 0.
export const RISK_OPTIONS = [
  { value: 0, label: 'Careful: only if the extra income is well above the cost' },
  { value: 1, label: 'Balanced: if the extra income covers the cost' },
  { value: 2, label: 'Willing to take a risk: even for a small gain' },
];

export const RiskSelect: React.FC<{ id: string; value: number; onChange: (value: number) => void }> = ({ id, value, onChange }) => (
  <>
    <label className="form-label small mb-1" htmlFor={id}>How much risk are you willing to take with fertilizer?</label>
    <select id={id} className="form-select" value={value} onChange={e => onChange(Number(e.target.value))}>
      {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <div className="form-text">A careful farmer is only advised to use fertilizer when it clearly pays, so the advice can be "do not use fertilizer" more often.</div>
  </>
);

// Date limits for every planting and harvest picker: planting no more than 6 months in the past from
// today, and the harvest from about 8 months up to 1 year after the chosen planting date
export const plantingMin = () => monthsFromNow(-6);
export const harvestRange = (planting: string) => ({
  min: addMonths(planting || new Date(), 7, 24),
  max: addMonths(planting || new Date(), 12),
});

// How far the planting or harvest date can shift (0, 1 or 2 months): planting_date_window and harvest_date_window
export const WINDOWS = [0, 1, 2];
export const windowLabel = (months: number) => (months === 0 ? 'No change' : `${months} month${months > 1 ? 's' : ''}`);

// What is wrong with the chosen dates, or null when they are fine
export function dateProblem(planting: string, harvest: string): string | null {
  if (!planting) return 'Choose the planting date';
  if (planting < plantingMin()) return 'The planting date cannot be more than 6 months in the past';
  const { min, max } = harvestRange(planting);
  if (!harvest || harvest < min) return 'The harvest must be at least 8 months after planting';
  if (harvest > max) return 'The harvest must be within 1 year of planting';
  return null;
}

// Generic result view: the compute answers have many fields; show them all, readably
export const Value: React.FC<{ value: unknown; depth?: number }> = ({ value, depth = 0 }) => {
  if (value === null || value === undefined || value === '') return <span className="text-body-secondary">–</span>;
  if (typeof value === 'number') return <>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'string') return <>{value}</>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-body-secondary">none</span>;
    const rows = value.filter((v): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v));
    if (rows.length === value.length) {
      const columns = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => rows.every(r => typeof r[k] !== 'object' || r[k] === null));
      return (
        <div className="table-responsive">
          <table className="table table-sm table-striped mb-0 small">
            <thead><tr>{columns.map(c => <th key={c}>{label(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{columns.map(c => <td key={c}><Value value={r[c]} depth={depth + 1} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return <ul className="mb-0 ps-3">{value.map((v, i) => <li key={i}><Value value={v} depth={depth + 1} /></li>)}</ul>;
  }
  const entries = Object.entries(value as Row);
  return (
    <dl className={`row mb-0 small ${depth > 0 ? 'ms-1' : ''}`}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="col-sm-4 text-body-secondary fw-normal">{label(k)}</dt>
          <dd className="col-sm-8 mb-1"><Value value={v} depth={depth + 1} /></dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

// Loads once per screen/country and shows a spinner or the error while waiting
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    load().then(data => live && setState({ data, loading: false }), e => live && setState({ error: message(e), loading: false }));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export const Loading: React.FC<{ state: { error?: string; loading: boolean } }> = ({ state }) => (
  <>
    {state.loading && <div className="text-body-secondary d-flex align-items-center gap-2"><Loader2 size={16} className="spin" /> Loading…</div>}
    {state.error && <div className="alert alert-danger small">{state.error}</div>}
  </>
);
