import { fetchCountries } from "../countries/list.js";
import { getRates } from "../currency/rates.js";
import type { AkilimoApiClient } from "../api/client.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// Compact, model-friendly views of the reference data needed for fertilizer advice. The raw
// endpoints return tens of kilobytes per country, which overflows small local models.

export type Row = Record<string, any>;

export const countryInput = {
  type: "object" as const,
  properties: {
    countryCode: { type: "string", description: "ISO 2-letter code of a supported country (the list comes from get_countries)" },
  },
  required: ["countryCode"],
};

export const countryFrom = (args: Record<string, unknown> | undefined) => {
  const code = String(args?.countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("countryCode must be an ISO 2-letter code, e.g. NG or TZ");
  return code;
};

// Price lists hold bands plus 0 / negative placeholder rows (no price, custom price)
export const priceBands = (values: unknown[]) =>
  [...new Set(values.map(Number).filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
export const middle = (values: number[]) => (values.length ? values[Math.floor(values.length / 2)] : null);
export const currencyOf = (row?: Row) => row?.currency?.currency_code ?? row?.currency_code ?? null;

export const fertilizerOptionsTool: ToolDefinition = {
  name: "get_fertilizer_options",
  description: "List the fertilizers available in a country with bag weight, price bands per bag and a typical price. Use it to build fertilizer_list for compute_recommendations.",
  inputSchema: countryInput,

  async handler(args, api) {
    const country = countryFrom(args);
    const [fertilizers, prices] = await Promise.all([
      api.getAll<Row>(`/v1/fertilizers/country/${country}`),
      api.getAll<Row>(`/v1/fertilizer-prices/country/${country}`),
    ]);

    const options = fertilizers.data
      .filter((f) => f.available !== false)
      .map((f) => {
        const bands = priceBands(prices.data.filter((p) => p.fertilizer_key === f.fertilizer_key).map((p) => p.price_per_bag));
        return {
          key: f.fertilizer_key,
          name: f.name,
          fertilizer_type: f.type,
          bag_weight_kg: f.weight,
          price_bands_per_bag: bands,
          typical_price_per_bag: middle(bands),
        };
      });

    return jsonResult({
      country,
      currency: currencyOf(prices.data[0]) ?? currencyOf(fertilizers.data[0]),
      fertilizers: options,
      usage: "For compute_recommendations fertilizer_list use key, name, fertilizer_type, bag_weight_kg as weight, a price per bag, and selected true for fertilizers the farmer can buy.",
    });
  },
};

export const checkLocationTool: ToolDefinition = {
  name: "check_location",
  description: "Check whether a location is inside the area where AKILIMO can give recommendations for a country. Call it before compute_recommendations as soon as you have the coordinates, so a location outside the area is caught early. covered is true (inside), false (outside: tell the user and ask for another location) or null (unknown: carry on).",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "ISO 2-letter code of a supported country (the list comes from get_countries)" },
      lat: { type: "number", description: "Latitude in decimal degrees" },
      lon: { type: "number", description: "Longitude in decimal degrees" },
    },
    required: ["countryCode", "lat", "lon"],
  },

  async handler(args, api) {
    const country = countryFrom(args);
    const lat = Number(args?.lat);
    const lon = Number(args?.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error("lat must be between -90 and 90 and lon between -180 and 180");
    }

    try {
      const { data } = await api.get<{ data: Row }>("/v1/coverage/check", { country, lat, lon });
      return jsonResult(data);
    } catch (error) {
      // An API without the supported-area routes (or a network hiccup) must not stop the conversation
      return jsonResult({ country_code: country, lat, lon, covered: null, message: `The location could not be checked (${(error as Error).message})` });
    }
  },
};

// default-prices rows use the legacy code BU for Burundi
const DEFAULT_PRICE_COUNTRY: Record<string, string> = { BI: "BU" };

// The sanity check on prices (is this cost per acre believable in dollars?) uses the prevailing exchange
// rate of the country's currency (currency/rates.ts); only when that cannot be read are these approximate
// rates used, so refresh them when they drift. Tanzanian prices look huge (the shilling is weak) but are fine
// in dollars.
const USD_RATE_FALLBACK: Record<string, number> = { NG: 1500, TZ: 2600, RW: 1450, GH: 12, BI: 2900 };
const PLAUSIBLE_USD_PER_ACRE = { min: 0.5, max: 150 };

// Local currency per US dollar for a country: live, else the approximate fallback, else null
const usdRate = async (country: string, api: AkilimoApiClient): Promise<number | null> => {
  try {
    const currency = (await fetchCountries(api)).find((c) => c.code === country)?.currency;
    const live = currency ? (await getRates()).perUsd[currency] : undefined;
    if (live) return live;
  } catch { /* use the fallback */ }
  return USD_RATE_FALLBACK[country] ?? null;
};
const usdOf = (rate: number | null, value: number) => (rate ? Math.round((value / rate) * 100) / 100 : null);
const plausible = (rate: number | null, value: number) => {
  const usd = usdOf(rate, value);
  return usd === null || (usd >= PLAUSIBLE_USD_PER_ACRE.min && usd <= PLAUSIBLE_USD_PER_ACRE.max);
};

// Costs per acre the compute service itself falls back to when a cost is missing or 0
// (default_lmo_costs in akilimo-recommendations, R/AkilimoMain.R); used when the API's default price
// is missing or implausible in dollars. Keep in step with that file.
const BASELINE_COSTS: Record<string, Record<string, number>> = {
  NG: { manual_ploughing: 17000, manual_harrowing: 15000, manual_ridging: 12000, tractor_ploughing: 6000, tractor_harrowing: 6000, tractor_ridging: 6000, weeding1: 30000, weeding2: 30000 },
  TZ: { manual_ploughing: 175000, manual_harrowing: 150000, manual_ridging: 225000, tractor_ploughing: 150000, tractor_harrowing: 100000, tractor_ridging: 115000, weeding1: 60000, weeding2: 45000 },
};

export const operationCostsTool: ToolDefinition = {
  name: "get_operation_costs",
  description: "Typical costs of land preparation and weeding for a country, ready to use as compute_recommendations manualCosts, tractorCosts and weedingCosts for planting practices advice. Each cost is the API's default price when it is believable in US dollars (about 0.5 to 150 per acre), otherwise the compute service's own default, otherwise the middle band of the country's operation costs; a cost is null when none exists (Rwanda, Ghana and Burundi have none). Each cost comes with its source and an approximate dollar value. Costs are per the field's area unit.",
  inputSchema: countryInput,

  async handler(args, api) {
    const country = countryFrom(args);
    const rate = await usdRate(country, api);
    const [defaults, bands] = await Promise.all([
      api.getAll<Row>("/v1/default-prices"),
      api.getAll<Row>(`/v1/operation-costs/country/${country}`),
    ]);

    const defaultPrice = (item: string) => {
      const row = defaults.data.find((r) => r.country === (DEFAULT_PRICE_COUNTRY[country] ?? country) && r.item === item);
      const price = Number(row?.price);
      return Number.isFinite(price) && price > 0 ? price : null;
    };
    // Bands are 5 steps per operation and method; the middle one is the typical cost
    const typicalBand = (name: string, type: string) =>
      middle(priceBands(bands.data.filter((r) => r.operation_name === name && r.operation_type === type).map((r) => r.average_cost)));

    // The API's default price if believable in dollars, else the compute service's own default, else
    // the middle operation-cost band; each with an approximate dollar value for a quick sanity read
    const pick = (item: string, name: string | null, type: string | null) => {
      const result = (value: number | null, source: string | null) => ({ value, source, approx_usd: value === null ? null : usdOf(rate, value) });
      const fromDefault = defaultPrice(item);
      if (fromDefault !== null && plausible(rate, fromDefault)) return result(fromDefault, "default_price");
      const baseline = BASELINE_COSTS[country]?.[item];
      if (baseline !== undefined) return result(baseline, "service_default");
      const fromBand = (name && type ? typicalBand(name, type) : null) ?? null;
      return fromBand !== null && plausible(rate, fromBand) ? result(fromBand, "typical_band") : result(null, null);
    };

    const costs = {
      manual: {
        ploughing: pick("manual_ploughing", "TILLAGE", "MANUAL"),
        harrowing: pick("manual_harrowing", null, null),
        ridging: pick("manual_ridging", "RIDGING", "MANUAL"),
      },
      tractor: {
        ploughing: pick("tractor_ploughing", "TILLAGE", "TRACTOR"),
        harrowing: pick("tractor_harrowing", null, null),
        ridging: pick("tractor_ridging", "RIDGING", "TRACTOR"),
      },
      weeding: {
        one: pick("weeding1", "WEEDING", "MANUAL"),
        two: pick("weeding2", "WEEDING", "MANUAL"),
      },
    };
    const available = Object.values(costs).some((group) => Object.values(group).some((c) => c.value !== null));

    return jsonResult({
      country,
      available,
      costs,
      usage: "For compute_recommendations planting practices: manualCosts {cost_manual_ploughing, cost_manual_harrowing, cost_manual_ridging}, tractorCosts {cost_tractor_ploughing, cost_tractor_harrowing, cost_tractor_ridging, cost_lmo_area_basis 'areaUnit'} and weedingCosts {cost_weeding_one, cost_weeding_two}. Use 0 for a null cost, or ask the farmer. Let the farmer correct the values.",
    });
  },
};

export const cassavaPriceTool: ToolDefinition = {
  name: "get_cassava_price",
  description: "Get cassava root price bands per tonne and a typical price for a country. Use the typical price as compute_recommendations cassava.unit_price (unit_weight 1000) when the farmer does not know their price.",
  inputSchema: countryInput,

  async handler(args, api) {
    const country = countryFrom(args);
    const { data } = await api.getAll<Row>(`/v1/cassava-prices/country/${country}`);
    const bands = data
      .filter((p) => !p.exact_price && Number(p.average_price) > 0)
      .map((p) => ({ min: Number(p.min_local_price), max: Number(p.max_local_price), average: Number(p.average_price) }))
      .sort((a, b) => a.average - b.average);

    return jsonResult({
      country,
      currency: currencyOf(data.find((p) => p.currency)),
      unit: "tonne (1000 kg) of fresh roots",
      price_bands: bands,
      typical_price_per_tonne: middle(bands.map((b) => b.average)),
    });
  },
};
