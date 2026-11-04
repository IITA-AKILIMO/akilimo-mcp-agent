import React, { useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import type { Akilimo2Summary } from '@akilimo/shared';
import type { Call } from './GuidedParts';

// What a guided fertilizer step keeps of Akilimo 2.0's answer: the figures worth showing, or why there are none
export type SecondAnswer = { summary: Akilimo2Summary } | { error: string };

const num = (n: number | null, digits = 0) => (n === null ? '–' : n.toLocaleString(undefined, { maximumFractionDigits: digits }));
const tonnes = (kg: number | null) => (kg === null ? '–' : `${num(kg / 1000, 1)} t/ha`);

// The live rate from the AKILIMO server's convert_currency tool (one US dollar in the country's currency)
interface Rate { to: string; rate: number; asOf: string | null }

// Amounts written as "508 USD" or "$508" in 2.0's sentence, shown in the country's currency at the same rate
const DOLLARS = /(?:\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:USD|US\$|US dollars?))/gi;
const localizeText = (text: string, { rate, to }: Rate) =>
  text.replace(DOLLARS, (_all, a?: string, b?: string) => `${num(Number((a ?? b ?? '0').replace(/,/g, '')) * rate)} ${to}`);

// 2.0 writes some figures with a dozen decimals ("20.2343133485765 kg"); show every number with more than 2 as 2
const roundLongDecimals = (text: string) =>
  text.replace(/(?<![\d.])\d[\d,]*\.\d{3,}/g, (n) => Number(n.replace(/,/g, '')).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// The Akilimo 2.0 half of a fertilizer answer, next to Akilimo 1.0's. 2.0 works from the field's place and size
// with its own prices, so its money is per hectare in its own currency (US dollars) and it says how sure it is.
// With `call` (a live screen, not a replay) the money can be shown in the country's currency at the live rate.
export const Akilimo2Result: React.FC<{ answer: SecondAnswer; call?: Call | undefined; country?: string | undefined }> = ({ answer, call, country }) => {
  const [local, setLocal] = useState<Rate | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if ('error' in answer) {
    return <div className="alert alert-warning small mb-0">Akilimo 2.0 could not answer this time: {answer.error}</div>;
  }
  const s = answer.summary;
  const inDollars = s.economics.currency.toUpperCase().startsWith('USD');
  const canConvert = !!call && !!country && inDollars;

  const choose = async (wantLocal: boolean) => {
    setProblem(null);
    if (!wantLocal) { setShowLocal(false); return; }
    if (local) { setShowLocal(true); return; }
    setBusy(true);
    try {
      const c = await call!<{ to: string; rate: number; asOf: string | null }>('convert_currency', { amount: 1, from: 'USD', countryCode: country });
      setLocal({ to: c.to, rate: c.rate, asOf: c.asOf });
      setShowLocal(true);
    } catch (err) {
      setProblem(`No exchange rate available: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const money = (usd: number | null) => {
    if (usd === null) return '–';
    return showLocal && local ? `${num(usd * local.rate)} ${local.to}/ha` : `${num(usd)} ${s.economics.currency}`;
  };

  const gain = s.yield.mean !== null && s.yieldWithoutFertilizer !== null ? s.yield.mean - s.yieldWithoutFertilizer : null;
  const rows: [string, string][] = [
    ['Fertilizer needed (nitrogen, phosphorus, potassium)', `${num(s.rate.N)} / ${num(s.rate.P)} / ${num(s.rate.K)} ${s.rate.unit}`],
    ['Expected yield', s.yield.mean === null ? '–' : `${tonnes(s.yield.mean)}${s.yield.lower !== null && s.yield.upper !== null ? ` (likely ${tonnes(s.yield.lower)} to ${tonnes(s.yield.upper)})` : ''}`],
    ['Yield without fertilizer', tonnes(s.yieldWithoutFertilizer)],
    ['Extra yield', gain === null ? '–' : tonnes(gain)],
    ['Expected net return', money(s.economics.expectedNetReturn)],
    ['Chance of making a loss', s.economics.probLoss === null ? '–' : `${num(s.economics.probLoss * 100)}%`],
    ['Return for each unit spent', num(s.economics.valueCostRatio, 2)],
  ].filter((r): r is [string, string] => r[1] !== '–');

  return (
    <>
      {canConvert && (
        <div className="d-flex align-items-center gap-2 mb-2 small">
          <span className="text-body-secondary">Show money in</span>
          <div className="btn-group btn-group-sm" role="group" aria-label="Currency of the Akilimo 2.0 figures">
            <button type="button" className={`btn ${!showLocal ? 'btn-success' : 'btn-outline-secondary'}`} aria-pressed={!showLocal} onClick={() => choose(false)}>US dollars</button>
            <button type="button" className={`btn d-inline-flex align-items-center gap-1 ${showLocal ? 'btn-success' : 'btn-outline-secondary'}`} aria-pressed={showLocal} disabled={busy} onClick={() => choose(true)}>
              {busy && <Loader2 size={12} className="spin" />} Local currency
            </button>
          </div>
        </div>
      )}
      {problem && <div className="alert alert-warning small py-1">{problem}</div>}
      {s.reasoning && <div className="card mb-3 border-info"><div className="card-body"><p className="mb-0">{roundLongDecimals(showLocal && local ? localizeText(s.reasoning, local) : s.reasoning)}</p></div></div>}
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
        {showLocal && local ? ` Shown in ${local.to} at 1 USD = ${num(local.rate, 2)} ${local.to}${local.asOf ? ` (rate of ${local.asOf})` : ''}; the dollar amounts in the sentence above are converted too.` : ''}
        {s.model.name ? ` Model: ${s.model.name}${s.model.version ? ` ${s.model.version}` : ''}.` : ''}
      </div>
    </>
  );
};
