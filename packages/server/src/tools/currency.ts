import { convert } from "../currency/rates.js";
import { fetchCountries } from "../countries/list.js";
import { jsonResult, type ToolDefinition } from "./types.js";

// ── convert_currency ────────────────────────────────────────────────────────

export const convertCurrencyTool: ToolDefinition = {
  name: "convert_currency",
  description: "Convert an amount of money between currencies at the prevailing exchange rate (updated daily; the answer says which day). Use it whenever a price or cost is given in a currency other than the country's own, for example a price in US dollars found on the web, and show the farmer the local amount together with the original and the rate date. Give `from` (ISO 4217 code such as USD, EUR) and either `to` (a currency code) or `countryCode` (a supported country, then the amount is converted to that country's local currency).",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: { type: "number", description: "The amount to convert" },
      from: { type: "string", description: "ISO 4217 currency code of the amount, e.g. USD" },
      to: { type: "string", description: "ISO 4217 code to convert to; or leave out and give countryCode" },
      countryCode: { type: "string", description: "ISO 2-letter code of a supported country: convert to its local currency" },
    },
    required: ["amount", "from"],
  },

  async handler(args, api) {
    const amount = Number(args?.amount);
    if (!Number.isFinite(amount)) throw new Error("amount must be a number");
    const from = String(args?.from ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from)) throw new Error("from must be a 3-letter currency code such as USD");

    let to = String(args?.to ?? "").trim().toUpperCase();
    if (!to) {
      const code = String(args?.countryCode ?? "").trim().toUpperCase();
      if (!code) throw new Error("Give `to` (a currency code) or `countryCode`");
      const country = (await fetchCountries(api)).find((c) => c.code === code);
      if (!country) throw new Error(`${code} is not a supported country`);
      if (!country.currency) throw new Error(`The currency of ${country.name} is not known`);
      to = country.currency;
    }
    if (!/^[A-Z]{3}$/.test(to)) throw new Error("to must be a 3-letter currency code such as NGN");

    return jsonResult(await convert(amount, from, to));
  },
};
