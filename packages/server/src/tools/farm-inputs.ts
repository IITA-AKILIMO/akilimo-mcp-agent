import { planBags, type FertilizerRate, type PlanFertilizer } from "@akilimo/shared";
import { countryFrom, countryInput, middle, priceBands, type Row } from "./advisory.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// Tools around what a farmer is asked for and told: crop prices for intercropping, a sanity check on
// any price they give, the budget options, and the fertilizer result turned into bags and money.

const empty = { data: [] as Row[] };

// Price lists hold bands plus placeholder rows (average_price -1 for "enter your own price")
const bandsOf = (rows: Row[]) =>
  rows
    .filter((r) => r.active !== false && !r.exact_price && Number(r.average_price) > 0)
    .map((r) => ({ min: Number(r.min_local_price), max: Number(r.max_local_price), average: Number(r.average_price) }))
    .sort((a, b) => a.average - b.average);

// The accepted range of a price list: every row repeats it, 0 or -1 meaning no limit on that side
const allowedRange = (rows: Row[]) => {
  const positive = (key: string) => rows.map((r) => Number(r[key])).find((v) => Number.isFinite(v) && v > 0) ?? null;
  return { min: positive("min_allowed_price"), max: positive("max_allowed_price") };
};

// ── get_crop_prices ─────────────────────────────────────────────────────────

export const cropPricesTool: ToolDefinition = {
  name: "get_crop_prices",
  description: "Typical prices of the second crop for intercropping advice: maize in Nigeria (fresh cobs or grain) and sweet potato in Tanzania, with price bands and a typical price, ready for compute_recommendations maize and sweetPotato (produce_type, unit_weight, unit_price). A crop is null where AKILIMO has no prices for the country. The grain unit weight (100 kg) is an assumption from the price level; let the farmer correct the price and unit.",
  inputSchema: countryInput,

  async handler(args, api) {
    const country = countryFrom(args);
    const [maize, potato] = await Promise.all([
      api.getAll<Row>(`/v1/maize-prices/country/${country}`).catch(() => empty),
      api.getAll<Row>(`/v1/potato-prices/country/${country}`).catch(() => empty),
    ]);

    // The price list says "cob"; the compute service calls it "fresh_cob"
    const maizeTypes = [
      { listed: "cob", produce_type: "fresh_cob", unit: "one fresh cob", unit_weight: 1 },
      { listed: "grain", produce_type: "grain", unit: "100 kg of dry grain (assumed)", unit_weight: 100 },
    ].map((type) => {
      const rows = maize.data.filter((r) => r.produce_type === type.listed);
      const bands = bandsOf(rows);
      return bands.length === 0 ? null : {
        produce_type: type.produce_type,
        unit: type.unit,
        unit_weight: type.unit_weight,
        price_bands: bands,
        typical_price: middle(priceBands(bands.map((b) => b.average))),
        allowed_range: allowedRange(rows),
      };
    }).filter((t) => t !== null);

    const potatoBands = bandsOf(potato.data);

    return jsonResult({
      country,
      maize: maizeTypes.length === 0 ? null : maizeTypes,
      sweet_potato: potatoBands.length === 0 ? null : {
        produce_type: "tubers",
        unit: "tonne (1000 kg) of fresh tubers",
        unit_weight: 1000,
        price_bands: potatoBands,
        typical_price: middle(priceBands(potatoBands.map((b) => b.average))),
        allowed_range: allowedRange(potato.data),
      },
      usage: "Only Nigeria (maize) and Tanzania (sweet potato) have intercropping advice. Send the chosen entry as compute_request.maize or compute_request.sweetPotato {produce_type, unit_weight, unit_price} together with interCropping.",
    });
  },
};

// ── check_price ─────────────────────────────────────────────────────────────

const PRICE_ITEMS = ["cassava", "maize_cob", "maize_grain", "sweet_potato", "fertilizer"] as const;

export const checkPriceTool: ToolDefinition = {
  name: "check_price",
  description: "Check a price the farmer gave against the range AKILIMO accepts and its typical bands, before using it. ok is true (plausible), false (outside the accepted range: say so and ask them to check the price and unit) or null (no range is known: carry on). Cassava is a price per tonne of fresh roots, fertilizer a price per bag (give fertilizerKey, e.g. UREA_NG or UREA), maize per cob or per 100 kg of grain, sweet potato per tonne.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "ISO 2-letter country code: NG, TZ, RW, GH or BI" },
      item: { type: "string", enum: [...PRICE_ITEMS], description: "What the price is for" },
      value: { type: "number", description: "The price in local currency, in the unit above" },
      fertilizerKey: { type: "string", description: "Only for item fertilizer: the fertilizer key or type, e.g. UREA_NG or UREA" },
    },
    required: ["countryCode", "item", "value"],
  },

  async handler(args, api) {
    const country = countryFrom(args);
    const item = String(args?.item ?? "") as (typeof PRICE_ITEMS)[number];
    const value = Number(args?.value);
    if (!PRICE_ITEMS.includes(item)) throw new Error(`item must be one of: ${PRICE_ITEMS.join(", ")}`);
    if (!Number.isFinite(value)) throw new Error("value must be a number");

    const rows = await priceRows(api, country, item, String(args?.fertilizerKey ?? ""));
    const range = allowedRange(rows);
    const bands = item === "fertilizer"
      ? priceBands(rows.map((r) => r.price_per_bag))
      : bandsOf(rows).map((b) => b.average);

    let ok: boolean | null = null;
    let message = "No accepted range is known for this price, so it cannot be checked.";
    if (value <= 0) {
      ok = false;
      message = "A price must be more than 0.";
    } else if (range.min !== null && value < range.min) {
      ok = false;
      message = `This price is below the lowest AKILIMO accepts (${range.min}). Check the price and the unit.`;
    } else if (range.max !== null && value > range.max) {
      ok = false;
      message = `This price is above the highest AKILIMO accepts (${range.max}). Check the price and the unit.`;
    } else if (range.min !== null || range.max !== null) {
      ok = true;
      message = "This price is within the range AKILIMO accepts.";
    }

    return jsonResult({ country_code: country, item, value, ok, accepted_range: range, typical_price: middle(bands as number[]), message });
  },
};

async function priceRows(api: Parameters<ToolDefinition["handler"]>[1], country: string, item: (typeof PRICE_ITEMS)[number], fertilizerKey: string): Promise<Row[]> {
  switch (item) {
    case "cassava":
      return (await api.getAll<Row>(`/v1/cassava-prices/country/${country}`)).data;
    case "maize_cob":
    case "maize_grain": {
      const type = item === "maize_cob" ? "cob" : "grain";
      return (await api.getAll<Row>(`/v1/maize-prices/country/${country}`)).data.filter((r) => r.produce_type === type);
    }
    case "sweet_potato":
      return (await api.getAll<Row>(`/v1/potato-prices/country/${country}`)).data;
    case "fertilizer": {
      if (!fertilizerKey.trim()) throw new Error("fertilizerKey is required for item fertilizer");
      const wanted = fertilizerKey.trim().toUpperCase();
      const rows = (await api.getAll<Row>(`/v1/fertilizer-prices/country/${country}`)).data;
      return rows.filter((r) => [String(r.fertilizer_key).toUpperCase(), `${String(r.fertilizer_key).toUpperCase().replace(/_[A-Z]{2}$/, "")}`].includes(wanted));
    }
  }
}

// ── get_investment_options ──────────────────────────────────────────────────

// Investment amounts are listed per acre (or another area unit); the budget compute takes is for the whole field
const ACRES_PER = { acre: 1, ha: 2.47105, m2: 1 / 4046.86, are: 0.0247105 } as const;

export const investmentOptionsTool: ToolDefinition = {
  name: "get_investment_options",
  description: "The budget choices AKILIMO offers a farmer for fertilizer, per area unit (normally per acre), with the currency. The compute service's maxInvestment is the farmer's budget for the WHOLE field (0 or omitted means no limit), so give fieldSize and areaUnit to get each option as a total for the field. A farmer may also name their own amount.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "ISO 2-letter country code: NG, TZ, RW, GH or BI" },
      fieldSize: { type: "number", description: "Field size, to turn the per-area amounts into totals for the field" },
      areaUnit: { type: "string", enum: Object.keys(ACRES_PER), description: "Unit of fieldSize" },
    },
    required: ["countryCode"],
  },

  async handler(args, api) {
    const country = countryFrom(args);
    const { data } = await api.getAll<Row>(`/v1/investment-amounts/country/${country}`);
    const rows = data.filter((r) => r.active !== false);

    const per = String(rows[0]?.area_unit ?? "acre").toLowerCase() as keyof typeof ACRES_PER;
    const fieldSize = Number(args?.fieldSize);
    const unit = String(args?.areaUnit ?? "").toLowerCase() as keyof typeof ACRES_PER;
    // Field size in the unit the amounts are per
    const units = Number.isFinite(fieldSize) && fieldSize > 0 && unit in ACRES_PER && per in ACRES_PER
      ? (fieldSize * ACRES_PER[unit]) / ACRES_PER[per]
      : null;

    const options = [...new Set(rows.filter((r) => !r.exact_amount && Number(r.investment_amount) > 0).map((r) => Number(r.investment_amount)))]
      .sort((a, b) => a - b)
      .map((amount) => ({ amount_per_unit: amount, ...(units === null ? {} : { max_investment_for_field: Math.round(amount * units) }) }));

    return jsonResult({
      country,
      currency: rows.find((r) => r.currency)?.currency?.currency_code ?? null,
      per_area_unit: per,
      ...(units === null ? {} : { field_size_in_that_unit: Math.round(units * 100) / 100 }),
      options,
      own_amount_allowed: rows.some((r) => r.exact_amount),
      usage: "Send the chosen total as compute_request.maxInvestment; leave it 0 for no limit.",
    });
  },
};

// ── fertilizer_plan ─────────────────────────────────────────────────────────

export const fertilizerPlanTool: ToolDefinition = {
  name: "fertilizer_plan",
  description: "Turn the fertilizer_rates of a fertilizer recommendation into what the farmer buys: for each fertilizer the kilograms for the field, the bags (to the nearest half bag), the price per bag and the cost, plus the total. The rates are kilograms for the whole field, exactly as compute_recommendations returns them (data.fertilizer_rates). Prices default to the typical price of the country; pass the prices the farmer gave to use those.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "ISO 2-letter country code: NG, TZ, RW, GH or BI" },
      fertilizerRates: {
        type: "array",
        description: "data.fertilizer_rates of the recommendation",
        items: { type: "object", properties: { type: { type: "string" }, rate: { type: "number" } }, required: ["type", "rate"] },
      },
      prices: {
        type: "array",
        description: "Optional price per bag the farmer gave, by fertilizer type",
        items: { type: "object", properties: { type: { type: "string" }, pricePerBag: { type: "number" } }, required: ["type", "pricePerBag"] },
      },
    },
    required: ["countryCode", "fertilizerRates"],
  },

  async handler(args, api) {
    const country = countryFrom(args);
    const rates = (Array.isArray(args?.fertilizerRates) ? args.fertilizerRates : [])
      .map((r: Row) => ({ type: String(r?.type ?? ""), rate: Number(r?.rate) }))
      .filter((r: FertilizerRate) => r.type && Number.isFinite(r.rate) && r.rate > 0);
    if (rates.length === 0) throw new Error("fertilizerRates needs at least one {type, rate} with a rate above 0");

    const given = new Map((Array.isArray(args?.prices) ? args.prices : []).map((p: Row) => [String(p?.type ?? "").toLowerCase(), Number(p?.pricePerBag)]));

    const [fertilizers, prices] = await Promise.all([
      api.getAll<Row>(`/v1/fertilizers/country/${country}`),
      api.getAll<Row>(`/v1/fertilizer-prices/country/${country}`),
    ]);

    const catalogue: PlanFertilizer[] = fertilizers.data.map((f) => {
      const typical = middle(priceBands(prices.data.filter((p) => p.fertilizer_key === f.fertilizer_key).map((p) => p.price_per_bag)));
      const farmers = given.get(String(f.type).toLowerCase());
      return {
        type: String(f.type),
        name: String(f.name),
        key: String(f.fertilizer_key),
        bagWeightKg: Number(f.weight),
        pricePerBag: (Number.isFinite(farmers) && (farmers as number) > 0 ? (farmers as number) : typical) ?? null,
      };
    });

    return jsonResult({ country, ...planBags(rates, catalogue), note: "Kilograms are for the whole field. A line without a price has cost null: ask the farmer for the price." });
  },
};
