import { strFromU8, unzipSync } from "fflate";

// International fertilizer and maize prices of the World Bank's monthly commodity price data (the "Pink Sheet", nominal US
// dollars per tonne, from 1960 to the latest month): urea, DAP, TSP, potassium chloride and maize. They are benchmarks of
// the world market, not what a farmer pays at a local shop (transport, import costs and the dealer's margin come
// on top), so they are only offered as indicative prices. The monthly Excel file has a new address every month,
// so it is found on the World Bank page; FERTILIZER_BENCHMARK_URL can name the file (or another file of the same
// layout) directly.
const PAGE_URL = "https://www.worldbank.org/en/research/commodity-markets";
const FILE_PATTERN = /https:\/\/thedocs\.worldbank\.org\/[^"'\s<>]*CMO-Historical-Data-Monthly\.xlsx/i;
const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 40_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type BenchmarkSeries = "urea" | "dap" | "tsp" | "potassium_chloride" | "maize";

// The column heading in the spreadsheet for each series
const HEADINGS: Record<BenchmarkSeries, RegExp> = {
  urea: /^urea\b/i,
  dap: /^dap\b/i,
  tsp: /^tsp\b/i,
  potassium_chloride: /^potassium chloride\b/i,
  maize: /^maize\b/i, // the world price of maize grain, for the maize price of intercropping
};

export interface Benchmark {
  asOf: string; // the month of the figures, YYYY-MM
  source: string;
  url: string;
  usdPerTonne: Partial<Record<BenchmarkSeries, number>>;
}

let cached: { at: number; value: Benchmark } | null = null;

async function fetchBytes(url: string, accept: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": "akilimo-mcp-server" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("the price file is larger than expected");
  return bytes;
}

async function fileUrl(): Promise<string> {
  const given = process.env.FERTILIZER_BENCHMARK_URL?.trim();
  if (given) return given;
  const page = strFromU8(await fetchBytes(PAGE_URL, "text/html"));
  const found = page.match(FILE_PATTERN)?.[0];
  if (!found) throw new Error("the World Bank page no longer links the monthly price file");
  return found;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const columnIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// Shared strings of a workbook, in order
function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

// The cells of one sheet as rows of column index -> text
function sheetRows(xml: string, strings: string[]): Map<number, Map<number, string>> {
  const rows = new Map<number, Map<number, string>>();
  for (const row of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>();
    for (const cell of row[2]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = cell[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (raw === undefined) continue;
      cells.set(columnIndex(cell[1]!), /t="s"/.test(cell[2]!) ? (strings[Number(raw)] ?? "") : decode(raw));
    }
    rows.set(Number(row[1]), cells);
  }
  return rows;
}

// The latest value of each fertilizer column in the "Monthly Prices" sheet, in dollars per tonne
export function readBenchmark(xlsx: Uint8Array, url: string): Benchmark {
  const files = unzipSync(xlsx, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name) });
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");

  // The sheet called "Monthly Prices", found through the workbook's own links, not by its file number
  const sheet = [...text("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].find((m) => decode(m[1]!) === "Monthly Prices");
  const relationship = sheet
    ? [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${sheet[2]}"`))
    : undefined;
  const target = relationship?.match(/Target="([^"]*)"/)?.[1];
  if (!target) throw new Error("the price file has no 'Monthly Prices' sheet");
  const rows = sheetRows(text(`xl/${target.replace(/^\/?(xl\/)?/, "")}`), sharedStrings(text("xl/sharedStrings.xml")));

  // The heading row is the one that names the fertilizer columns; the units are in the row below it
  const entries = Object.entries(HEADINGS) as [BenchmarkSeries, RegExp][];
  const headerRow = [...rows.entries()].find(([, cells]) => entries.every(([, re]) => [...cells.values()].some((v) => re.test(v.trim()))));
  if (!headerRow) throw new Error("the price file has no fertilizer columns");
  const [headerNo, header] = headerRow;
  const columns = Object.fromEntries(entries.map(([key, re]) => [key, [...header.entries()].find(([, v]) => re.test(v.trim()))![0]])) as Record<BenchmarkSeries, number>;
  const units = rows.get(headerNo + 1);
  for (const [key, col] of Object.entries(columns)) {
    if (!/\$\/mt/i.test(units?.get(col) ?? "")) throw new Error(`the price of ${key} is not in dollars per tonne any more`);
  }

  // The newest month that has a figure, per fertilizer (the newest rows can be empty or marked with dots)
  const usdPerTonne: Partial<Record<BenchmarkSeries, number>> = {};
  let asOf = "";
  const dataRows = [...rows.entries()].filter(([no]) => no > headerNo + 1).sort((a, b) => b[0] - a[0]);
  for (const [, cells] of dataRows) {
    const month = cells.get(1)?.match(/^(\d{4})M(\d{2})$/);
    if (!month) continue;
    for (const [key, col] of Object.entries(columns) as [BenchmarkSeries, number][]) {
      const value = Number(cells.get(col));
      if (usdPerTonne[key] === undefined && Number.isFinite(value) && value > 0) {
        usdPerTonne[key] = value;
        const label = `${month[1]}-${month[2]}`;
        if (label > asOf) asOf = label;
      }
    }
    if (entries.every(([key]) => usdPerTonne[key] !== undefined)) break;
  }
  if (!asOf) throw new Error("the price file has no recent fertilizer prices");
  return { asOf, source: "World Bank commodity price data (Pink Sheet), nominal US dollars per tonne", url, usdPerTonne };
}

export async function getBenchmark(): Promise<Benchmark> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const url = await fileUrl();
  const value = readBenchmark(await fetchBytes(url, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), url);
  cached = { at: Date.now(), value };
  return value;
}
