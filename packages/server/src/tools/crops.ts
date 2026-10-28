import { fetchCrops } from "../crops/list.js";
import { countryInput } from "./advisory.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// ── get_crops ───────────────────────────────────────────────────────────────

export const cropsTool: ToolDefinition = {
  name: "get_crops",
  description: "The crops AKILIMO offers, from the Akilimo API's crop list, for a crop choice or to say which crops are supported. Each crop has a key, a name, advice_available (true: recommendations can be computed for it, false: prices and information only) and the countries it is offered in (null means everywhere). Give countryCode to list only the crops offered there. Only crops with advice_available true can be used with compute_recommendations.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { ...countryInput.properties.countryCode, description: "Optional ISO 2-letter code of a supported country (see get_countries) to list only the crops offered there" },
    },
    required: [],
  },

  async handler(args, api) {
    const code = typeof args?.countryCode === "string" && /^[A-Za-z]{2}$/.test(args.countryCode) ? args.countryCode.toUpperCase() : undefined;
    const { crops, source } = await fetchCrops(api, code);
    return jsonResult({
      ...(code ? { country: code } : {}),
      crops,
      source,
      usage: "Offer only these crops. Recommendations (compute_recommendations) exist only for crops with advice_available true.",
    });
  },
};
