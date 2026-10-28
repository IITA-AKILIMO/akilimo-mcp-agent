import React, { useEffect, useMemo, useState } from 'react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ArrowLeft, Banknote, ChevronRight, Leaf, Loader2, Sprout, Store } from 'lucide-react';
import type { Country, Crop } from '@akilimo/shared';
import { planBags } from '@akilimo/shared';
import type { ServerState } from '../mcp/useMcpServers';
import { findCountry } from '@akilimo/shared';
import { useCountries } from '../mcp/countries';
import type { GuidedEntry } from '../mcp/guided';
import { ADVICE, ADVICE_ICONS, AdviceResult, AdviceScreen, intercropCrop, type AdviceKind } from './AdviceScreens';
import {
  Loading, CassavaPriceInput, PriceHint, RiskSelect, SellSelect, WINDOWS, YieldSelect, dateProblem, harvestRange, message, money, monthsFromNow, plantingMin, useLoad, windowLabel,
  type Call, type FertilizerData, type MarketOptions, type PriceData, type Record_, type Row,
} from './GuidedParts';
import { MapPicker } from './MapPicker';

// Guided mode: the same questions the AI chat answers, but asked with buttons and a short form and
// answered straight from the AKILIMO tools, so it works with no AI provider at all.
interface Props {
  country: Country | undefined;
  // The crop chosen in the selector; one without recommendations only gets the price screens
  crop?: Crop | undefined;
  servers: Record<string, ServerState>;
  callTool: (server: string, name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  // Called once for every finished step, so the session can be saved to the history
  onRecord?: (entry: GuidedEntry) => void;
  // A saved session being viewed again (read-only); null in normal use
  replay?: GuidedEntry[] | null;
  onLeaveReplay?: () => void;
}

// ── the panel ───────────────────────────────────────────────────────────────────────────────────

type Screen = 'menu' | 'price' | 'fertilizers' | 'recommend' | 'market' | AdviceKind;

// Records a finished step once, when its data first arrives (a ref keeps React's double effects from saving it twice)
function useRecordOnce<T>(data: T | undefined, record: Record_, build: (data: T) => GuidedEntry) {
  const done = React.useRef<T | undefined>(undefined);
  useEffect(() => {
    if (data === undefined || done.current === data) return;
    done.current = data;
    record(build(data));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const GuidedPanel: React.FC<Props> = ({ country, crop, servers, callTool, onRecord, replay, onLeaveReplay }) => {
  const [screen, setScreen] = useState<Screen>('menu');
  const record: Record_ = entry => onRecord?.(entry);

  // The server that offers the AKILIMO tools (normally akilimo-1.0)
  const serverId = useMemo(
    () => Object.entries(servers).find(([, s]) => s.status === 'connected' && s.tools.some(t => t.name === 'get_cassava_price'))?.[0],
    [servers],
  );

  // Several servers can offer the AKILIMO tools (for example a hosted copy of an older version), and a
  // newer tool exists on only some of them: call the tool on a server that really lists it
  const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    const target = Object.entries(servers).find(([, s]) => s.status === 'connected' && s.tools.some(t => t.name === name))?.[0];
    if (!target) throw new Error(serverId ? `No connected AKILIMO server offers the tool ${name}` : 'The AKILIMO server is not connected yet');
    const result = await callTool(target, name, args);
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
      {screen === 'menu' && <Menu country={country} crop={crop} onPick={setScreen} />}
      {screen === 'price' && <PriceScreen country={country} call={call} record={record} />}
      {screen === 'market' && <MarketScreen country={country} call={call} record={record} />}
      {screen === 'fertilizers' && <FertilizerScreen country={country} call={call} record={record} />}
      {screen === 'recommend' && <RecommendScreen country={country} call={call} record={record} />}
      {(screen === 'practices' || screen === 'schedule' || screen === 'intercrop') && (
        <AdviceScreen key={screen} kind={screen} country={country} call={call} record={record} />
      )}
    </div>
  );
};

const Menu: React.FC<{ country: Country; crop?: Crop | undefined; onPick: (s: Screen) => void }> = ({ country, crop, onPick }) => {
  const adviceReady = crop?.advice_available !== false;
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
    { screen: 'market', icon: <Store size={22} />, title: 'Where to sell', text: `Compare the open market with the starch factories in ${country.name}.` },
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
      {adviceReady
        ? group('Advice for your field', advice)
        : <div className="alert alert-info small">Recommendations for {crop?.name} are not available yet. The price screens below still work.</div>}
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

// Where to sell: the open market next to each starch factory, with how old the factory prices are
const MarketView: React.FC<{ d: MarketOptions }> = ({ d }) => {
  const cur = d.currency ?? '';
  const open = d.open_market.typical_price_per_tonne;
  const asOf = d.starch_prices_as_of ? new Date(`${d.starch_prices_as_of}T00:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return (
    <>
      <div className="card mb-3"><div className="card-body">
        <div className="small text-body-secondary">Open market, typical price</div>
        {open !== null
          ? <div className="fs-3 fw-semibold text-akilimo">{money(open)} <span className="fs-6 text-body-secondary">{cur} per tonne of roots</span></div>
          : <div className="text-body-secondary">There is no published open-market price for this country; ask local buyers.</div>}
        {d.open_market.price_bands.length > 0 && (
          <div className="small text-body-secondary mt-1">Bands: {d.open_market.price_bands.map(b => `${money(b.min)} to ${money(b.max)}`).join('; ')}</div>
        )}
      </div></div>

      {d.starch_factories.length === 0
        ? <div className="alert alert-info small">No starch factories are listed for this country, so the open market is the option shown.</div>
        : (
          <>
            <h3 className="h6">Starch factories</h3>
            <div className="table-responsive">
              <table className="table table-sm small align-middle">
                <thead><tr><th>Factory</th><th className="text-end">Price per tonne ({cur})</th><th className="text-end">Best price vs open market</th></tr></thead>
                <tbody>
                  {d.starch_factories.map(f => (
                    <tr key={f.key}>
                      <td className="fw-semibold">{f.name}</td>
                      <td className="text-end">{f.flat_price ? money(f.highest_price_per_tonne) : `${money(f.lowest_price_per_tonne)} to ${money(f.highest_price_per_tonne)}`}</td>
                      <td className={`text-end ${(f.highest_vs_open_market_percent ?? 0) < 0 ? 'text-danger' : 'text-success'}`}>
                        {f.highest_vs_open_market_percent === null ? '–' : `${f.highest_vs_open_market_percent > 0 ? '+' : ''}${f.highest_vs_open_market_percent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.starch_factories.some(f => !f.flat_price) && (
              <details className="small mb-3">
                <summary className="text-body-secondary">Price by starch content of the roots</summary>
                <div className="d-flex flex-column gap-2 mt-2">
                  {d.starch_factories.filter(f => !f.flat_price).map(f => (
                    <div key={f.key}>
                      <div className="fw-semibold">{f.name}</div>
                      <table className="table table-sm small mb-0">
                        <thead><tr><th>Starch content</th><th className="text-end">Price per tonne ({cur})</th></tr></thead>
                        <tbody>{f.price_classes.map(c => <tr key={c.class}><td>{c.starch_range || `${c.min_starch_percent}%+`}</td><td className="text-end">{money(c.price_per_tonne)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

      {d.starch_prices_as_of && (
        <div className={`alert small ${d.starch_prices_stale ? 'alert-warning' : 'alert-light border'}`}>
          Starch factory prices as of {asOf}{d.starch_prices_age_days !== null ? ` (${d.starch_prices_age_days} days ago)` : ''}.
          {d.starch_prices_stale ? ' They may be out of date; confirm with the factory before you decide.' : ''}
        </div>
      )}
      <div className="form-text">
        A factory pays by the starch content of your roots, so the best price needs roots with a lot of starch. These are prices as they stand, not a forecast. When you pick a factory in the advice forms, the advice assumes its highest price.
      </div>
    </>
  );
};

const MarketScreen: React.FC<{ country: Country; call: Call; record: Record_ }> = ({ country, call, record }) => {
  const request = { countryCode: country.code };
  const state = useLoad(() => call<MarketOptions>('get_market_options', request), [country.code]);
  useRecordOnce(state.data, record, result => ({
    action: 'market', country: country.code, title: `Where to sell in ${country.name}`, tool: 'get_market_options', request, result,
  }));
  return (
    <>
      <h2 className="h5">Where to sell in {country.name}</h2>
      <Loading state={state} />
      {state.data && <MarketView d={state.data} />}
    </>
  );
};
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
const ReplayPanel: React.FC<{ entries: GuidedEntry[]; onLeave: () => void }> = ({ entries, onLeave }) => {
  const { countries } = useCountries();
  return (
  <div className="card-body overflow-auto min-h-0">
    <div className="d-flex align-items-center gap-2 mb-3">
      <button type="button" className="btn btn-sm btn-outline-success" onClick={onLeave}>Continue from the menu</button>
      <span className="small text-body-secondary">Saved session, {entries.length} step{entries.length === 1 ? '' : 's'}</span>
    </div>
    {entries.length === 0 && <div className="alert alert-info small">This session has no saved steps.</div>}
    <div className="d-flex flex-column gap-4">
      {entries.map((e, i) => {
        const country = findCountry(countries, e.country);
        return (
          <section key={i}>
            <h2 className="h6 mb-2">{e.title}</h2>
            {e.action === 'price' && country && <PriceView country={country} d={e.result as PriceData} />}
            {e.action === 'fertilizers' && country && <FertilizerView country={country} d={e.result as FertilizerData} />}
            {e.action === 'market' && <MarketView d={e.result as MarketOptions} />}
            {e.action === 'recommend' && <RecommendationResult entry={e} />}
            {(e.action === 'practices' || e.action === 'schedule' || e.action === 'intercrop') && <AdviceResult entry={e} />}
          </section>
        );
      })}
    </div>
  </div>
  );
};

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
      <FertilizerSummary entry={entry} />
      <BagPlan entry={entry} />
    </>
  );
};

// The compute answer as a message and a table of plain-language figures instead of the raw fields
const FertilizerSummary: React.FC<{ entry: GuidedEntry }> = ({ entry }) => {
  const data = (entry.result as { data?: { recommendation?: string; data?: unknown } } | undefined)?.data;
  const row = Array.isArray(data?.data) ? (data.data[0] as Row | undefined) : undefined;
  const num = (key: string) => (typeof row?.[key] === 'number' ? (row[key] as number) : null);
  const current = num('CurrentY');
  const target = num('TargetY');
  const fixed = (n: number | null, digits = 1) => (n === null ? null : n.toLocaleString(undefined, { maximumFractionDigits: digits }));
  const rows: [string, string | null][] = [
    ['Yield now', current === null ? null : `${fixed(current)} t/ha`],
    ['Yield with the advice', target === null ? null : `${fixed(target)} t/ha`],
    ['Extra yield', current !== null && target !== null ? `${fixed(target - current)} t/ha` : null],
    ['Best possible yield (rain and sun limited)', num('WLY') === null ? null : `${fixed(num('WLY'))} t/ha`],
    ['Fertilizer needed (nitrogen, phosphorus, potassium)', num('N') === null && num('P') === null && num('K') === null ? null : `${fixed(num('N') ?? 0, 0)} / ${fixed(num('P') ?? 0, 0)} / ${fixed(num('K') ?? 0, 0)} kg/ha`],
    ['Fertilizer cost', num('TC') === null ? null : money(Math.round(num('TC') as number))],
    ['Extra income after fertilizer cost', num('NR') === null ? null : money(Math.round(num('NR') as number))],
  ];
  const shown = rows.filter((r): r is [string, string] => r[1] !== null);
  return (
    <>
      {data?.recommendation && (
        <div className="card mb-3 border-success"><div className="card-body">
          {data.recommendation.split('\n').filter(Boolean).map((line, i) => <p key={i} className="mb-1">{line}</p>)}
        </div></div>
      )}
      {shown.length > 0 && (
        <table className="table table-sm table-striped small mb-3">
          <thead><tr><th>What</th><th className="text-end">Value</th></tr></thead>
          <tbody>{shown.map(([k, v]) => <tr key={k}><td>{k}</td><td className="text-end fw-semibold">{v}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
};

// The recommended kilograms as bags to buy and what they cost, from the same rules the compute service uses
// (rounded to half bags). Worked out from the saved request and answer, so a replayed session shows it too.
const BagPlan: React.FC<{ entry: GuidedEntry }> = ({ entry }) => {
  const request = entry.request as { fertilizer_list?: Row[] } | undefined;
  const data = (entry.result as { data?: { fertilizer_rates?: unknown } } | undefined)?.data;
  const rates = Array.isArray(data?.fertilizer_rates)
    ? (data.fertilizer_rates as Row[]).map(r => ({ type: String(r.type ?? ''), rate: Number(r.rate) })).filter(r => r.type && r.rate > 0)
    : [];
  const options = (request?.fertilizer_list ?? []).filter(f => f.selected).map(f => ({
    type: String(f.fertilizer_type), name: String(f.name), key: String(f.key), bagWeightKg: Number(f.weight), pricePerBag: Number(f.price) > 0 ? Number(f.price) : null,
  }));
  if (rates.length === 0 || options.length === 0) return null;
  const plan = planBags(rates, options);
  if (plan.lines.length === 0) return null;
  return (
    <div className="card mb-2"><div className="card-body">
      <h3 className="h6">What to buy</h3>
      <table className="table table-sm small mb-1">
        <thead><tr><th>Fertilizer</th><th className="text-end">Amount (kg)</th><th className="text-end">Bags</th><th className="text-end">Cost</th></tr></thead>
        <tbody>
          {plan.lines.map(l => (
            <tr key={l.type}><td>{l.name ?? l.type}</td><td className="text-end">{money(l.rate_kg)}</td><td className="text-end">{l.bags}</td><td className="text-end">{l.cost !== null ? money(Math.round(l.cost)) : '–'}</td></tr>
          ))}
        </tbody>
        {plan.total_cost !== null && <tfoot><tr className="fw-semibold"><td colSpan={3}>Total</td><td className="text-end">{money(Math.round(plan.total_cost))}</td></tr></tfoot>}
      </table>
      <div className="form-text">Bags are rounded to the nearest half bag; the cost uses the exact amount at your prices.</div>
    </div></div>
  );
};
const AREA_UNITS = ['acre', 'ha', 'm2', 'are'];

interface InvestmentData { currency: string | null; options: { amount_per_unit: number; max_investment_for_field?: number }[] }

const RecommendScreen: React.FC<{ country: Country; call: Call; record: Record_ }> = ({ country, call, record }) => {
  const options = useLoad(async () => {
    const [fertilizers, price] = await Promise.all([
      call<FertilizerData>('get_fertilizer_options', { countryCode: country.code }),
      call<PriceData>('get_cassava_price', { countryCode: country.code }),
    ]);
    return { fertilizers, price };
  }, [country.code]);

  const [pos, setPos] = useState<{ lat?: number; lon?: number }>({});
  const [inArea, setInArea] = useState<boolean | null>(null); // is the picked spot inside the supported area
  const [size, setSize] = useState('1');
  const [unit, setUnit] = useState('acre');
  const [planting, setPlanting] = useState(monthsFromNow(1));
  const [harvest, setHarvest] = useState(monthsFromNow(11));
  const [rootPrice, setRootPrice] = useState('');
  const [yieldClass, setYieldClass] = useState(11.25); // t/ha class sent as yieldInfo.current_field_yield
  const [risk, setRisk] = useState(1); // user_info.risk_attitude
  const [factory, setFactory] = useState(''); // starch factory key, or '' for the open market
  const [sellUnit, setSellUnit] = useState(1000); // the unit the cassava price is quoted in, in kg (the API's cassava units)
  const [plantingWindow, setPlantingWindow] = useState(1);
  const [harvestWindow, setHarvestWindow] = useState(1);
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

  // The budget choices, as totals for the whole field (maxInvestment is for the field; 0 means no limit).
  // Older servers lack the tool: then the question is simply not asked.
  const [budgetOptions, setBudgetOptions] = useState<InvestmentData | null>(null);
  const [budget, setBudget] = useState('0');
  useEffect(() => {
    if (!(Number(size) > 0)) return;
    let live = true;
    const timer = setTimeout(() => {
      call<InvestmentData>('get_investment_options', { countryCode: country.code, fieldSize: Number(size), areaUnit: unit })
        .then(d => { if (live) { setBudgetOptions(d); setBudget('0'); } }, () => live && setBudgetOptions(null));
    }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [country.code, size, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = loaded?.fertilizers.fertilizers.filter(f => selected[f.key]) ?? [];
  const problem =
    pos.lat === undefined ? 'Click your field on the map' :
    inArea === false ? 'The chosen spot is outside the supported area; pick a point inside the green area' :
    !(Number(size) > 0) ? 'Enter the field size' :
    dateProblem(planting, harvest) ??
    (!(Number(rootPrice) > 0) ? 'Enter the cassava root price' :
    chosen.length === 0 ? 'Select at least one fertilizer you can buy' :
    chosen.some(f => !(Number(prices[f.key]) > 0)) ? 'Enter a price for each selected fertilizer' : null);
  const harvestLimits = harvestRange(planting);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !loaded) return;
    setRunning(true);
    setError(null);
    try {
      const request = {
        compute_request: {
          farmInformation: { country_code: country.code, use_case: 'FR', map_lat: pos.lat, map_long: pos.lon, field_size: Number(size), area_unit: unit },
          planting: { planting_date: planting, harvest_date: harvest, planting_date_window: plantingWindow, harvest_date_window: harvestWindow },
          cassava: { unit_price: Number(rootPrice), unit_weight: sellUnit },
          yieldInfo: { current_field_yield: yieldClass, ...(factory ? { sell_to_starch_factory: true, starch_factory_name: factory } : {}) },
          ...(Number(budget) > 0 ? { maxInvestment: Number(budget) } : {}),
          recommendations: { lang: 'en' },
        },
        user_info: { risk_attitude: risk },
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
            <div style={{ maxWidth: '24rem' }}><YieldSelect id="g-yield" value={yieldClass} onChange={setYieldClass} /></div>`n            <div className="mt-3" style={{ maxWidth: '30rem' }}><RiskSelect id="g-risk" value={risk} onChange={setRisk} /></div>
          </section>

          <section>
            <h3 className="h6">3. When will you plant and harvest?</h3>
            <div className="row g-2">
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-plant">Planting date</label>
                <input id="g-plant" type="date" className="form-control" value={planting} min={plantingMin()} onChange={e => setPlanting(e.target.value)} /></div>
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-harvest">Harvest date</label>
                <input id="g-harvest" type="date" className="form-control" value={harvest} min={harvestLimits.min} max={harvestLimits.max}
                  onChange={e => setHarvest(e.target.value)} /></div>
            </div>
            <div className="row g-2 mt-1">
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-pw">Could you plant earlier or later by up to</label>
                <select id="g-pw" className="form-select" value={plantingWindow} onChange={e => setPlantingWindow(Number(e.target.value))}>
                  {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                </select></div>
              <div className="col-sm-6"><label className="form-label small mb-1" htmlFor="g-hw">Could you harvest earlier or later by up to</label>
                <select id="g-hw" className="form-select" value={harvestWindow} onChange={e => setHarvestWindow(Number(e.target.value))}>
                  {WINDOWS.map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
                </select></div>
            </div>
            <div className="form-text">Planting up to 6 months back; harvest 8 to 12 months after planting (cassava is usually harvested 10 to 12).</div>
          </section>

          <section>
            <h3 className="h6">4. What do you get for your cassava?</h3>
            <CassavaPriceInput id="g-price" call={call} country={country.code} currency={currency} price={rootPrice} unit={sellUnit}
              onChange={(price, unit) => { setRootPrice(price); setSellUnit(unit); }} />
            <SellSelect id="g-sell" call={call} country={country.code} value={factory} onChange={key => setFactory(key)} />
            <div className="form-text">We filled in the typical price for {country.name}; change it if yours is different.</div>
          </section>

          {budgetOptions && budgetOptions.options.length > 0 && (
            <section>
              <h3 className="h6">How much can you spend on fertilizer for the whole field?</h3>
              <select className="form-select" style={{ maxWidth: '24rem' }} aria-label="Fertilizer budget for the whole field" value={budget} onChange={e => setBudget(e.target.value)}>
                <option value="0">No limit</option>
                {budgetOptions.options.map(o => o.max_investment_for_field !== undefined && (
                  <option key={o.amount_per_unit} value={o.max_investment_for_field}>
                    Up to {money(o.max_investment_for_field)} {budgetOptions.currency ?? ''}
                  </option>
                ))}
              </select>
              <div className="form-text">The recommendation will stay within this budget for the {size} {unit}.</div>
            </section>
          )}

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
                  <div>
                    <div className="input-group input-group-sm" style={{ maxWidth: '11rem' }}>
                      <input type="number" min="0" step="any" className="form-control" aria-label={`${f.name} price per bag`} value={prices[f.key] ?? ''}
                        onChange={e => setPrices(prev => ({ ...prev, [f.key]: e.target.value }))} />
                      <span className="input-group-text">{currency}</span>
                    </div>
                    {selected[f.key] && <PriceHint call={call} country={country.code} item="fertilizer" fertilizerKey={f.key} value={prices[f.key] ?? ''} />}
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
