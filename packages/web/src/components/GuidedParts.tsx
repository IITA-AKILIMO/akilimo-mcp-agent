import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { GuidedEntry } from '../mcp/guided';

// Small pieces shared by the guided screens (GuidedPanel.tsx and AdviceScreens.tsx)

export type Record_ = (entry: GuidedEntry) => void;
export type Call = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type Row = Record<string, unknown>;

export interface FertilizerOption { key: string; name: string; fertilizer_type: string; bag_weight_kg: number; price_bands_per_bag: number[]; typical_price_per_bag: number | null }
export interface FertilizerData { country: string; currency: string | null; fertilizers: FertilizerOption[] }
export interface PriceData { country: string; currency: string | null; unit: string; price_bands: { min: number; max: number; average: number }[]; typical_price_per_tonne: number | null }

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
