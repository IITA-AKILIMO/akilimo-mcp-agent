// The countries AKILIMO gives recommendations for. The list is never written in the code: the Akilimo API
// keeps it (GET /v1/countries, the active ones, in display order), the server relays it as /api/countries
// and the web UI and the chat's instructions read it from there.
export interface Country {
  code: string; // ISO 2-letter
  name: string;
  // Centre and bounding box, for the map; null when the API does not know them
  latitude: number | null;
  longitude: number | null;
  bounds: [minLat: number, minLon: number, maxLat: number, maxLon: number] | null;
  // The currency of the country's prices (from the API's price lists), null when unknown
  currency: string | null;
}

export const findCountry = (countries: readonly Country[], code: string | null | undefined) =>
  code ? countries.find(c => c.code === code.toUpperCase()) : undefined;

// Reads the API's country rows (CountryResource) into Country, keeping only active ones with a usable code
export function parseCountries(rows: unknown, currencies: Record<string, string> = {}): Country[] {
  if (!Array.isArray(rows)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return rows.flatMap((row): Country[] => {
    const r = row as Record<string, unknown>;
    if (typeof r?.code !== 'string' || !/^[A-Za-z]{2}$/.test(r.code) || typeof r.name !== 'string' || r.active === false) return [];
    const code = r.code.toUpperCase();
    const [minLat, minLon, maxLat, maxLon] = [num(r.min_latitude), num(r.min_longitude), num(r.max_latitude), num(r.max_longitude)];
    return [{
      code,
      name: r.name,
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      bounds: minLat !== null && minLon !== null && maxLat !== null && maxLon !== null ? [minLat, minLon, maxLat, maxLon] : null,
      currency: currencies[code] ?? null,
    }];
  });
}

// Other supported countries for the comparison examples: the next ones in the list, not the country itself
export const otherCountries = (countries: readonly Country[], c: Country, count = 2) =>
  countries.filter(x => x.code !== c.code).slice(0, count);
// Intercropping advice exists for these countries only: the second crop grown between the cassava
export const INTERCROP_CROPS: Record<string, string> = { NG: 'maize', TZ: 'sweet potato' };

export type AdviceId = 'fertilizer' | 'practices' | 'schedule' | 'intercrop' | 'market';

export interface AdviceType { id: AdviceId; label: string; prompt: string }

// The kinds of advice AKILIMO gives, each with the message that starts it in the chat. Intercropping is
// listed only where it is available.
export const adviceTypes = (c: Country, cropName = 'cassava'): AdviceType[] => {
  const crop = cropName === 'cassava' ? INTERCROP_CROPS[c.code] : undefined; // a second crop between the cassava only makes sense for cassava
  return [
    { id: 'fertilizer', label: 'Fertilizer', prompt: `I would like a fertilizer recommendation for my ${cropName} field in ${c.name}.` },
    { id: 'practices', label: 'Planting practices', prompt: `I would like advice on planting practices (ploughing and ridging) for my ${cropName} field in ${c.name}.` },
    { id: 'schedule', label: 'Planting and harvest dates', prompt: `I would like advice on the best planting and harvest dates for my ${cropName} field in ${c.name}.` },
    ...(cropName === 'cassava' ? [{ id: 'market' as const, label: 'Where to sell', prompt: `Where is the best place to sell my cassava in ${c.name}: the open market or a starch factory?` }] : []),
    ...(crop ? [{ id: 'intercrop' as const, label: 'Intercropping', prompt: `I would like intercropping advice (cassava with ${crop}) for my field in ${c.name}.` }] : []),
  ];
};

export interface ExampleGroup { title: string; prompts: string[] }

// Questions that work with the AKILIMO tools alone, about the chosen crop (cassava unless told otherwise)
export const akilimoExamples = (c: Country, cropName = 'cassava', all: readonly Country[] = []): ExampleGroup[] => [
  {
    title: 'Fertilizer advice',
    prompts: [
      `I grow ${cropName} in ${c.name}. Which fertilizer should I use?`,
      `I have a 2 acre ${cropName} field in ${c.name}. I plan to plant next month. What do you recommend?`,
      `Which fertilizer would give me the best profit on 1 acre of ${cropName} in ${c.name}?`,
    ],
  },
  {
    title: 'Planting practices, dates and intercropping',
    prompts: [
      `Should I plough or ridge my ${cropName} field in ${c.name}?`,
      `When is the best time to plant and harvest ${cropName} in ${c.name}?`,
      ...(cropName === 'cassava' && INTERCROP_CROPS[c.code] ? [`Would intercropping my cassava with ${INTERCROP_CROPS[c.code]} pay off?`] : []),
    ],
  },
  {
    title: 'Fertilizers and prices',
    prompts: [
      `Which fertilizers are available in ${c.name} and what do they cost?`,
      ...(cropName === 'cassava' ? [`Should I sell my cassava to a starch factory or on the open market in ${c.name}?`] : []),
      `What is the typical ${cropName} price in ${c.name}?`,
      ...(otherCountries(all, c, 1).map(o => `How do ${cropName} prices in ${c.name} compare with ${o.name}?`)),
    ],
  },
];

// Only offered when a connected server has weather, soil or statistics tools
export const contextExamples = (c: Country, all: readonly Country[] = []): ExampleGroup => ({
  title: 'Weather, soil and country data',
  prompts: [
    `What is the rain forecast for the next week in ${c.name}?`,
    `How wet is the soil in ${c.name} right now?`,
    `What is the typical monthly rainfall in ${c.name}?`,
    ...(otherCountries(all, c).length === 2 ? [`Compare cereal yields in ${c.name}, ${otherCountries(all, c)[0]!.name} and ${otherCountries(all, c)[1]!.name}.`] : []),
  ],
});
