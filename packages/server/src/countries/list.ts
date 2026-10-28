import { parseCountries, type Country } from "@akilimo/shared";
import type { AkilimoApiClient } from "../api/client.js";

// The supported countries, from the Akilimo API (GET /v1/countries: the active ones, in display order),
// kept for a while because they change rarely and every chat message and page load needs them. Each
// country's currency comes from its price list (the API's own currency rows are not keyed by country
// reliably), and a failure to read it only leaves the currency empty.
const CACHE_MS = 30 * 60 * 1000;
let cached: { at: number; countries: Country[] } | null = null;

export async function fetchCountries(api: AkilimoApiClient): Promise<Country[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.countries;

  const { data } = await api.getAll<Record<string, unknown>>("/v1/countries");
  const base = parseCountries(data);

  const currencies: Record<string, string> = {};
  await Promise.all(base.map(async (c) => {
    try {
      const prices = await api.getAll<Record<string, any>>(`/v1/cassava-prices/country/${c.code}`);
      const code = prices.data.find((p) => p.currency?.currency_code)?.currency.currency_code;
      if (typeof code === "string") currencies[c.code] = code;
    } catch { /* no price list yet: no currency */ }
  }));

  const countries = parseCountries(data, currencies);
  // An empty answer is not remembered, so a country list that appears later is picked up on the next request
  if (countries.length > 0) cached = { at: Date.now(), countries };
  return countries;
}
