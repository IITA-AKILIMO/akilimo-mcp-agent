import { countryFrom, countryInput, currencyOf, middle, type Row } from "./advisory.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// ── get_market_options ──────────────────────────────────────────────────────

// Starch prices are a snapshot kept by hand in the API (no history), so say how old they are
const STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const marketOptionsTool: ToolDefinition = {
  name: "get_market_options",
  description: "Where a farmer can sell cassava roots in a country: the open (direct) market, with price bands and a typical price per tonne, and the starch factories that buy roots, each with its price classes (price per tonne by starch content of the roots) and price range. Also says how old the starch prices are (they are a snapshot, not a trend). A factory's key goes into compute_request.yieldInfo as starch_factory_name with sell_to_starch_factory true. Note that for recommendations the compute service uses the HIGHEST price class of the chosen factory, which assumes roots with a high starch content, so it can overstate the income of a farmer whose roots have less starch.",
  inputSchema: countryInput,

  async handler(args, api) {
    const country = countryFrom(args);

    const [market, factories, prices] = await Promise.all([
      api.getAll<Row>(`/v1/cassava-prices/country/${country}`),
      api.getAll<Row>(`/v1/starch-factories/country/${country}`).catch(() => ({ data: [] as Row[] })),
      api.getAll<Row>("/v1/starch-prices").catch(() => ({ data: [] as Row[] })),
    ]);

    const currency = currencyOf(market.data.find((p) => p.currency));
    const bands = market.data
      .filter((p) => !p.exact_price && Number(p.average_price) > 0)
      .map((p) => ({ min: Number(p.min_local_price), max: Number(p.max_local_price), average: Number(p.average_price) }))
      .sort((a, b) => a.average - b.average);
    const typical = middle(bands.map((b) => b.average));

    const listed = factories.data.filter((f) => f.factory_active !== false && f.factory_name && f.factory_name !== "NA");
    const countryPrices = prices.data.filter((p) => String(p.country ?? "").toUpperCase() === country);

    const starchFactories = listed.map((f) => {
      const classes = countryPrices
        .filter((p) => p.starch_factory === f.factory_name)
        .map((p) => ({ class: Number(p.class), min_starch_percent: Number(p.min_starch), starch_range: String(p.range_starch ?? ""), price_per_tonne: Number(p.price) }))
        .filter((c) => Number.isFinite(c.price_per_tonne) && c.price_per_tonne > 0)
        .sort((a, b) => b.min_starch_percent - a.min_starch_percent);
      const values = classes.map((c) => c.price_per_tonne);
      const max = values.length ? Math.max(...values) : null;
      const min = values.length ? Math.min(...values) : null;
      return {
        key: String(f.factory_name),
        name: String(f.factory_label ?? f.factory_name),
        // One class (or none that depends on starch) means a flat price
        flat_price: classes.length <= 1 || new Set(values).size === 1,
        price_classes: classes,
        lowest_price_per_tonne: min,
        highest_price_per_tonne: max,
        // How the best price compares with the typical open-market price, in percent
        highest_vs_open_market_percent: max !== null && typical ? Math.round(((max - typical) / typical) * 100) : null,
      };
    }).filter((f) => f.price_classes.length > 0);

    // The newest update among the starch prices of this country's factories
    const updated = countryPrices.map((p) => Date.parse(String(p.updated_at ?? ""))).filter(Number.isFinite);
    const newest = updated.length ? Math.max(...updated) : null;
    const ageDays = newest === null ? null : Math.floor((Date.now() - newest) / DAY_MS);

    return jsonResult({
      country,
      currency,
      unit: "tonne (1000 kg) of fresh roots",
      open_market: { price_bands: bands, typical_price_per_tonne: typical },
      starch_factories: starchFactories,
      starch_prices_as_of: newest === null ? null : new Date(newest).toISOString().slice(0, 10),
      starch_prices_age_days: ageDays,
      starch_prices_stale: ageDays !== null && ageDays > STALE_DAYS,
      notes: [
        "Prices are a snapshot, not a forecast: AKILIMO has no price history, so there is no trend or outlook.",
        starchFactories.length === 0 ? `No starch factories are listed for ${country}; only the open market is available.` : "A factory pays by the starch content of the roots; the highest class needs a high starch content.",
      ],
    });
  },
};
