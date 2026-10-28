import { jsonResult, type ToolDefinition } from "./types.js";

// Reference data endpoints of the Akilimo API, and which of them accept /country/{code}
export const REFERENCE_CATEGORIES = [
  'countries', 'currencies', 'fertilizers', 'fertilizer-prices', 'investment-amounts',
  'operation-costs', 'starch-factories', 'starch-prices', 'default-prices', 'cassava-units',
  'cassava-prices', 'potato-prices', 'maize-prices', 'crops',
];
export const COUNTRY_FILTERABLE = [
  'fertilizers', 'fertilizer-prices', 'investment-amounts', 'operation-costs',
  'starch-factories', 'cassava-prices', 'potato-prices', 'maize-prices', 'crops',
];

export const referenceDataTool: ToolDefinition = {
  name: "get_reference_data",
  description: "Fetch public agricultural reference data from the Akilimo API (countries, currencies, fertilizers, prices, costs, starch factories, etc.)",
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "The category of data to fetch",
        enum: REFERENCE_CATEGORIES,
      },
      countryCode: {
        type: "string",
        description: `Optional ISO 2-letter country code. Only supported for: ${COUNTRY_FILTERABLE.join(', ')}`,
      },
    },
    required: ["category"],
  },

  async handler(args, api) {
    const category = args?.category as string;
    const countryCode = (args?.countryCode as string | undefined)?.trim().toUpperCase();

    if (!REFERENCE_CATEGORIES.includes(category)) {
      throw new Error(`Unknown category '${category}'. Use one of: ${REFERENCE_CATEGORIES.join(', ')}`);
    }
    if (countryCode && !COUNTRY_FILTERABLE.includes(category)) {
      throw new Error(`Category '${category}' cannot be filtered by country; omit countryCode. Country filtering works for: ${COUNTRY_FILTERABLE.join(', ')}`);
    }

    let url = `/v1/${category}`;
    if (countryCode) {
      url = `/v1/${category}/country/${encodeURIComponent(countryCode)}`;
    }

    return jsonResult(await api.getAll(url));
  },
};
