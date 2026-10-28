// The crops AKILIMO offers. The list lives in the Akilimo API (GET /v1/crops, managed in its admin area);
// DEFAULT_CROPS is what clients use when the API does not have the route yet or cannot be reached.
export interface Crop {
  key: string;
  name: string;
  description: string | null;
  // Whether recommendations exist for the crop; the others are listed for prices and information only
  advice_available: boolean;
  // ISO country codes where it is offered; null means every country
  countries: string[] | null;
}

export const DEFAULT_CROP_KEY = 'cassava';

export const DEFAULT_CROPS: Crop[] = [
  { key: DEFAULT_CROP_KEY, name: 'Cassava', description: 'Fertilizer, planting practices, planting and harvest dates, and intercropping advice', advice_available: true, countries: null },
];

// Reads the API's crop rows (key, name, ... as CropResource sends them) into Crop
export function parseCrops(rows: unknown): Crop[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): Crop[] => {
    const r = row as Record<string, unknown>;
    if (typeof r?.key !== 'string' || typeof r.name !== 'string') return [];
    return [{
      key: r.key,
      name: r.name,
      description: typeof r.description === 'string' ? r.description : null,
      advice_available: r.advice_available === true,
      countries: Array.isArray(r.countries) ? r.countries.filter((c): c is string => typeof c === 'string') : null,
    }];
  });
}
