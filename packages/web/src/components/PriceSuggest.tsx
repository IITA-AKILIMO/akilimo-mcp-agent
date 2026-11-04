import React, { useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { message, type Call } from './GuidedParts';

// Where a price or cost has no default, the tool find_missing_prices suggests one (a world market benchmark, and
// amounts found on the web when the user has web search on). The suggestion is shown with its source and date and
// the farmer decides: "Use this price" fills the field, nothing is used without that click.
type Item = 'fertilizers' | 'cassava' | 'operations';

interface Suggestion {
  key: string;
  unit: string;
  currency: string | null;
  suggested_price: number | null;
  basis: 'web' | 'benchmark' | 'none';
  benchmark: { as_of: string } | null;
  web: { hits: { title: string; url: string }[]; amounts_found: number[] } | null;
  note: string;
}
interface Answer { suggestions: Suggestion[]; message?: string }

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Cost per acre in the field's own area unit (the costs of the form are per that unit)
const ACRES_PER: Record<string, number> = { acre: 1, ha: 2.47105, are: 0.0247105, m2: 0.000247105 };
export const perAcreIn = (unit: string, perAcre: number) => perAcre / (ACRES_PER[unit] ?? 1);

interface Props {
  call: Call;
  country: string;
  item: Item;
  // The suggestion for this field: a fertilizer key, or the key of an operation cost (manual_ploughing, weeding_one, ...)
  match: (key: string) => boolean;
  fertilizerKey?: string;
  // The user's own web search switch; costs and the cassava price have no world benchmark, so they need it
  webSearch: boolean;
  // Turns the tool's price (per bag, per tonne of roots, per acre) into the number the field takes
  convert?: (price: number) => number;
  onUse: (price: number) => void;
}

export const PriceSuggest: React.FC<Props> = ({ call, country, item, match, fertilizerKey, webSearch, convert, onUse }) => {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ s: Suggestion | null; info: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Without a world benchmark only a web search can help, and only when the user allows it
  if (item !== 'fertilizers' && !webSearch) return null;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<Answer>('find_missing_prices', { countryCode: country, items: [item], ...(fertilizerKey ? { fertilizers: [fertilizerKey] } : {}), onlineSearch: webSearch });
      const s = r.suggestions.find(x => match(x.key)) ?? null;
      setAnswer({ s, info: s ? null : (r.message ?? 'No suggestion could be found.') });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const use = (price: number) => { onUse(convert ? convert(price) : price); setAnswer(null); };

  return (
    <div className="mt-1">
      {!answer && (
        <button type="button" className="btn btn-sm btn-link p-0 text-decoration-none d-inline-flex align-items-center gap-1" onClick={ask} disabled={busy}
          title="Look for a price online; you decide whether to use it">
          {busy ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Suggest a price
        </button>
      )}
      {error && <div className="small text-danger">{error}</div>}
      {answer && (
        <div className="small border rounded p-2 bg-body-tertiary">
          {answer.info && <div>{answer.info}</div>}
          {answer.s && (
            <>
              {answer.s.suggested_price !== null && (
                <div>
                  Suggested <strong>{num(convert ? convert(answer.s.suggested_price) : answer.s.suggested_price)} {answer.s.currency ?? ''}</strong>
                  {' '}({answer.s.basis === 'benchmark' ? `world market benchmark of ${answer.s.benchmark?.as_of ?? ''}, indicative` : 'read from the web, unverified'}).
                </div>
              )}
              <div className="text-body-secondary">{answer.s.note}</div>
              {answer.s.suggested_price === null && (answer.s.web?.amounts_found.length ?? 0) > 0 && (
                <div className="d-flex flex-wrap gap-1 mt-1">
                  {answer.s.web!.amounts_found.slice(0, 4).map(a => (
                    <button key={a} type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => use(a)}>Use {num(convert ? convert(a) : a)}</button>
                  ))}
                </div>
              )}
              {answer.s.web && answer.s.web.hits.length > 0 && (
                <ul className="mb-1 ps-3">
                  {answer.s.web.hits.slice(0, 3).map(h => (
                    <li key={h.url}><a href={h.url} target="_blank" rel="noreferrer noopener" className="d-inline-flex align-items-center gap-1">{h.title.slice(0, 70)} <ExternalLink size={11} /></a></li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="d-flex gap-2 mt-1">
            {answer.s?.suggested_price !== null && answer.s?.suggested_price !== undefined && (
              <button type="button" className="btn btn-sm btn-success py-0" onClick={() => use(answer.s!.suggested_price!)}>Use this price</button>
            )}
            <button type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => setAnswer(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};
