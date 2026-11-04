import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AkilimoApiClient } from "../api/client.js";
import { searchWeb } from "../chat/websearch.js";
import { fetchCountries } from "../countries/list.js";
import { convert } from "../currency/rates.js";
import { getBenchmark, type Benchmark, type BenchmarkSeries } from "../prices/benchmark.js";
import { amountsIn, priceSearchConfig } from "../prices/search.js";
import { cassavaPriceTool, countryFrom, fertilizerOptionsTool, operationCostsTool } from "./advisory.js";
import { cropPricesTool } from "./farm-inputs.js";
import { jsonResult, type ToolArgs, type ToolDefinition } from "./types.js";

// ── find_missing_prices ─────────────────────────────────────────────────────

// The price and cost components AKILIMO keeps defaults for. Maize and sweet potato are only prices of intercropping
// (Nigeria and Tanzania), so they are looked at only when asked for by name.
const ITEMS = ["fertilizers", "cassava", "operations", "maize", "sweet_potato"] as const;
type Item = (typeof ITEMS)[number];
const DEFAULT_ITEMS: Item[] = ["fertilizers", "cassava", "operations"];

const MAX_WEB_SEARCHES = 6; // per call
const HITS_PER_SEARCH = 4;

interface Gap {
  item: Item;
  key: string;
  name: string;
  unit: string; // what the price is per, in words
  // the world market price for this gap in US dollars per unit, when the World Bank has a series for it
  benchmarkUsd?: (b: Benchmark) => number | null;
  searchQuery: (where: string, year: number) => string;
  unitWords: RegExp; // words that must be near an amount for it to count as a price
}

// The World Bank series that stands for a fertilizer of the API (its keys look like UREA_NG, DAP_NG, MOP_NG)
const seriesFor = (key: string, name: string): BenchmarkSeries | null => {
  const k = key.replace(/_[A-Z]{2}$/, "").toUpperCase();
  if (k === "UREA") return "urea";
  if (k === "DAP") return "dap";
  if (k === "TSP") return "tsp";
  if (k === "MOP" || k === "KCL" || k === "POTASH" || /potassium chloride|muriate/i.test(name)) return "potassium_chloride";
  return null;
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const OPERATIONS: [group: "manual" | "tractor" | "weeding", item: string, label: string, words: string][] = [
  ["manual", "ploughing", "manual ploughing", "ploughing by hand"],
  ["manual", "harrowing", "manual harrowing", "harrowing by hand"],
  ["manual", "ridging", "manual ridging", "ridging by hand"],
  ["tractor", "ploughing", "tractor ploughing", "tractor ploughing"],
  ["tractor", "harrowing", "tractor harrowing", "tractor harrowing"],
  ["tractor", "ridging", "tractor ridging", "tractor ridging"],
  ["weeding", "one", "first weeding", "weeding by hand"],
  ["weeding", "two", "second weeding", "weeding by hand"],
];

// Runs another tool of this server and reads its JSON answer
async function run(tool: ToolDefinition, args: ToolArgs, api: AkilimoApiClient): Promise<any> {
  const result: CallToolResult = await tool.handler(args, api);
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  return JSON.parse(text);
}

export const missingPricesTool: ToolDefinition = {
  name: "find_missing_prices",
  description: "Find a suggested price for the prices and costs that AKILIMO has NO default for in a country: fertilizers (price per bag), the cassava root price (per tonne), the costs of land preparation and weeding (per acre), and, when named, the maize and sweet potato prices of intercropping. It only looks at the gaps and only SUGGESTS: every suggestion has its source, date and a note, is not confirmed by anyone and must be shown to the farmer to accept or change before it is used as an input. Sources: (1) the World Bank's latest international prices for urea, DAP, TSP, potassium chloride (MOP) and maize grain, turned into an indicative local price (a world market price before transport and the dealer's margin, so local prices are higher); there is none for cassava, sweet potato or the operation costs; (2) only when onlineSearch is true, a web search for local prices, with the amounts found in the snippets and the links (a price is only suggested from a search when a benchmark exists to check it against; otherwise the amounts are candidates for the farmer to judge). Set onlineSearch to true ONLY when the user has allowed searching the internet (it is off by default). Never use a suggested price in compute_recommendations without the farmer's confirmation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "ISO 2-letter code of a supported country (the list comes from get_countries)" },
      items: { type: "array", items: { type: "string", enum: [...ITEMS] }, description: "Which components to check; by default fertilizers, cassava and operations (costs). Name maize or sweet_potato to check the prices of intercropping too" },
      fertilizers: { type: "array", items: { type: "string" }, description: "Optional fertilizer keys (the key of get_fertilizer_options) to look at; by default every fertilizer without a default price" },
      onlineSearch: { type: "boolean", description: "true to also search the web for local prices; only when the user allowed searching the internet (default false)" },
    },
    required: ["countryCode"],
  },

  async handler(args, api) {
    const country = countryFrom(args);
    const asked = Array.isArray(args?.items) ? args.items.filter((i): i is Item => ITEMS.includes(i as Item)) : [];
    const items: Item[] = asked.length ? asked : DEFAULT_ITEMS;
    const wantedFertilizers = Array.isArray(args?.fertilizers) ? args.fertilizers.filter((k): k is string => typeof k === "string") : null;
    const search = args?.onlineSearch === true;
    const countryArgs = { countryCode: country };

    // 1. What has no default (the same tools the rest of AKILIMO uses, so "default" means the same everywhere)
    const countries = await fetchCountries(api).catch(() => []);
    const info = countries.find((c) => c.code === country);
    const gaps: Gap[] = [];
    const have: { item: Item; name: string }[] = [];
    let currency: string | null = info?.currency ?? null;

    if (items.includes("fertilizers")) {
      const data = await run(fertilizerOptionsTool, countryArgs, api);
      currency = data.currency ?? currency;
      for (const f of data.fertilizers as { key: string; name: string; bag_weight_kg: number; typical_price_per_bag: number | null }[]) {
        if (wantedFertilizers && !wantedFertilizers.includes(f.key)) continue;
        const weight = Number(f.bag_weight_kg) || 50;
        if (f.typical_price_per_bag !== null) { have.push({ item: "fertilizers", name: f.name }); continue; }
        const series = seriesFor(f.key, f.name);
        gaps.push({
          item: "fertilizers", key: f.key, name: f.name, unit: `${weight} kg bag`,
          ...(series ? { benchmarkUsd: (b: Benchmark) => (b.usdPerTonne[series] === undefined ? null : (b.usdPerTonne[series]! * weight) / 1000) } : {}),
          searchQuery: (where, year) => `${f.name} fertilizer ${weight} kg bag price ${where} ${year}`,
          unitWords: /\b(bag|50\s?-?kg)\b/i,
        });
      }
    }
    if (items.includes("cassava")) {
      const data = await run(cassavaPriceTool, countryArgs, api);
      currency = data.currency ?? currency;
      if (data.typical_price_per_tonne === null) {
        gaps.push({ item: "cassava", key: "cassava_roots", name: "Cassava roots", unit: "tonne of fresh roots",
          searchQuery: (where, year) => `cassava roots price per tonne ${where} ${year}`, unitWords: /\b(tonne|ton|kg|bag)s?\b/i });
      } else have.push({ item: "cassava", name: "Cassava roots" });
    }
    if (items.includes("operations")) {
      const data = await run(operationCostsTool, countryArgs, api);
      for (const [group, key, label, words] of OPERATIONS) {
        if (data.costs?.[group]?.[key]?.value != null) { have.push({ item: "operations", name: label }); continue; }
        gaps.push({ item: "operations", key: `${group}_${key}`, name: label, unit: "acre",
          searchQuery: (where, year) => `cost of ${words} per acre ${where} ${year}`, unitWords: /\b(acre|hectare|ha)\b/i });
      }
    }
    if (items.includes("maize") || items.includes("sweet_potato")) {
      const data = await run(cropPricesTool, countryArgs, api);
      if (items.includes("maize")) {
        if (data.maize === null) {
          gaps.push({ item: "maize", key: "maize_grain", name: "Maize grain", unit: "100 kg of dry grain",
            benchmarkUsd: (b) => (b.usdPerTonne.maize === undefined ? null : b.usdPerTonne.maize / 10),
            searchQuery: (where, year) => `maize grain price per 100 kg ${where} ${year}`, unitWords: /\b(100\s?-?kg|bag|kg|tonne|ton)s?\b/i });
        } else have.push({ item: "maize", name: "Maize" });
      }
      if (items.includes("sweet_potato")) {
        if (data.sweet_potato === null) {
          gaps.push({ item: "sweet_potato", key: "sweet_potato_tubers", name: "Sweet potato tubers", unit: "tonne of fresh tubers",
            searchQuery: (where, year) => `sweet potato price per tonne ${where} ${year}`, unitWords: /\b(tonne|ton|kg|bag)s?\b/i });
        } else have.push({ item: "sweet_potato", name: "Sweet potato" });
      }
    }

    if (gaps.length === 0) {
      return jsonResult({ country, currency, checked: items, suggestions: [], message: "Every component asked about already has a default; nothing to look up." });
    }

    // 2. The World Bank benchmark: public data, no user data leaves the server
    const needsBenchmark = gaps.some((g) => g.benchmarkUsd);
    let benchmark: Benchmark | null = null;
    let benchmarkError: string | null = null;
    if (needsBenchmark) {
      try {
        benchmark = await getBenchmark();
      } catch (error) {
        benchmarkError = error instanceof Error ? error.message : String(error);
      }
    }
    const toLocal = async (usd: number): Promise<number | null> => {
      if (!currency) return null;
      try {
        return (await convert(usd, "USD", currency)).converted;
      } catch {
        return null;
      }
    };

    // 3. Web search, only when the caller says the user allowed it
    const config = search ? await priceSearchConfig() : null;
    const web = {
      requested: search,
      available: config !== null,
      message: !search ? "Not requested (the user has not allowed searching the internet)." : config ? null : "Web search is not set up on this server.",
    };

    const where = info?.name ?? country;
    const year = new Date().getFullYear();
    let searches = 0;
    const suggestions = [];
    for (const g of gaps) {
      const usd = benchmark && g.benchmarkUsd ? g.benchmarkUsd(benchmark) : null;
      const benchmarkLocal = usd === null ? null : await toLocal(usd);

      let found: { query: string; hits: { title: string; url: string; snippet: string }[]; amounts_found: number[] } | null = null;
      if (config && searches < MAX_WEB_SEARCHES) {
        searches += 1;
        const query = g.searchQuery(where, year);
        try {
          const hits = (await searchWeb(config, query)).slice(0, HITS_PER_SEARCH);
          // Plausible amounts are between half and eight times the benchmark; without a benchmark there is no check
          const range = benchmarkLocal === null ? undefined : { min: benchmarkLocal * 0.5, max: benchmarkLocal * 8 };
          const amounts = hits.flatMap((h) => amountsIn(`${h.title}. ${h.snippet}`, currency, range, g.unitWords));
          found = { query, hits, amounts_found: [...new Set(amounts)].sort((a, b) => a - b) };
        } catch (error) {
          web.message = `A web search failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      // A web amount becomes the suggestion only when a benchmark exists to check it against
      const fromWeb = found && benchmarkLocal !== null ? median(found.amounts_found) : null;
      const suggested = fromWeb ?? benchmarkLocal;
      suggestions.push({
        item: g.item,
        key: g.key,
        name: g.name,
        unit: g.unit,
        currency,
        suggested_price: suggested === null ? null : Math.round(suggested),
        basis: fromWeb !== null ? "web" : benchmarkLocal !== null ? "benchmark" : "none",
        benchmark: usd === null || !benchmark ? null : { usd_per_unit: Math.round(usd * 100) / 100, price_local: benchmarkLocal === null ? null : Math.round(benchmarkLocal), as_of: benchmark.asOf },
        web: found,
        note: fromWeb !== null
          ? "Median of amounts read from web snippets and checked against the international benchmark: unverified, check the links."
          : benchmarkLocal !== null
            ? "International benchmark price: indicative only; local prices are usually higher (transport, import costs and the dealer's margin)."
            : usd !== null
              ? "A benchmark exists in US dollars but this country's local currency is not known, so no local price is suggested."
              : found && found.amounts_found.length > 0
                ? "No international benchmark exists for this, so nothing is suggested; the amounts found in web snippets are candidates for the farmer to judge, with the links."
                : g.benchmarkUsd
                  ? (benchmarkError ? `The benchmark could not be read (${benchmarkError}).` : "No price could be found.")
                  : search
                    ? "No international benchmark exists for this and no usable price was found on the web."
                    : "No international benchmark exists for this; only a web search (when the user allows it) can help.",
      });
    }

    return jsonResult({
      country,
      currency,
      checked: items,
      suggestions,
      sources: {
        benchmark: needsBenchmark ? (benchmark ? { name: benchmark.source, as_of: benchmark.asOf, url: benchmark.url } : { error: benchmarkError }) : null,
        web,
      },
      already_have_defaults: have.length,
      usage: "These are suggestions, not confirmed prices or costs. Tell the farmer where each comes from and its date, and ask them to accept or change it before it is used as an input (fertilizer_list price, cassava.unit_price, manualCosts, tractorCosts, weedingCosts, maize or sweetPotato price). Costs are per acre.",
    });
  },
};
