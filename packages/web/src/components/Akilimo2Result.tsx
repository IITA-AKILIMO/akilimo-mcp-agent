import React from 'react';
import { TriangleAlert } from 'lucide-react';
import type { Akilimo2Summary } from '@akilimo/shared';

// What a guided fertilizer step keeps of Akilimo 2.0's answer: the figures worth showing, or why there are none
export type SecondAnswer = { summary: Akilimo2Summary } | { error: string };

const num = (n: number | null, digits = 0) => (n === null ? '–' : n.toLocaleString(undefined, { maximumFractionDigits: digits }));
const tonnes = (kg: number | null) => (kg === null ? '–' : `${num(kg / 1000, 1)} t/ha`);

// The Akilimo 2.0 half of a fertilizer answer, next to Akilimo 1.0's. 2.0 works from the field's place and size
// with its own prices, so its money is per hectare in its own currency and it says how sure it is.
export const Akilimo2Result: React.FC<{ answer: SecondAnswer }> = ({ answer }) => {
  if ('error' in answer) {
    return <div className="alert alert-warning small mb-0">Akilimo 2.0 could not answer this time: {answer.error}</div>;
  }
  const s = answer.summary;
  const gain = s.yield.mean !== null && s.yieldWithoutFertilizer !== null ? s.yield.mean - s.yieldWithoutFertilizer : null;
  const rows: [string, string][] = [
    ['Fertilizer needed (nitrogen, phosphorus, potassium)', `${num(s.rate.N)} / ${num(s.rate.P)} / ${num(s.rate.K)} ${s.rate.unit}`],
    ['Expected yield', s.yield.mean === null ? '–' : `${tonnes(s.yield.mean)}${s.yield.lower !== null && s.yield.upper !== null ? ` (likely ${tonnes(s.yield.lower)} to ${tonnes(s.yield.upper)})` : ''}`],
    ['Yield without fertilizer', tonnes(s.yieldWithoutFertilizer)],
    ['Extra yield', gain === null ? '–' : tonnes(gain)],
    ['Expected net return', s.economics.expectedNetReturn === null ? '–' : `${num(s.economics.expectedNetReturn)} ${s.economics.currency}`],
    ['Chance of making a loss', s.economics.probLoss === null ? '–' : `${num(s.economics.probLoss * 100)}%`],
    ['Return for each unit spent', num(s.economics.valueCostRatio, 2)],
  ].filter((r): r is [string, string] => r[1] !== '–');

  return (
    <>
      {s.reasoning && <div className="card mb-3 border-info"><div className="card-body"><p className="mb-0">{s.reasoning}</p></div></div>}
      <table className="table table-sm table-striped small mb-3">
        <thead><tr><th>What</th><th className="text-end">Value</th></tr></thead>
        <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="text-end fw-semibold">{v}</td></tr>)}</tbody>
      </table>
      {s.products.length > 0 && (
        <table className="table table-sm small mb-3">
          <thead><tr><th>Fertilizer</th><th className="text-end">Amount</th></tr></thead>
          <tbody>{s.products.map(p => <tr key={p.product}><td>{p.product}</td><td className="text-end">{num(p.amount)} {p.unit}</td></tr>)}</tbody>
        </table>
      )}
      {s.warnings.length > 0 && (
        <div className="alert alert-warning small d-flex gap-2 mb-2" role="note">
          <TriangleAlert size={16} className="flex-shrink-0 mt-1" />
          <div>
            Akilimo 2.0 says:
            <ul className="mb-0 ps-3">{s.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </div>
        </div>
      )}
      <div className="form-text">
        Akilimo 2.0 used only your field's place and size, with its own prices (not yours), so its money figures are per hectare in {s.economics.currency || 'its own currency'}.
        {s.model.name ? ` Model: ${s.model.name}${s.model.version ? ` ${s.model.version}` : ''}.` : ''}
      </div>
    </>
  );
};
