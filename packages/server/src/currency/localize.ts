import { convert } from "./rates.js";

// Money in another currency inside an answer ("$0.49 per kg", "EUR 20", "15 USD") is converted to the
// country's local currency by the server, so the farmer sees it whether or not the model remembered to
// call convert_currency. Only unambiguous forms are read: a currency symbol or a code or word next to a number.
const SYMBOLS: Record<string, string> = { "$": "USD", "US$": "USD", "€": "EUR", "£": "GBP" };
const WORDS: Record<string, string> = { usd: "USD", dollar: "USD", dollars: "USD", eur: "EUR", euro: "EUR", euros: "EUR", gbp: "GBP" };

const NUMBER = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const BEFORE = new RegExp(`(US\\$|[$€£]|\\b(?:USD|EUR|GBP)\\b)\\s?(${NUMBER})`, "g"); // $0.49, USD 12, €5
const AFTER = new RegExp(`(${NUMBER})\\s?(USD|EUR|GBP|dollars?|euros?)\\b`, "gi"); // 15 USD, 20 euros ("pounds" is left out: it is also a weight)

export interface ForeignAmount { raw: string; amount: number; code: string }

export function findForeignAmounts(text: string, localCurrency: string): ForeignAmount[] {
  const found = new Map<string, ForeignAmount>();
  const add = (raw: string, number: string, code: string) => {
    const amount = Number(number.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || code === localCurrency.toUpperCase()) return;
    found.set(`${code}:${amount}`, { raw: raw.trim(), amount, code });
  };
  for (const m of text.matchAll(BEFORE)) add(m[0], m[2]!, SYMBOLS[m[1]!] ?? m[1]!.toUpperCase());
  for (const m of text.matchAll(AFTER)) add(m[0], m[1]!, WORDS[m[2]!.toLowerCase()] ?? m[2]!.toUpperCase());
  return [...found.values()].slice(0, 8);
}

const format = (n: number) => n.toLocaleString("en", { maximumFractionDigits: n < 100 ? 2 : 0 });

// A line to append to the answer with each foreign amount in local currency, or null when there is
// nothing to convert or the rates cannot be read
export async function localizeNote(text: string, localCurrency: string): Promise<string | null> {
  const amounts = findForeignAmounts(text, localCurrency);
  if (amounts.length === 0) return null;
  const local = localCurrency.toUpperCase();
  const lines: string[] = [];
  let asOf: string | null = null;
  for (const a of amounts) {
    try {
      const c = await convert(a.amount, a.code, local);
      asOf = c.asOf ?? asOf;
      lines.push(`${a.raw} ≈ ${local} ${format(c.converted)}`);
    } catch { /* no rate for this currency: leave it out */ }
  }
  if (lines.length === 0) return null;
  return `\n\n*In local currency (${local}, rates of ${asOf ?? "today"}): ${lines.join("; ")}.*`;
}
