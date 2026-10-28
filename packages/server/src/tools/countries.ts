import { fetchCountries } from "../countries/list.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// ── get_countries ───────────────────────────────────────────────────────────

export const countriesTool: ToolDefinition = {
  name: "get_countries",
  description: "The countries AKILIMO supports, from the Akilimo API, each with its ISO 2-letter code (the countryCode every other tool takes), name, map position and the currency of its prices. Call it to say which countries are supported or to find a country's code. Recommendations are only possible for these countries.",
  inputSchema: { type: "object" as const, properties: {}, required: [] },

  async handler(_args, api) {
    const countries = await fetchCountries(api);
    return jsonResult({
      countries,
      usage: "Use the code as countryCode in the other tools. Only these countries are supported.",
    });
  },
};
