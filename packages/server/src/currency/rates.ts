// Prevailing exchange rates, for converting prices to a country's local currency and for the dollar
// sanity check on costs. The default source is the open ExchangeRate-API endpoint, which needs no key,
// is updated once a day and covers the African currencies AKILIMO uses; EXCHANGE_RATE_URL can point
// to another source with the same JSON shape ({ result, rates: { CODE: perUSD }, time_last_update_utc }).
const SOURCE_URL = () => process.env.EXCHANGE_RATE_URL?.trim() || "https://open.er-api.com/v6/latest/USD";
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface Rates {
  perUsd: Record<string, number>; // units of each currency for one US dollar
  asOf: string | null; // when the source last updated them (ISO date)
  source: string;
}

let cached: { at: number; rates: Rates } | null = null;

export async function getRates(): Promise<Rates> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rates;
  const url = SOURCE_URL();
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The exchange rate service answered ${res.status}`);
  const body = (await res.json()) as { result?: string; rates?: Record<string, unknown>; time_last_update_utc?: string };
  if (body.result && body.result !== "success") throw new Error("The exchange rate service did not return rates");
  const perUsd = Object.fromEntries(
    Object.entries(body.rates ?? {}).flatMap(([code, rate]) => (typeof rate === "number" && rate > 0 ? [[code.toUpperCase(), rate]] : [])),
  );
  if (Object.keys(perUsd).length === 0) throw new Error("The exchange rate service returned no rates");
  const updated = body.time_last_update_utc ? new Date(body.time_last_update_utc) : null;
  const rates: Rates = {
    perUsd: { ...perUsd, USD: 1 },
    asOf: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString().slice(0, 10) : null,
    source: new URL(url).hostname,
  };
  cached = { at: Date.now(), rates };
  return rates;
}

export interface Conversion { amount: number; from: string; to: string; converted: number; rate: number; asOf: string | null; source: string }

// amount in `from` expressed in `to`, through the dollar
export async function convert(amount: number, from: string, to: string): Promise<Conversion> {
  const rates = await getRates();
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const fromRate = rates.perUsd[f];
  const toRate = rates.perUsd[t];
  if (!fromRate) throw new Error(`No exchange rate for ${f}`);
  if (!toRate) throw new Error(`No exchange rate for ${t}`);
  const rate = toRate / fromRate;
  const converted = amount * rate;
  return {
    amount,
    from: f,
    to: t,
    converted: Math.round(converted * 100) / 100,
    rate: Math.round(rate * 1e6) / 1e6,
    asOf: rates.asOf,
    source: rates.source,
  };
}
