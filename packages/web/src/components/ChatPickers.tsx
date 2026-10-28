import React, { useEffect, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Country } from '@akilimo/shared';
import type { ServerState } from '../mcp/useMcpServers';
import { AREA_UNITS, intercropCrop, type CropOption, type CropPrices, type OperationCosts } from './AdviceScreens';
import { PriceHint, RISK_OPTIONS, YIELD_CLASSES, makeCall, money, type PriceData } from './GuidedParts';

// Forms of the Ask AI chat that replace typing exact answers: each sends one message in a fixed wording
// that the chat instructions (server/chat/agent.ts) tell the model how to read.
interface Props {
  country: Country;
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  onSend: (text: string) => void;
  onClose: () => void;
}

// A dialog over the chat (the footer is too small for these forms); Escape or a click outside closes it
export const Shell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal d-block" role="dialog" aria-modal="true" aria-label={title} style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-scrollable modal-dialog-centered" onClick={e => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2">
            <h2 className="modal-title h6 mb-0">{title}</h2>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" title="Close (Esc)" />
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </div>
  );
};
const Field: React.FC<{ id: string; label: string; children: React.ReactNode }> = ({ id, label, children }) => (
  <div className="mb-2"><label className="form-label small mb-1" htmlFor={id}>{label}</label>{children}</div>
);

// ── my field: size, yield, cassava price, budget and risk attitude ──────────────────────────────────

interface InvestmentData { currency: string | null; options: { amount_per_unit: number; max_investment_for_field?: number }[] }

export const FieldPicker: React.FC<Props> = ({ country, servers, callTool, onSend, onClose }) => {
  const call = makeCall(servers, callTool);
  const [size, setSize] = useState('1');
  const [unit, setUnit] = useState('acre');
  const [yieldClass, setYieldClass] = useState(11.25);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('');
  const [budget, setBudget] = useState('0');
  const [budgets, setBudgets] = useState<InvestmentData | null>(null);
  const [risk, setRisk] = useState(1);

  useEffect(() => {
    let live = true;
    call<PriceData>('get_cassava_price', { countryCode: country.code }).then(d => {
      if (!live) return;
      setCurrency(d.currency ?? '');
      if (d.typical_price_per_tonne != null) setPrice(String(d.typical_price_per_tonne));
    }, () => undefined);
    return () => { live = false; };
  }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!(Number(size) > 0)) return;
    let live = true;
    const timer = setTimeout(() => {
      call<InvestmentData>('get_investment_options', { countryCode: country.code, fieldSize: Number(size), areaUnit: unit })
        .then(d => { if (live) { setBudgets(d); setBudget('0'); } }, () => live && setBudgets(null));
    }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [country.code, size, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = !(Number(size) > 0) ? 'Enter the field size' : !(Number(price) > 0) ? 'Enter the cassava root price per tonne' : null;
  const send = () => {
    if (problem) return;
    const yieldLabel = YIELD_CLASSES.find(c => c.value === yieldClass)?.label ?? '';
    const riskLabel = RISK_OPTIONS.find(o => o.value === risk)?.label.split(':')[0] ?? '';
    const budgetText = Number(budget) > 0
      ? `My fertilizer budget for the whole field is up to ${budget} ${budgets?.currency ?? currency} (maxInvestment ${budget}).`
      : 'I have no fertilizer budget limit.';
    onSend(
      `My field is ${Number(size)} ${unit}. My cassava yield now is in the class "${yieldLabel}" (current_field_yield ${yieldClass}). `
      + `I sell cassava roots at ${Number(price)} ${currency} per tonne. ${budgetText} My risk attitude is ${riskLabel.toLowerCase()} (risk_attitude ${risk}).`,
    );
  };

  return (
    <Shell title="About your field" onClose={onClose}>
      <div className="row g-2">
        <div className="col-sm-6">
          <Field id="cp-size" label="Field size">
            <div className="input-group input-group-sm">
              <input id="cp-size" type="number" min="0" step="any" className="form-control" value={size} onChange={e => setSize(e.target.value)} />
              <select className="form-select" aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>
                {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </Field>
        </div>
        <div className="col-sm-6">
          <Field id="cp-yield" label="Cassava yield now (fresh roots per hectare)">
            <select id="cp-yield" className="form-select form-select-sm" value={yieldClass} onChange={e => setYieldClass(Number(e.target.value))}>
              {YIELD_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-sm-6">
          <Field id="cp-price" label="Cassava root price per tonne">
            <div className="input-group input-group-sm">
              <input id="cp-price" type="number" min="0" step="any" className="form-control" value={price} onChange={e => setPrice(e.target.value)} />
              <span className="input-group-text">{currency}</span>
            </div>
            <PriceHint call={call} country={country.code} item="cassava" value={price} />
          </Field>
        </div>
        <div className="col-sm-6">
          <Field id="cp-budget" label="Fertilizer budget for the whole field">
            <select id="cp-budget" className="form-select form-select-sm" value={budget} onChange={e => setBudget(e.target.value)}>
              <option value="0">No limit</option>
              {budgets?.options.map(o => o.max_investment_for_field !== undefined && (
                <option key={o.amount_per_unit} value={o.max_investment_for_field}>Up to {money(o.max_investment_for_field)} {budgets.currency ?? ''}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-12">
          <Field id="cp-risk" label="How much risk are you willing to take with fertilizer?">
            <select id="cp-risk" className="form-select form-select-sm" value={risk} onChange={e => setRisk(Number(e.target.value))}>
              {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <button type="button" className="btn btn-sm btn-akilimo" onClick={send} disabled={!!problem} title="Send these details to the assistant">Send these details</button>
        {problem && <span className="small text-body-secondary">{problem}</span>}
      </div>
    </Shell>
  );
};

// ── planting practices: what is done now, by hand or tractor, and the costs ─────────────────────────

type Method = 'manual' | 'tractor';
const OPERATIONS = [
  { key: 'ploughing', text: 'Ploughing' },
  { key: 'harrowing', text: 'Harrowing' },
  { key: 'ridging', text: 'Ridging' },
] as const;

export const PracticesPicker: React.FC<Props> = ({ country, servers, callTool, onSend, onClose }) => {
  const call = makeCall(servers, callTool);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<Record<string, Method>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // Start from the country's typical costs; without them (older server, no data) the farmer enters their own
  useEffect(() => {
    let live = true;
    call<OperationCosts>('get_operation_costs', { countryCode: country.code }).then(d => {
      if (!live) return;
      const s = (v: number | null) => (v === null ? '' : String(v));
      const c = d.costs;
      setCosts({
        manualPloughing: s(c.manual.ploughing.value), manualHarrowing: s(c.manual.harrowing.value), manualRidging: s(c.manual.ridging.value),
        tractorPloughing: s(c.tractor.ploughing.value), tractorHarrowing: s(c.tractor.harrowing.value), tractorRidging: s(c.tractor.ridging.value),
        weedingOne: s(c.weeding.one.value), weedingTwo: s(c.weeding.two.value),
      });
    }, () => undefined).finally(() => live && setLoaded(true));
    return () => { live = false; };
  }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const cost = (key: string) => Math.max(0, Number(costs[key]) || 0);
  const how = (key: string): Method => method[key] ?? 'manual';
  const costInput = (key: string, label: string) => (
    <div className="col-6 col-sm-4" key={key}>
      <label className="form-label small mb-1" htmlFor={`pp-${key}`}>{label}</label>
      <input id={`pp-${key}`} type="number" min="0" step="any" className="form-control form-control-sm" placeholder="0" value={costs[key] ?? ''}
        onChange={e => setCosts(prev => ({ ...prev, [key]: e.target.value }))} />
    </div>
  );

  const send = () => {
    const doing = OPERATIONS.filter(o => done[o.key]).map(o => `${o.text.toLowerCase()} ${how(o.key) === 'tractor' ? 'with a tractor' : 'by hand'}`);
    const notDoing = OPERATIONS.filter(o => !done[o.key]).map(o => o.text.toLowerCase());
    const flag = (key: string) => (done[key] ? how(key) : 'manual');
    onSend(
      `On this field I do now: ${doing.length ? doing.join(', ') : 'none of ploughing, harrowing or ridging'}${doing.length && notDoing.length ? `; I do not do ${notDoing.join(', ')}` : ''}. `
      + `(ploughing_done ${!!done.ploughing}, harrowing_done ${!!done.harrowing}, ridging_done ${!!done.ridging}; methods ${flag('ploughing')}, ${flag('harrowing')}, ${flag('ridging')}.) `
      + `My costs per the field's area unit: manual ploughing ${cost('manualPloughing')}, manual harrowing ${cost('manualHarrowing')}, manual ridging ${cost('manualRidging')}, `
      + `tractor ploughing ${cost('tractorPloughing')}, tractor harrowing ${cost('tractorHarrowing')}, tractor ridging ${cost('tractorRidging')}, `
      + `first weeding ${cost('weedingOne')}, second weeding ${cost('weedingTwo')}.`,
    );
  };

  return (
    <Shell title="What do you do on this field now?" onClose={onClose}>
      <div className="d-flex flex-column gap-2 mb-2">
        {OPERATIONS.map(({ key, text }) => (
          <div key={key} className={`border rounded p-2 d-flex align-items-center gap-2 ${done[key] ? 'border-success bg-success-subtle' : ''}`}>
            <div className="form-check mb-0 flex-grow-1">
              <input id={`pp-op-${key}`} className="form-check-input" type="checkbox" checked={!!done[key]} onChange={e => setDone(prev => ({ ...prev, [key]: e.target.checked }))} />
              <label className="form-check-label" htmlFor={`pp-op-${key}`}>{text}</label>
            </div>
            {done[key] && (
              <select className="form-select form-select-sm w-auto" aria-label={`How do you do ${text.toLowerCase()}?`} value={how(key)}
                onChange={e => setMethod(prev => ({ ...prev, [key]: e.target.value as Method }))}>
                <option value="manual">By hand</option>
                <option value="tractor">With a tractor</option>
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="small fw-semibold mb-1">Costs per area unit of your field {!loaded && <span className="text-body-secondary fw-normal">(loading typical costs…)</span>}</div>
      <div className="row g-2 mb-1">
        {costInput('manualPloughing', 'Manual ploughing')}
        {costInput('manualHarrowing', 'Manual harrowing')}
        {costInput('manualRidging', 'Manual ridging')}
        {costInput('tractorPloughing', 'Tractor ploughing')}
        {costInput('tractorHarrowing', 'Tractor harrowing')}
        {costInput('tractorRidging', 'Tractor ridging')}
        {costInput('weedingOne', 'First weeding')}
        {costInput('weedingTwo', 'Second weeding')}
      </div>
      <div className="form-text mb-2">Typical costs are filled in where AKILIMO has them; change them to what you pay. Leave all unticked if you do none of these.</div>
      <button type="button" className="btn btn-sm btn-akilimo" onClick={send} title="Send these practices and costs to the assistant">Send these practices</button>
    </Shell>
  );
};

// ── intercropping: how the second crop is sold, and its price ───────────────────────────────────────

export const IntercropPicker: React.FC<Props> = ({ country, servers, callTool, onSend, onClose }) => {
  const call = makeCall(servers, callTool);
  const second = intercropCrop(country.code);
  const [options, setOptions] = useState<CropOption[]>([]);
  const [currency, setCurrency] = useState('');
  const [type, setType] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);

  const pick = (produce: string, list: CropOption[]) => {
    setType(produce);
    const o = list.find(c => c.produce_type === produce);
    setPrice(o?.typical_price != null ? String(o.typical_price) : '');
  };

  useEffect(() => {
    let live = true;
    Promise.all([
      call<CropPrices>('get_crop_prices', { countryCode: country.code }),
      call<PriceData>('get_cassava_price', { countryCode: country.code }).catch(() => null),
    ]).then(([d, cassava]) => {
      if (!live) return;
      const list = second?.key === 'maize' ? d.maize ?? [] : d.sweet_potato ? [d.sweet_potato] : [];
      setOptions(list);
      setCurrency(cassava?.currency ?? '');
      if (list.length) pick(list[0].produce_type, list);
    }, () => undefined).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!second) {
    return <Shell title="Intercropping" onClose={onClose}><div className="small text-body-secondary">Intercropping advice is available for Nigeria (maize) and Tanzania (sweet potato) only.</div></Shell>;
  }
  const option = options.find(o => o.produce_type === type);
  const item = type === 'fresh_cob' ? 'maize_cob' : type === 'grain' ? 'maize_grain' : 'sweet_potato';
  const send = () => {
    if (!option || !(Number(price) > 0)) return;
    const key = second.key === 'maize' ? 'maize' : 'sweetPotato';
    onSend(`For intercropping I grow ${second.crop} between my cassava and sell it as ${option.produce_type === 'fresh_cob' ? 'fresh cobs' : option.produce_type === 'grain' ? 'dry grain' : 'fresh tubers'} at ${Number(price)} ${currency} per ${option.unit} (compute_request.${key}: produce_type ${option.produce_type}, unit_weight ${option.unit_weight}, unit_price ${Number(price)}).`);
  };

  return (
    <Shell title={`Your ${second.crop}`} onClose={onClose}>
      {loading && <div className="small text-body-secondary">Loading prices…</div>}
      {!loading && options.length === 0 && <div className="alert alert-info small mb-0">AKILIMO has no {second.crop} prices for {country.name} yet. Type the price in the chat instead.</div>}
      {options.length > 0 && (
        <>
          {options.length > 1 && (
            <Field id="ic-type" label={`How do you sell your ${second.crop}?`}>
              <select id="ic-type" className="form-select form-select-sm" value={type} onChange={e => pick(e.target.value, options)}>
                {options.map(o => <option key={o.produce_type} value={o.produce_type}>{o.produce_type === 'fresh_cob' ? 'Fresh cobs' : 'Dry grain'}</option>)}
              </select>
            </Field>
          )}
          <Field id="ic-price" label={`Price per ${option?.unit ?? 'unit'}`}>
            <div className="input-group input-group-sm" style={{ maxWidth: '22rem' }}>
              <input id="ic-price" type="number" min="0" step="any" className="form-control" value={price} onChange={e => setPrice(e.target.value)} />
              <span className="input-group-text">{currency}</span>
            </div>
            <PriceHint call={call} country={country.code} item={item} value={price} />
          </Field>
          <button type="button" className="btn btn-sm btn-akilimo" onClick={send} disabled={!(Number(price) > 0)} title="Send the price of your second crop to the assistant">Send this</button>
        </>
      )}
    </Shell>
  );
};
