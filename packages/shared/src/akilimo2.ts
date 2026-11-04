// Akilimo 2.0 (the hosted MCP of the Akilimo 2.0 platform) answers fertilizer questions with its tool
// `get_recommendation`. When both Akilimo 1.0 and 2.0 are switched on, a fertilizer request made for 1.0
// (`compute_recommendations`) is also put to 2.0 and the two answers are shown together. This module turns
// a 1.0 compute request into 2.0's arguments and reads 2.0's answer into the few figures worth showing.

export const AKILIMO2_TOOL = 'get_recommendation';

export interface Akilimo2Args {
  crop: string;
  lat: number;
  lon: number;
  country: string;
  context: { country: string; area: number; areaUnit: string };
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// 2.0 works from the field's place and size; it uses its own prices, so the farmer's fertilizer prices, budget,
// yield class and risk attitude are not sent. Returns null when the request has no usable location.
export function akilimo2Args(computeArgs: unknown): Akilimo2Args | null {
  const farm = object(object(object(computeArgs)?.compute_request)?.farmInformation);
  const lat = finite(farm?.map_lat);
  const lon = finite(farm?.map_long);
  const country = typeof farm?.country_code === 'string' ? farm.country_code.toUpperCase() : '';
  if (lat === undefined || lon === undefined || country.length !== 2) return null;
  const area = finite(farm?.field_size);
  const unit = typeof farm?.area_unit === 'string' ? farm.area_unit : 'ha';
  return {
    crop: 'cassava',
    lat,
    lon,
    country,
    context: { country, area: area && area > 0 ? area : 1, areaUnit: unit },
  };
}

export interface Akilimo2Summary {
  rate: { N: number | null; P: number | null; K: number | null; unit: string };
  products: { product: string; amount: number; unit: string }[];
  yield: { unit: string; mean: number | null; lower: number | null; upper: number | null; level: number | null };
  yieldWithoutFertilizer: number | null; // same unit as the yield
  economics: {
    expectedNetReturn: number | null;
    currency: string;
    probLoss: number | null;
    downsideP10: number | null;
    valueCostRatio: number | null;
    prices: string | null; // where the prices came from; 'default-placeholder' means not real local prices
  };
  reasoning: string | null;
  model: { name: string | null; version: string | null; released: boolean | null; releaseGates: string | null };
  // Plain-language warnings 2.0 raised (low confidence, outside its range, nutrient imbalance, ...)
  warnings: string[];
}

const FLAG_TEXT: Record<string, string> = {
  low_confidence: 'low confidence',
  out_of_range: 'the field is outside the range its model was built for',
  nutrient_imbalance: 'the nutrient balance check found an imbalance',
};

// The figures of a get_recommendation answer (its JSON, already parsed); null when it does not look like one
export function summarizeAkilimo2(answer: unknown): Akilimo2Summary | null {
  const root = object(answer);
  const prediction = object(root?.prediction);
  if (!root || !prediction) return null;
  const rate = object(prediction.rate);
  const yieldInfo = object(prediction.yield);
  const interval = object(yieldInfo?.interval);
  const economics = object(root.economics);
  const model = object(root.model);
  const benchmark = object(root.benchmark);
  const balance = object(root.nutrient_balance);

  const products = Array.isArray(rate?.products)
    ? rate.products.flatMap((p) => {
      const item = object(p);
      const amount = finite(item?.amount);
      return item && typeof item.product === 'string' && amount !== undefined
        ? [{ product: item.product, amount, unit: typeof item.unit === 'string' ? item.unit : 'kg/ha' }]
        : [];
    })
    : [];

  const warnings = [
    ...(Array.isArray(root.flags) ? root.flags : []).filter((f): f is string => typeof f === 'string').map((f) => FLAG_TEXT[f] ?? f.replace(/_/g, ' ')),
  ];
  if (Array.isArray(balance?.flags)) {
    for (const f of balance.flags) if (typeof f === 'string') warnings.push(f.charAt(0).toLowerCase() + f.slice(1));
  }
  if (model?.released === false) warnings.push('its model is not released yet (still being validated)');
  if (economics?.prices === 'default-placeholder') warnings.push('the money figures use placeholder prices, not real local prices');

  return {
    rate: { N: finite(rate?.N) ?? null, P: finite(rate?.P) ?? null, K: finite(rate?.K) ?? null, unit: typeof rate?.unit === 'string' ? rate.unit : 'kg/ha' },
    products,
    yield: {
      unit: typeof yieldInfo?.unit === 'string' ? yieldInfo.unit : 'kg/ha',
      mean: finite(yieldInfo?.mean) ?? null,
      lower: finite(interval?.lower) ?? null,
      upper: finite(interval?.upper) ?? null,
      level: finite(interval?.level) ?? null,
    },
    yieldWithoutFertilizer: finite(benchmark?.no_fertilizer) ?? null,
    economics: {
      expectedNetReturn: finite(economics?.expected_net_return) ?? null,
      currency: typeof economics?.currency === 'string' ? economics.currency : '',
      probLoss: finite(economics?.prob_loss) ?? null,
      downsideP10: finite(economics?.downside_p10) ?? null,
      valueCostRatio: finite(economics?.value_cost_ratio) ?? null,
      prices: typeof economics?.prices === 'string' ? economics.prices : null,
    },
    reasoning: typeof root.reasoning === 'string' ? root.reasoning : null,
    model: {
      name: typeof model?.name === 'string' ? model.name : null,
      version: typeof model?.version === 'string' ? model.version : null,
      released: typeof model?.released === 'boolean' ? model.released : null,
      releaseGates: typeof model?.release_gates === 'string' ? model.release_gates : null,
    },
    warnings: [...new Set(warnings)],
  };
}
