import { jsonResult, type ToolDefinition } from "./types.js";

// Compact, model-friendly views of the reference data needed for fertilizer advice. The raw
// endpoints return tens of kilobytes per country, which overflows small local models.

type Row = Record<string, any>;

const countryInput = {
  type: "object" as const,
  properties: {
    countryCode: { type: "string", description: "ISO 2-letter country code: NG, TZ, RW, GH or BI" },
  },
  required: ["countryCode"],
};

const countryFrom = (args: Record<string, unknown> | undefined) => {
  const code = String(args?.countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("countryCode must be an ISO 2-letter code, e.g. NG or TZ");
  return code;
};

// Price lists hold bands plus 0 / negative placeholder rows (no price, custom price)
const priceBands = (values: unknown[]) =>
  [...new Set(values.map(Number).filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
const middle = (values: number[]) => (values.length ? values[Math.floor(values.length / 2)] : null);
const currencyOf = (row?: Row) => row?.currency?.currency_code ?? row?.currency_code ?? null;

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
