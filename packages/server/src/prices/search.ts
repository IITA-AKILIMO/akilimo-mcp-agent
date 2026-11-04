import { envSearchConfig, type SearchConfig } from "../chat/websearch.js";

// Where the price tool gets the web search service from. The chat's server sets it to the admin's setting (with the
// SEARCH_* variables as the fallback); without it (stdio mode) only the SEARCH_* variables are used.
let resolver: (() => Promise<SearchConfig | null>) | null = null;

export const setSearchConfigResolver = (fn: () => Promise<SearchConfig | null>) => {
  resolver = fn;
};

export const priceSearchConfig = async (): Promise<SearchConfig | null> => (resolver ? resolver().catch(() => null) : envSearchConfig());

// Amounts in a piece of text that look like a price in the given currency: a number next to the currency's code or
// symbol, in a text that talks about the unit (by default a bag or 50 kg), and inside [min, max] when a range is known
const SYMBOLS: Record<string, string[]> = {
  NGN: ["₦", "NGN", "N"],
  KES: ["KSh", "Ksh", "KES", "Sh"],
  TZS: ["TSh", "Tsh", "TZS", "Sh"],
  RWF: ["FRw", "RWF", "Rwf"],
  GHS: ["GH₵", "GHS", "₵", "GHc"],
  BIF: ["FBu", "BIF"],
  USD: ["US$", "USD", "$"],
};

export function amountsIn(text: string, currency: string | null, range?: { min: number; max: number }, unitWords: RegExp = /\b(bag|50\s?-?kg)\b/i): number[] {
  if (!currency || !unitWords.test(text)) return [];
  const symbols = (SYMBOLS[currency.toUpperCase()] ?? [currency]).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const sym = `(?:${symbols.join("|")})`;
  const number = "(\\d{1,3}(?:[,\\s]\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
  const found: number[] = [];
  for (const re of [new RegExp(`${sym}\\s?${number}`, "g"), new RegExp(`${number}\\s?${sym}(?![A-Za-z])`, "g")]) {
    for (const m of text.matchAll(re)) {
      const value = Number(m[1]!.replace(/[,\s]/g, ""));
      if (Number.isFinite(value) && value > 0 && (!range || (value >= range.min && value <= range.max))) found.push(value);
    }
  }
  return [...new Set(found)].sort((a, b) => a - b);
}
