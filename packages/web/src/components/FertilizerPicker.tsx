import React, { useEffect, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Country } from '@akilimo/shared';
import type { ServerState } from '../mcp/useMcpServers';
import { Shell } from './ChatPickers';
import { Loading, PriceHint, useLoad, type Call, type FertilizerData } from './GuidedParts';

// The chat's fertilizer chooser: the fertilizers of the country with their typical prices, to tick and
// correct, sent as one message the assistant can read exactly (key, type, bag weight and price)
interface Props {
  country: Country;
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  onSend: (text: string) => void;
  onClose: () => void;
}

export const FertilizerPicker: React.FC<Props> = ({ country, servers, callTool, onSend, onClose }) => {
  const call: Call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    const target = Object.entries(servers).find(([, s]) => s.status === 'connected' && s.tools.some(t => t.name === name))?.[0];
    if (!target) throw new Error('The AKILIMO server is not connected yet');
    const result = await callTool(target, name, args);
    const text = result.content.find(c => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(text || `${name} failed`);
    return JSON.parse(text) as T;
  };

  const state = useLoad(() => call<FertilizerData>('get_fertilizer_options', { countryCode: country.code }), [country.code]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const data = state.data;
  useEffect(() => {
    if (!data) return;
    setPrices(Object.fromEntries(data.fertilizers.map(f => [f.key, f.typical_price_per_bag !== null ? String(f.typical_price_per_bag) : ''])));
    setSelected({});
  }, [data]);

  const chosen = data?.fertilizers.filter(f => selected[f.key]) ?? [];
  const problem = chosen.length === 0 ? 'Tick at least one fertilizer you can buy' : chosen.some(f => !(Number(prices[f.key]) > 0)) ? 'Enter a price for each ticked fertilizer' : null;

  const send = () => {
    if (!data || problem) return;
    const lines = chosen.map(f => `${f.name} (key ${f.key}, type ${f.fertilizer_type}, ${f.bag_weight_kg} kg bag): ${Number(prices[f.key])} ${data.currency ?? ''} per bag`.replace('  ', ' '));
    onSend(`These are the fertilizers I can buy in ${country.name} and their prices: ${lines.join('; ')}.`);
  };

  return (
    <Shell title="Which fertilizers can you buy?" onClose={onClose}>
      <Loading state={state} />
      {data && data.fertilizers.length === 0 && <div className="alert alert-info small mb-0">No fertilizers are listed for {country.name}.</div>}
      {data && data.fertilizers.length > 0 && (
        <>
          <div className="d-flex flex-column gap-2 overflow-auto">
            {data.fertilizers.map(f => (
              <div key={f.key} className={`border rounded p-2 d-flex align-items-center gap-2 ${selected[f.key] ? 'border-success bg-success-subtle' : ''}`}>
                <div className="form-check mb-0 flex-grow-1">
                  <input id={`cf-${f.key}`} className="form-check-input" type="checkbox" checked={!!selected[f.key]}
                    onChange={e => setSelected(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                  <label className="form-check-label" htmlFor={`cf-${f.key}`}>
                    <span className="fw-semibold">{f.name}</span> <span className="small text-body-secondary">{f.fertilizer_type} · {f.bag_weight_kg} kg bag</span>
                  </label>
                </div>
                <div>
                  <div className="input-group input-group-sm" style={{ maxWidth: '11rem' }}>
                    <input type="number" min="0" step="any" className="form-control" aria-label={`${f.name} price per bag`} value={prices[f.key] ?? ''}
                      onChange={e => setPrices(prev => ({ ...prev, [f.key]: e.target.value }))} />
                    <span className="input-group-text">{data.currency ?? ''}</span>
                  </div>
                  {selected[f.key] && <PriceHint call={call} country={country.code} item="fertilizer" fertilizerKey={f.key} value={prices[f.key] ?? ''} />}
                </div>
              </div>
            ))}
          </div>
          <div className="form-text">Price per bag; typical prices are filled in, change them to what you pay.</div>
          <div className="d-flex align-items-center gap-2 mt-2">
            <button type="button" className="btn btn-sm btn-akilimo" onClick={send} disabled={!!problem} title="Send the ticked fertilizers and prices to the assistant">Send these fertilizers</button>
            {problem && <span className="small text-body-secondary">{problem}</span>}
          </div>
        </>
      )}
    </Shell>
  );
};
