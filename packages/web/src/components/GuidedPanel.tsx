import React, { useEffect, useMemo, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ArrowLeft, Banknote, ChevronRight, Leaf, Loader2, Sprout } from 'lucide-react';
import type { Country } from '@akilimo/shared';
import type { ServerState } from '../mcp/useMcpServers';
import { COUNTRIES } from '@akilimo/shared';
import type { GuidedEntry } from '../mcp/guided';
import { ADVICE, ADVICE_ICONS, AdviceResult, AdviceScreen, intercropCrop, type AdviceKind } from './AdviceScreens';
import {
  Loading, Value, message, money, monthsFromNow, useLoad,
  type Call, type FertilizerData, type PriceData, type Record_, type Row,
} from './GuidedParts';
import { MapPicker } from './MapPicker';

// Guided mode: the same questions the AI chat answers, but asked with buttons and a short form and
// answered straight from the AKILIMO tools, so it works with no AI provider at all.
interface Props {
  country: Country | undefined;
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  // Called once for every finished step, so the session can be saved to the history
  onRecord?: (entry: GuidedEntry) => void;
  // A saved session being viewed again (read-only); null in normal use
  replay?: GuidedEntry[] | null;
  onLeaveReplay?: () => void;
}

// ── the panel ───────────────────────────────────────────────────────────────────────────────────

type Screen = 'menu' | 'price' | 'fertilizers' | 'recommend' | AdviceKind;

// Records a finished step once, when its data first arrives (a ref keeps React's double effects from saving it twice)
function useRecordOnce<T>(data: T | undefined, record: Record_, build: (data: T) => GuidedEntry) {
  const done = React.useRef<T | undefined>(undefined);
  useEffect(() => {
    if (data === undefined || done.current === data) return;
    done.current = data;
    record(build(data));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const GuidedPanel: React.FC<Props> = ({ country, servers, callTool, onRecord, replay, onLeaveReplay }) => {
  const [screen, setScreen] = useState<Screen>('menu');
  const record: Record_ = entry => onRecord?.(entry);

  // The server that offers the AKILIMO tools (normally akilimo-1.0)
  const serverId = useMemo(
    () => Object.entries(servers).find(([, s]) => s.status === 'connected' && s.tools.some(t => t.name === 'get_cassava_price'))?.[0],
    [servers],
  );

  const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    if (!serverId) throw new Error('The AKILIMO server is not connected yet');
    const result = await callTool(serverId, name, args);
    const text = result.content.find(c => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(text || `${name} failed`);
    return JSON.parse(text) as T;
  };

  // Back to the menu when the country changes, so nothing stale is shown
  useEffect(() => setScreen('menu'), [country?.code]);

  if (replay) return <ReplayPanel entries={replay} onLeave={() => onLeaveReplay?.()} />;

  if (!country) {
    return <div className="card-body d-flex align-items-center justify-content-center text-body-secondary">Choose your country above to start.</div>;
  }
  if (!serverId) {
    return (
      <div className="card-body d-flex align-items-center justify-content-center gap-2 text-body-secondary">
        <Loader2 size={16} className="spin" /> Connecting to the AKILIMO server… switch it on in the MCP servers panel if this persists.
      </div>
    );
  }

  return (
    <div className="card-body overflow-auto min-h-0">
      {screen !== 'menu' && (
        <button type="button" className="btn btn-sm btn-link text-decoration-none p-0 mb-3 d-inline-flex align-items-center gap-1" onClick={() => setScreen('menu')}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {screen === 'menu' && <Menu country={country} onPick={setScreen} />}
      {screen === 'price' && <PriceScreen country={country} call={call} record={record} />}
      {screen === 'fertilizers' && <FertilizerScreen country={country} call={call} record={record} />}
      {screen === 'recommend' && <RecommendScreen country={country} call={call} record={record} />}
      {(screen === 'practices' || screen === 'schedule' || screen === 'intercrop') && (
        <AdviceScreen key={screen} kind={screen} country={country} call={call} record={record} />
      )}
    </div>
  );
};

const Menu: React.FC<{ country: Country; onPick: (s: Screen) => void }> = ({ country, onPick }) => {
  type Option = { screen: Screen; icon: React.ReactNode; title: string; text: string };
  const intercrop = intercropCrop(country.code);
  const advice: Option[] = [
    { screen: 'recommend', icon: <Sprout size={22} />, title: 'Fertilizer recommendation', text: `Which fertilizer to use on your field in ${country.name}, and how much.` },
    { screen: 'practices', icon: ADVICE_ICONS.practices, title: ADVICE.practices.title, text: ADVICE.practices.text },
    { screen: 'schedule', icon: ADVICE_ICONS.schedule, title: ADVICE.schedule.title, text: ADVICE.schedule.text },
    {
      screen: 'intercrop', icon: ADVICE_ICONS.intercrop, title: ADVICE.intercrop.title,
      text: intercrop ? `Would growing ${intercrop.crop} between your cassava pay off?` : 'Available for Nigeria (maize) and Tanzania (sweet potato) only.',
    },
  ];
  const prices: Option[] = [
    { screen: 'fertilizers', icon: <Leaf size={22} />, title: 'Fertilizers and their prices', text: `See which fertilizers are available in ${country.name} and what a bag costs.` },
    { screen: 'price', icon: <Banknote size={22} />, title: 'Cassava root price', text: `See typical cassava prices per tonne in ${country.name}.` },
  ];
  const group = (heading: string, options: Option[]) => (
    <section className="mb-4">
      <h3 className="h6 text-body-secondary mb-2">{heading}</h3>
      <div className="d-flex flex-column gap-2">
        {options.map(o => (
          <button key={o.screen} type="button" className="btn btn-outline-success text-start d-flex align-items-center gap-3 p-3" onClick={() => onPick(o.screen)}>
            <span className="flex-shrink-0">{o.icon}</span>
            <span className="flex-grow-1"><span className="d-block fw-semibold">{o.title}</span><span className="d-block small text-body-secondary">{o.text}</span></span>
            <ChevronRight size={18} className="flex-shrink-0" />
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div className="mx-auto" style={{ maxWidth: '40rem' }}>
      <h2 className="h5 mb-1">What would you like to do?</h2>
      <p className="small text-body-secondary mb-3">Answers come straight from AKILIMO, with no AI model needed.</p>
      {group('Advice for your field', advice)}
      {group('Prices', prices)}
    </div>
  );
};

const PriceView: React.FC<{ country: Country; d: PriceData }> = ({ country, d }) => (
  d.price_bands.length === 0
    ? <div className="alert alert-info small">There are no published cassava prices for {country.name} yet.</div>
    : (
      <>
        <div className="card mb-3"><div className="card-body">
          <div className="small text-body-secondary">Typical price</div>
          <div className="fs-3 fw-semibold text-akilimo">{money(d.typical_price_per_tonne)} <span className="fs-6 text-body-secondary">{d.currency} per tonne</span></div>
        </div></div>
        <table className="table table-sm small">
          <thead><tr><th>Price band ({d.currency} per tonne)</th><th className="text-end">Average</th></tr></thead>
          <tbody>{d.price_bands.map((b, i) => <tr key={i}><td>{money(b.min)} – {money(b.max)}</td><td className="text-end">{money(b.average)}</td></tr>)}</tbody>
        </table>
        <div className="form-text">Fresh roots, per tonne (1000 kg). Source: AKILIMO.</div>
      </>
    )
);

const PriceScreen: React.FC<{ country: Country; call: Call; record: Record_ }> = ({ country, call, record }) => {
  const request = { countryCode: country.code };
  const state = useLoad(() => call<PriceData>('get_cassava_price', request), [country.code]);
  useRecordOnce(state.data, record, result => ({
    action: 'price', country: country.code, title: `Cassava price in ${country.name}`, tool: 'get_cassava_price', request, result,
  }));
  return (
    <>
      <h2 className="h5">Cassava root price in {country.name}</h2>
      <Loading state={state} />
      {state.data && <PriceView country={country} d={state.data} />}
    </>
  );
};

const FertilizerView: React.FC<{ country: Country; d: FertilizerData }> = ({ country, d }) => (
  d.fertilizers.length === 0
    ? <div className="alert alert-info small">No fertilizers are listed for {country.name} yet.</div>
    : (
      <div className="table-responsive">
        <table className="table table-sm table-striped small align-middle">
          <thead><tr><th>Fertilizer</th><th>Type</th><th className="text-end">Bag (kg)</th><th className="text-end">Typical price per bag ({d.currency})</th></tr></thead>
          <tbody>
            {d.fertilizers.map(f => (
              <tr key={f.key}>
                <td className="fw-semibold">{f.name}</td>
                <td>{f.fertilizer_type}</td>
                <td className="text-end">{f.bag_weight_kg}</td>
                <td className="text-end">{f.typical_price_per_bag !== null ? money(f.typical_price_per_bag) : <span className="text-body-secondary">no price yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
);

const FertilizerScreen: React.FC<{ country: Country; call: Call; record: Record_ }> = ({ country, call, record }) => {
  const request = { countryCode: country.code };
  const state = useLoad(() => call<FertilizerData>('get_fertilizer_options', request), [country.code]);
  useRecordOnce(state.data, record, result => ({
    action: 'fertilizers', country: country.code, title: `Fertilizers in ${country.name}`, tool: 'get_fertilizer_options', request, result,
  }));
  return (
    <>
      <h2 className="h5">Fertilizers in {country.name}</h2>
      <Loading state={state} />
      {state.data && <FertilizerView country={country} d={state.data} />}
    </>
  );
};

// A saved session shown again: every step in order, read-only, straight from what was saved
const ReplayPanel: React.FC<{ entries: GuidedEntry[]; onLeave: () => void }> = ({ entries, onLeave }) => (
  <div className="card-body overflow-auto min-h-0">
    <div className="d-flex align-items-center gap-2 mb-3">
      <button type="button" className="btn btn-sm btn-outline-success" onClick={onLeave}>Continue from the menu</button>
      <span className="small text-body-secondary">Saved session, {entries.length} step{entries.length === 1 ? '' : 's'}</span>
    </div>
    {entries.length === 0 && <div className="alert alert-info small">This session has no saved steps.</div>}
    <div className="d-flex flex-column gap-4">
      {entries.map((e, i) => {
        const country = COUNTRIES.find(c => c.code === e.country);
        return (
          <section key={i}>
            <h2 className="h6 mb-2">{e.title}</h2>
            {e.action === 'price' && country && <PriceView country={country} d={e.result as PriceData} />}
            {e.action === 'fertilizers' && country && <FertilizerView country={country} d={e.result as FertilizerData} />}
            {e.action === 'recommend' && <RecommendationResult entry={e} />}
            {(e.action === 'practices' || e.action === 'schedule' || e.action === 'intercrop') && <AdviceResult entry={e} />}
          </section>
        );
      })}
    </div>
  </div>
);

// What the farmer entered, then the answer
const RecommendationResult: React.FC<{ entry: GuidedEntry }> = ({ entry }) => {
  const request = entry.request as { compute_request?: { farmInformation?: Row; planting?: Row; cassava?: Row }; fertilizer_list?: Row[] } | undefined;
  const farm = request?.compute_request?.farmInformation;
  const planting = request?.compute_request?.planting;
  const chosen = (request?.fertilizer_list ?? []).filter(f => f.selected).map(f => String(f.name));
  return (
    <>
      {farm && (
        <div className="small text-body-secondary mb-2">
          {String(farm.field_size)} {String(farm.area_unit)} at {String(farm.map_lat)}, {String(farm.map_long)}
          {planting ? ` · plant ${String(planting.planting_date)}, harvest ${String(planting.harvest_date)}` : ''}
          {chosen.length ? ` · fertilizers: ${chosen.join(', ')}` : ''}
        </div>
      )}
      <div className="card"><div className="card-body"><Value value={entry.result} /></div></div>
    </>
  );
};
const AREA_UNITS = ['acre', 'ha', 'm2', 'are'];

const RecommendScreen: React.FC<{ country: Country; call: Call; record: Record_ }> = ({ country, call, record }) => {
  const options = useLoad(async () => {
    const [fertilizers, price] = await Promise.all([
      call<FertilizerData>('get_fertilizer_options', { countryCode: country.code }),
      call<PriceData>('get_cassava_price', { countryCode: country.code }),
    ]);
    return { fertilizers, price };
  }, [country.code]);

  const [pos, setPos] = useState<{ lat?: number; lon?: number }>({});
  const [size, setSize] = useState('1');
  const [unit, setUnit] = useState('acre');
  const [planting, setPlanting] = useState(monthsFromNow(1));
  const [harvest, setHarvest] = useState(monthsFromNow(11));
  const [rootPrice, setRootPrice] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<GuidedEntry | null>(null);

  // Prefill the prices with the typical ones once they are loaded
  const loaded = options.data;
  useEffect(() => {
    if (!loaded) return;
    setRootPrice(loaded.price.typical_price_per_tonne !== null ? String(loaded.price.typical_price_per_tonne) : '');
    setPrices(Object.fromEntries(loaded.fertilizers.fertilizers.map(f => [f.key, f.typical_price_per_bag !== null ? String(f.typical_price_per_bag) : ''])));
    setSelected({});
  }, [loaded]);

  const chosen = loaded?.fertilizers.fertilizers.filter(f => selected[f.key]) ?? [];
  const problem =
    pos.lat === undefined ? 'Click your field on the map' :
    !(Number(size) > 0) ? 'Enter the field size' :
    !planting || !harvest || harvest <= planting ? 'The harvest date must be after the planting date' :
    !(Number(rootPrice) > 0) ? 'Enter the cassava root price per tonne' :
    chosen.length === 0 ? 'Select at least one fertilizer you can buy' :
    chosen.some(f => !(Number(prices[f.key]) > 0)) ? 'Enter a price for each selected fertilizer' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !loaded) return;
    setRunning(true);
    setError(null);
    try {
      const request = {
        compute_request: {
          farmInformation: { country_code: country.code, use_case: 'FR', map_lat: pos.lat, map_long: pos.lon, field_size: Number(size), area_unit: unit },
          planting: { planting_date: planting, harvest_date: harvest },
          cassava: { unit_price: Number(rootPrice), unit_weight: 1000 },
          recommendations: { lang: 'en' },
        },
        fertilizer_list: loaded.fertilizers.fertilizers.map(f => ({
          key: f.key, name: f.name, fertilizer_type: f.fertilizer_type, weight: f.bag_weight_kg,
          price: Number(prices[f.key]) || 0, selected: !!selected[f.key],
        })),
      };
      const result = await call('compute_recommendations', request);
      const entry: GuidedEntry = {
        action: 'recommend', country: country.code, tool: 'compute_recommendations', request, result,
        title: `Fertilizer recommendation: ${Number(size)} ${unit} in ${country.name}`,
      };
      setDone(entry);
      record(entry);
    } catch (err) {
      setError(message(err));
    } finally {
      setRunning(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="h5">Your recommendation</h2>
        <div className="mb-3"><RecommendationResult entry={done} /></div>
        <button type="button" className="btn btn-outline-success btn-sm" onClick={() => setDone(null)}>Change my answers</button>
      </>
    );
  }

  const currency = loaded?.fertilizers.currency ?? loaded?.price.currency ?? '';
  return (
    <form onSubmit={submit} className="mx-auto" style={{ maxWidth: '44rem' }}>
      <h2 className="h5 mb-3">Fertilizer recommendation for {country.name}</h2>
      <Loading state={options} />
      {loaded && (
        <div className="d-flex flex-column gap-4">
          <section>
            <h3 className="h6">1. Where is your field?</h3>
            <MapPicker lat={pos.lat} lon={pos.lon} country={country.code} onChange={(lat, lon) => setPos({ lat, lon })} />
          </section>

          <section>
            <h3 className="h6">2. How big is it?</h3>
            <div className="input-group" style={{ maxWidth: '16rem' }}>
              <input type="number" min="0" step="any" className="form-control" aria-label="Field size" value={size} onChange={e => setSize(e.target.value)} />
              <select className="form-select" aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>
                {AREA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </section>

          <section>
            <h3 className="h6">3. When will you plant and harvest?</h3>
            <div className="row g-2">
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-plant">Planting date</label>
                <input id="g-plant" type="date" className="form-control" value={planting} onChange={e => setPlanting(e.target.value)} /></div>
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-harvest">Harvest date</label>
                <input id="g-harvest" type="date" className="form-control" value={harvest} onChange={e => setHarvest(e.target.value)} /></div>
            </div>
            <div className="form-text">Not sure? Cassava is usually harvested 10 to 12 months after planting.</div>
          </section>

          <section>
            <h3 className="h6">4. What do you get for your cassava?</h3>
            <div className="input-group" style={{ maxWidth: '20rem' }}>
              <input type="number" min="0" step="any" className="form-control" aria-label="Cassava root price per tonne" value={rootPrice} onChange={e => setRootPrice(e.target.value)} />
              <span className="input-group-text">{currency} per tonne</span>
            </div>
            <div className="form-text">We filled in the typical price for {country.name}; change it if yours is different.</div>
          </section>

          <section>
            <h3 className="h6">5. Which fertilizers can you buy?</h3>
            {loaded.fertilizers.fertilizers.length === 0 && <div className="alert alert-info small">No fertilizers are listed for {country.name}.</div>}
            <div className="d-flex flex-column gap-2">
              {loaded.fertilizers.fertilizers.map(f => (
                <div key={f.key} className={`border rounded p-2 d-flex align-items-center gap-2 ${selected[f.key] ? 'border-success bg-success-subtle' : ''}`}>
                  <div className="form-check mb-0 flex-grow-1">
                    <input id={`g-f-${f.key}`} className="form-check-input" type="checkbox" checked={!!selected[f.key]}
                      onChange={e => setSelected(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                    <label className="form-check-label" htmlFor={`g-f-${f.key}`}>
                      <span className="fw-semibold">{f.name}</span> <span className="small text-body-secondary">{f.fertilizer_type} · {f.bag_weight_kg} kg bag</span>
                    </label>
                  </div>
                  <div className="input-group input-group-sm" style={{ maxWidth: '11rem' }}>
                    <input type="number" min="0" step="any" className="form-control" aria-label={`${f.name} price per bag`} value={prices[f.key] ?? ''}
                      onChange={e => setPrices(prev => ({ ...prev, [f.key]: e.target.value }))} />
                    <span className="input-group-text">{currency}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-text">Price per bag; typical prices are filled in.</div>
          </section>

          {error && <div className="alert alert-danger small mb-0" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
          <div className="d-flex align-items-center gap-3 pb-2">
            <button type="submit" className="btn btn-akilimo d-inline-flex align-items-center gap-2" disabled={!!problem || running}>
              {running ? <Loader2 size={16} className="spin" /> : <Sprout size={16} />} Get recommendation
            </button>
            {problem && !running && <span className="small text-body-secondary">{problem}</span>}
            {running && <span className="small text-body-secondary">This can take up to a minute…</span>}
          </div>
        </div>
      )}
    </form>
  );
};
