import React, { useEffect, useState } from 'react';
import { CalendarDays, Loader2, Shovel, Wheat } from 'lucide-react';
import type { Country } from '@akilimo/shared';
import type { GuidedEntry } from '../mcp/guided';
import { Loading, Value, WINDOWS, YieldSelect, dateProblem, harvestRange, message, monthsFromNow, plantingMin, useLoad, windowLabel, type Call, type PriceData, type Record_, type Row } from './GuidedParts';
import { MapPicker } from './MapPicker';

// The three recommendation types besides fertilizer advice, which share one short form:
//   practices  = planting practices (PP): ploughing, ridging and their methods, compared with the current practice
//   schedule   = scheduled planting and harvest (SP): the best planting and harvest dates around the farmer's own
//   intercrop  = intercropping (IC): maize in Nigeria, sweet potato in Tanzania
export type AdviceKind = 'practices' | 'schedule' | 'intercrop';

interface KindInfo {
  title: string;
  text: string;
  useCase: string;
  flags: Record<string, boolean>;
}

export const ADVICE: Record<AdviceKind, KindInfo> = {
  practices: {
    title: 'Planting practices',
    text: 'Should you plough or ridge, and by hand or with a tractor?',
    useCase: 'PP',
    flags: { fertilizer_rec: false, planting_practices_rec: true },
  },
  schedule: {
    title: 'Planting and harvest dates',
    text: 'The best time to plant and to harvest for the most income.',
    useCase: 'SPHS',
    flags: { fertilizer_rec: false, scheduled_planting_rec: true, scheduled_harvest_rec: true },
  },
  intercrop: {
    title: 'Intercropping',
    text: 'Would growing a second crop between the cassava pay off?',
    useCase: 'IC',
    flags: { fertilizer_rec: false },
  },
};

export const ADVICE_ICONS: Record<AdviceKind, React.ReactNode> = {
  practices: <Shovel size={22} />,
  schedule: <CalendarDays size={22} />,
  intercrop: <Wheat size={22} />,
};

// Intercropping is only available where AKILIMO has been calibrated for a second crop
const INTERCROP: Record<string, { crop: string; key: 'maize' | 'potato' }> = {
  NG: { crop: 'maize', key: 'maize' },
  TZ: { crop: 'sweet potato', key: 'potato' },
};
export const intercropCrop = (countryCode: string) => INTERCROP[countryCode];

const CURRENCY: Record<string, string> = { NG: 'NGN', TZ: 'TZS', RW: 'RWF', GH: 'GHS', BI: 'BIF' };
const fmt = (n: unknown, country: string) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '–';
  return `${CURRENCY[country] ?? ''} ${Math.round(n).toLocaleString()}`.trim();
};
const fmtDate = (d: unknown) => {
  const date = new Date(`${String(d)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
};
const weeks = (w: number) => (w === 0 ? 'as you asked' : w > 0 ? `${w} wk later` : `${Math.abs(w)} wk earlier`);

const AREA_UNITS = ['acre', 'ha', 'm2', 'are'];

// get_operation_costs: typical costs per the field's area unit; a value is null when AKILIMO has none
interface CostValue { value: number | null; source: string | null }
interface OperationCosts {
  country: string;
  available: boolean;
  costs: {
    manual: { ploughing: CostValue; harrowing: CostValue; ridging: CostValue };
    tractor: { ploughing: CostValue; harrowing: CostValue; ridging: CostValue };
    weeding: { one: CostValue; two: CostValue };
  };
}

const CostInput: React.FC<{ label: string; value: string | undefined; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <input type="number" min="0" step="any" className="form-control form-control-sm" style={{ maxWidth: '10rem' }} aria-label={`${label} cost`}
    value={value ?? ''} placeholder="0" onChange={e => onChange(e.target.value)} />
);

type Method = 'manual' | 'tractor';
const OPERATIONS = [
  { key: 'ploughing', text: 'Ploughing' },
  { key: 'harrowing', text: 'Harrowing' },
  { key: 'ridging', text: 'Ridging' },
];

export const AdviceScreen: React.FC<{ kind: AdviceKind; country: Country; call: Call; record: Record_ }> = ({ kind, country, call, record }) => {
  const info = ADVICE[kind];
  const second = kind === 'intercrop' ? intercropCrop(country.code) : undefined;

  const price = useLoad(() => call<PriceData>('get_cassava_price', { countryCode: country.code }), [country.code]);

  const [pos, setPos] = useState<{ lat?: number; lon?: number }>({});
  const [inArea, setInArea] = useState<boolean | null>(null); // is the picked spot inside the supported area
  const [size, setSize] = useState('1');
  const [unit, setUnit] = useState('acre');
  const [yieldClass, setYieldClass] = useState(11.25); // t/ha class sent as yieldInfo.current_field_yield
  const [planting, setPlanting] = useState(monthsFromNow(1));
  const [harvest, setHarvest] = useState(monthsFromNow(11));
  const [rootPrice, setRootPrice] = useState('');
  const [done, setDone] = useState<Record<string, boolean>>({}); // practices: what the farmer does now
  const [method, setMethod] = useState<Record<string, Method>>({}); // ... and how: by hand or with a tractor
  const [plantingWindow, setPlantingWindow] = useState(1);
  const [harvestWindow, setHarvestWindow] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<GuidedEntry | null>(null);

  useEffect(() => {
    if (price.data?.typical_price_per_tonne != null) setRootPrice(String(price.data.typical_price_per_tonne));
  }, [price.data]);

  // Planting practices compare ploughing, ridging and weeding costs, so start from the country's typical ones
  // (an older server without this tool, or a failed call, just means no prefilled costs, not an error)
  const defaultCosts = useLoad(
    () => (kind === 'practices'
      ? call<OperationCosts>('get_operation_costs', { countryCode: country.code }).catch(() => null)
      : Promise.resolve(null)),
    [country.code, kind],
  );
  const [costValues, setCostValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const c = defaultCosts.data?.costs;
    if (!c) return;
    const s = (v: number | null) => (v === null ? '' : String(v));
    setCostValues({
      manualPloughing: s(c.manual.ploughing.value), manualHarrowing: s(c.manual.harrowing.value), manualRidging: s(c.manual.ridging.value),
      tractorPloughing: s(c.tractor.ploughing.value), tractorHarrowing: s(c.tractor.harrowing.value), tractorRidging: s(c.tractor.ridging.value),
      weedingOne: s(c.weeding.one.value), weedingTwo: s(c.weeding.two.value),
    });
  }, [defaultCosts.data]);

  const harvestLimits = harvestRange(planting);
  const methodOf = (key: string): Method => (done[key] ? method[key] ?? 'manual' : 'manual');
  const cost = (key: string) => Math.max(0, Number(costValues[key]) || 0);
  const problem =
    kind === 'intercrop' && !second ? 'Intercropping is only available for Nigeria and Tanzania' :
    pos.lat === undefined ? 'Click your field on the map' :
    inArea === false ? 'The chosen spot is outside the supported area; pick a point inside the green area' :
    !(Number(size) > 0) ? 'Enter the field size' :
    dateProblem(planting, harvest) ??
    (!(Number(rootPrice) > 0) ? 'Enter the cassava root price per tonne' : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setRunning(true);
    setError(null);
    try {
      const request = {
        compute_request: {
          farmInformation: { country_code: country.code, use_case: info.useCase, map_lat: pos.lat, map_long: pos.lon, field_size: Number(size), area_unit: unit },
          planting: { planting_date: planting, harvest_date: harvest, planting_date_window: plantingWindow, harvest_date_window: harvestWindow },
          cassava: { unit_price: Number(rootPrice), unit_weight: 1000 },
          yieldInfo: { current_field_yield: yieldClass },
          recommendations: { lang: 'en', ...info.flags },
          ...(kind === 'intercrop' && second ? {
            interCropping: { inter_cropped_crop: second.key, inter_cropping_maize_rec: second.key === 'maize', inter_cropping_potato_rec: second.key === 'potato' },
          } : {}),
          ...(kind === 'practices' ? {
            // What is done now, how (the API takes "manual" or "tractor"), and which operations use a tractor
            operationsDone: { ploughing_done: !!done.ploughing, harrowing_done: !!done.harrowing, ridging_done: !!done.ridging },
            methods: {
              method_ploughing: methodOf('ploughing'),
              method_harrowing: methodOf('harrowing'),
              method_ridging: methodOf('ridging'),
            },
            tractorCosts: {
              tractor_plough: !!done.ploughing && methodOf('ploughing') === 'tractor',
              tractor_harrow: !!done.harrowing && methodOf('harrowing') === 'tractor',
              tractor_ridger: !!done.ridging && methodOf('ridging') === 'tractor',
              cost_lmo_area_basis: 'areaUnit', // the costs are per the field's own area unit
              cost_tractor_ploughing: cost('tractorPloughing'),
              cost_tractor_harrowing: cost('tractorHarrowing'),
              cost_tractor_ridging: cost('tractorRidging'),
            },
            manualCosts: {
              cost_manual_ploughing: cost('manualPloughing'),
              cost_manual_harrowing: cost('manualHarrowing'),
              cost_manual_ridging: cost('manualRidging'),
            },
            weedingCosts: { cost_weeding_one: cost('weedingOne'), cost_weeding_two: cost('weedingTwo') },
          } : {}),
        },
        fertilizer_list: [],
      };
      const result = await call('compute_recommendations', request);
      const saved: GuidedEntry = {
        action: kind, country: country.code, tool: 'compute_recommendations', request, result,
        title: `${info.title}${second ? ` (${second.crop})` : ''}: ${Number(size)} ${unit} in ${country.name}`,
      };
      setEntry(saved);
      record(saved);
    } catch (err) {
      setError(message(err));
    } finally {
      setRunning(false);
    }
  };

  if (entry) {
    return (
      <>
        <h2 className="h5">{info.title}</h2>
        <div className="mb-3"><AdviceResult entry={entry} /></div>
        <button type="button" className="btn btn-outline-success btn-sm" onClick={() => setEntry(null)}>Change my answers</button>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto" style={{ maxWidth: '44rem' }}>
      <h2 className="h5 mb-1">{info.title} in {country.name}{second ? `: cassava with ${second.crop}` : ''}</h2>
      <p className="small text-body-secondary mb-3">{info.text}</p>
      {kind === 'intercrop' && !second && (
        <div className="alert alert-info small">Intercropping advice is available for Nigeria (maize) and Tanzania (sweet potato) only. Choose one of them above.</div>
      )}
      <Loading state={price} />
      {(kind !== 'intercrop' || second) && (
        <div className="d-flex flex-column gap-4">
          <section>
            <h3 className="h6">1. Where is your field?</h3>
            <MapPicker lat={pos.lat} lon={pos.lon} country={country.code} onChange={(lat, lon) => setPos({ lat, lon })} onCoverage={setInArea} />
          </section>

          <section>
            <h3 className="h6">2. How big is it, and what yield do you get?</h3>
            <div className="input-group mb-3" style={{ maxWidth: '16rem' }}>
              <input type="number" min="0" step="any" className="form-control" aria-label="Field size" value={size} onChange={e => setSize(e.target.value)} />
              <select className="form-select" aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>
                {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div style={{ maxWidth: '24rem' }}><YieldSelect id={`a-yield-${kind}`} value={yieldClass} onChange={setYieldClass} /></div>
          </section>

          <section>
            <h3 className="h6">3. When will you plant and harvest?</h3>
            <div className="row g-2">
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor={`a-plant-${kind}`}>Planting date</label>
                <input id={`a-plant-${kind}`} type="date" className="form-control" value={planting} min={plantingMin()} onChange={e => setPlanting(e.target.value)} /></div>
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor={`a-harvest-${kind}`}>Harvest date</label>
                <input id={`a-harvest-${kind}`} type="date" className="form-control" value={harvest} min={harvestLimits.min} max={harvestLimits.max}
                  onChange={e => setHarvest(e.target.value)} /></div>
            </div>
            <div className="form-text">Planting up to 6 months back; harvest 8 to 12 months after planting (cassava is usually harvested 10 to 12).</div>
            {(
              <div className="row g-2 mt-1">
                <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="a-pw">Could you plant earlier or later by up to</label>
                  <select id="a-pw" className="form-select" value={plantingWindow} onChange={e => setPlantingWindow(Number(e.target.value))}>
                    {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                  </select></div>
                <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="a-hw">Could you harvest earlier or later by up to</label>
                  <select id="a-hw" className="form-select" value={harvestWindow} onChange={e => setHarvestWindow(Number(e.target.value))}>
                    {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                  </select></div>
              </div>
            )}
          </section>

          <section>
            <h3 className="h6">4. What do you get for your cassava?</h3>
            <div className="input-group" style={{ maxWidth: '20rem' }}>
              <input type="number" min="0" step="any" className="form-control" aria-label="Cassava root price per tonne" value={rootPrice} onChange={e => setRootPrice(e.target.value)} />
              <span className="input-group-text">{price.data?.currency ?? ''} per tonne</span>
            </div>
            <div className="form-text">The typical price for {country.name} is filled in when there is one; change it if yours is different.</div>
          </section>

          {kind === 'practices' && (
            <section>
              <h3 className="h6">5. What do you do on this field now?</h3>
              <div className="d-flex flex-column gap-2">
                {OPERATIONS.map(({ key, text }) => (
                  <div key={key} className={`border rounded p-2 d-flex align-items-center gap-2 ${done[key] ? 'border-success bg-success-subtle' : ''}`}>
                    <div className="form-check mb-0 flex-grow-1">
                      <input id={`a-op-${key}`} className="form-check-input" type="checkbox" checked={!!done[key]} onChange={e => setDone(prev => ({ ...prev, [key]: e.target.checked }))} />
                      <label className="form-check-label" htmlFor={`a-op-${key}`}>{text}</label>
                    </div>
                    {done[key] && (
                      <select className="form-select form-select-sm w-auto" aria-label={`How do you do ${text.toLowerCase()}?`} value={method[key] ?? 'manual'}
                        onChange={e => setMethod(prev => ({ ...prev, [key]: e.target.value as Method }))}>
                        <option value="manual">By hand (manual)</option>
                        <option value="tractor">With a tractor</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>
              <div className="form-text">Tick what you do now and say whether it is done by hand or with a tractor. Your answer is compared with the other options. Leave all unticked if you do none of them.</div>
            </section>
          )}

          {kind === 'practices' && (
            <section>
              <h3 className="h6">6. What do these cost per {unit}?</h3>
              {!defaultCosts.loading && defaultCosts.data === null && (
                <div className="alert alert-info small">Typical costs could not be loaded. Enter your own costs; without them the advice is less reliable.</div>
              )}
              {defaultCosts.data && !defaultCosts.data.available && (
                <div className="alert alert-info small">AKILIMO has no standard costs for {country.name}. Enter your own costs; without them AKILIMO may not be able to give planting practices advice.</div>
              )}
              {defaultCosts.data?.available && (
                <div className="form-text mb-2 mt-0">Typical costs from AKILIMO are filled in. Change them to what you pay; leave a field empty if you do not know it.</div>
              )}
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th /><th>By hand</th><th>With a tractor</th></tr></thead>
                  <tbody>
                    {([['Ploughing', 'manualPloughing', 'tractorPloughing'], ['Harrowing', 'manualHarrowing', 'tractorHarrowing'], ['Ridging', 'manualRidging', 'tractorRidging']] as const).map(([text, manualKey, tractorKey]) => (
                      <tr key={text}>
                        <td className="small">{text}</td>
                        <td><CostInput label={`${text} by hand`} value={costValues[manualKey]} onChange={v => setCostValues(p => ({ ...p, [manualKey]: v }))} /></td>
                        <td><CostInput label={`${text} with a tractor`} value={costValues[tractorKey]} onChange={v => setCostValues(p => ({ ...p, [tractorKey]: v }))} /></td>
                      </tr>
                    ))}
                    {([['First weeding', 'weedingOne'], ['Second weeding', 'weedingTwo']] as const).map(([text, key]) => (
                      <tr key={key}>
                        <td className="small">{text}</td>
                        <td colSpan={2}><CostInput label={text} value={costValues[key]} onChange={v => setCostValues(p => ({ ...p, [key]: v }))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {defaultCosts.loading && <div className="small text-body-secondary d-flex align-items-center gap-1 mt-1"><Loader2 size={14} className="spin" /> Loading typical costs…</div>}
            </section>
          )}

          {error && <div className="alert alert-danger small mb-0" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
          <div className="d-flex align-items-center gap-3 pb-2">
            <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-2" disabled={!!problem || running}>
              {running ? <Loader2 size={16} className="spin" /> : ADVICE_ICONS[kind]} Get advice
            </button>
            {problem && !running && <span className="small text-body-secondary">{problem}</span>}
            {running && <span className="small text-body-secondary">This can take up to a minute…</span>}
          </div>
        </div>
      )}
    </form>
  );
};

// ── results ─────────────────────────────────────────────────────────────────────────────────────

interface Answer { data?: { rec_type?: string; recommendation?: string; data?: unknown } }

export const AdviceResult: React.FC<{ entry: GuidedEntry }> = ({ entry }) => {
  const answer = (entry.result ?? {}) as Answer;
  const rows = Array.isArray(answer.data?.data) ? (answer.data!.data as Row[]) : [];
  const text = answer.data?.recommendation;
  const notice = !Array.isArray(answer.data?.data) && typeof (answer.data?.data as Row | undefined)?.message === 'string'
    ? String((answer.data!.data as Row).message) : null;
  const request = entry.request as { compute_request?: { farmInformation?: Row; planting?: Row } } | undefined;
  const farm = request?.compute_request?.farmInformation;
  const planting = request?.compute_request?.planting;

  return (
    <>
      {farm && (
        <div className="small text-body-secondary mb-2">
          {String(farm.field_size)} {String(farm.area_unit)} at {String(farm.map_lat)}, {String(farm.map_long)}
          {planting ? ` · plant ${String(planting.planting_date)}, harvest ${String(planting.harvest_date)}` : ''}
        </div>
      )}
      {notice && <div className="alert alert-info small">{notice}</div>}
      {text && (
        <div className="card mb-3 border-success"><div className="card-body">
          {text.split('\n').filter(Boolean).map((line, i) => <p key={i} className="mb-1">{line}</p>)}
        </div></div>
      )}
      {entry.action === 'practices' && rows.length > 0 && <PracticesTable rows={rows} country={entry.country} />}
      {entry.action === 'schedule' && rows.length > 0 && <ScheduleTable rows={rows} country={entry.country} />}
      {entry.action === 'intercrop' && rows.length > 0 && <div className="card"><div className="card-body"><Value value={rows} /></div></div>}
      {!text && !notice && <div className="card"><div className="card-body"><Value value={entry.result} /></div></div>}
    </>
  );
};

const method = (m: unknown) => (!m || m === 'N/A' || m === 'NA' ? '–' : String(m).charAt(0).toUpperCase() + String(m).slice(1).toLowerCase());

const PracticesTable: React.FC<{ rows: Row[]; country: string }> = ({ rows, country }) => (
  <div className="table-responsive">
    <table className="table table-sm table-striped small align-middle">
      <thead><tr><th>Operations</th><th>Method</th><th className="text-end">Cost</th><th className="text-end">Net revenue</th><th className="text-end">Change</th><th /></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{[r.ploughing && 'Plough', r.ridging && 'Ridge', r.harrowing && 'Harrow'].filter(Boolean).join(' + ') || 'None'}</td>
            <td>{method(r.method_ploughing)} / {method(r.method_ridging)}</td>
            <td className="text-end">{fmt(r.TC, country)}</td>
            <td className="text-end">{fmt(r.NR, country)}</td>
            <td className={`text-end ${Number(r.dNR) >= 0 ? 'text-success' : 'text-danger'}`}>{Number(r.dNR) > 0 ? '+' : ''}{fmt(r.dNR, country)}</td>
            <td>{r.CP ? <span className="badge text-bg-secondary">Your current</span> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ScheduleTable: React.FC<{ rows: Row[]; country: string }> = ({ rows, country }) => {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  const best = rows[0]!;
  return (
    <>
      <div className="card mb-3"><div className="card-body">
        <div className="small text-body-secondary">Best dates</div>
        <div className="fs-5 fw-semibold text-akilimo">Plant {fmtDate(best.PD)} <span className="text-body-secondary">→</span> harvest {fmtDate(best.HD)}</div>
        <div className="small">Expected income {fmt(best.GR, country)}{Number(best.dGR) !== 0 ? ` (${Number(best.dGR) > 0 ? '+' : ''}${fmt(best.dGR, country)} compared with your dates)` : ''}</div>
      </div></div>
      <div className="table-responsive">
        <table className="table table-sm table-striped small align-middle">
          <thead><tr><th>Plant</th><th>Harvest</th><th>Planting shift</th><th>Harvest shift</th><th className="text-end">Income</th><th className="text-end">Change</th><th /></tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td className="text-nowrap">{fmtDate(r.PD)}</td>
                <td className="text-nowrap">{fmtDate(r.HD)}</td>
                <td>{weeks(Number(r.rPWnr))}</td>
                <td>{weeks(Number(r.rHWnr))}</td>
                <td className="text-end">{fmt(r.GR, country)}</td>
                <td className={`text-end ${Number(r.dGR) >= 0 ? 'text-success' : 'text-danger'}`}>{Number(r.dGR) > 0 ? '+' : ''}{fmt(r.dGR, country)}</td>
                <td>{r.CP ? <span className="badge text-bg-secondary">Your dates</span> : i === 0 ? <span className="badge text-bg-success">Best</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${rows.length} options`}</button>
      )}
    </>
  );
};
