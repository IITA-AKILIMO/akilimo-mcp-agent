import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type Args = Record<string, unknown>;
type CallTool = (name: string, args: Args) => Promise<CallToolResult>;

export interface ToolPreset {
  label: string;
  description: string;
  // Why the preset cannot run yet, or null when it can
  blockedReason?: (args: Args) => string | null;
  // Returns the new arguments and an optional note telling the user what is left to do
  apply: (args: Args, callTool: CallTool) => Promise<{ args: Args; message?: string }>;
}

const isObject = (v: unknown): v is Args => typeof v === 'object' && v !== null && !Array.isArray(v);

// Adds defaults without overwriting anything the user already entered
const fillMissing = (target: Args, defaults: Args): Args => {
  const out: Args = { ...target };
  for (const [key, def] of Object.entries(defaults)) {
    if (out[key] === undefined) out[key] = def;
    else if (isObject(out[key]) && isObject(def)) out[key] = fillMissing(out[key] as Args, def);
  }
  return out;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monthsFromNow = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return isoDate(d);
};

// Reads the list from a get_reference_data result ({ data: [...] } or a bare array)
const referenceList = async (callTool: CallTool, category: string, countryCode: string): Promise<Args[]> => {
  const result = await callTool('get_reference_data', { category, countryCode });
  const text = result.content.find(c => c.type === 'text')?.text ?? '';
  if (result.isError) throw new Error(text || `Could not load ${category}`);
  const json = JSON.parse(text);
  return (Array.isArray(json) ? json : json.data) ?? [];
};

// Price lists hold bands (sort_order 1..n) plus empty or negative placeholder rows; take the middle band
const middleBand = <T,>(rows: T[], price: (row: T) => number): number | undefined => {
  const bands = rows.map(price).filter(p => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  return bands.length ? bands[Math.floor(bands.length / 2)] : undefined;
};

const countryOf = (args: Args) =>
  ((args.compute_request as Args | undefined)?.farmInformation as Args | undefined)?.country_code as string | undefined;

const computePresets: ToolPreset[] = [
  {
    label: 'Typical defaults',
    description: 'Fertilizer recommendation (FR) for a 1 acre field, planting next month and harvesting 10 months later. Keeps anything already entered.',
    apply: async (args) => ({
      args: fillMissing(args, {
        compute_request: {
          farmInformation: { use_case: 'FR', field_size: 1, area_unit: 'acre' },
          planting: { planting_date: monthsFromNow(1), harvest_date: monthsFromNow(11) },
          recommendations: { lang: 'en' },
        },
      }),
      message: 'Defaults filled in. Set the country and pick the field on the map.',
    }),
  },
  {
    label: 'Prices for country',
    description: 'Loads the country\'s available fertilizers and typical fertilizer and cassava root prices from the Akilimo 1.0 API.',
    blockedReason: (args) => (/^[A-Za-z]{2}$/.test(countryOf(args) ?? '') ? null : 'Enter the country code first'),
    apply: async (args, callTool) => {
      const country = countryOf(args)!.toUpperCase();
      const [fertilizers, fertilizerPrices, cassavaPrices] = await Promise.all([
        referenceList(callTool, 'fertilizers', country),
        referenceList(callTool, 'fertilizer-prices', country),
        referenceList(callTool, 'cassava-prices', country),
      ]);

      const fertilizer_list = fertilizers
        .filter(f => f.available !== false)
        .map(f => ({
          key: f.fertilizer_key,
          name: f.name,
          fertilizer_type: f.type,
          weight: f.weight,
          price: middleBand(fertilizerPrices.filter(p => p.fertilizer_key === f.fertilizer_key), p => Number(p.price_per_bag)) ?? 0,
          selected: false,
        }));

      const request = (args.compute_request ?? {}) as Args;
      const cassavaPrice = middleBand(cassavaPrices.filter(p => !p.exact_price), p => Number(p.average_price));
      return {
        args: {
          ...args,
          compute_request: {
            ...request,
            farmInformation: { ...(request.farmInformation as Args | undefined), country_code: country },
            cassava: {
              ...(request.cassava as Args | undefined),
              unit_weight: 1000,
              ...(cassavaPrice !== undefined ? { unit_price: cassavaPrice } : {}),
            },
          },
          fertilizer_list,
        },
        message: `Loaded ${fertilizer_list.length} fertilizers for ${country}`
          + (cassavaPrice !== undefined ? ` and a cassava price of ${cassavaPrice.toLocaleString()} per tonne` : '')
          + '. Switch on "Selected" for the fertilizers the farmer can buy and adjust prices if needed.',
      };
    },
  },
];

// Keyed by `${serverId}::${toolName}`
export const TOOL_PRESETS: Record<string, ToolPreset[]> = {
  'akilimo-1.0::compute_recommendations': computePresets,
};
