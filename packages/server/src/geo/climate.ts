// Rainfall and temperature normals of a point from NASA POWER (monthly, 0.5 degree grid, no key): twenty
// complete years averaged into a typical year. POWER_URL can point to another source with the same JSON shape.
const URL_BASE = () => process.env.POWER_URL?.trim() || "https://power.larc.nasa.gov/api/temporal/monthly/point";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;
const YEARS = 20;
const WET_MONTH_MM = 100; // a month with at least this much rain counts as wet
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface ClimateMonth { month: string; rainfall_mm: number; mean_temp_c: number }
export interface ClimateSummary {
  lat: number;
  lon: number;
  source: string;
  period: string;
  months: ClimateMonth[];
  annual_rainfall_mm: number;
  mean_temp_c: number;
  wettest_month: string;
  driest_month: string;
  wet_months: string[]; // months with at least WET_MONTH_MM of rain, in calendar order
  wet_month_threshold_mm: number;
}

interface PowerBody { properties?: { parameter?: Record<string, Record<string, number>> } }

const cache = new Map<string, { at: number; summary: ClimateSummary }>();
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

export async function getClimateSummary(lat: number, lon: number): Promise<ClimateSummary> {
  // The grid is 0.5 degree, so one cache entry per two decimals is plenty
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.summary;

  const end = new Date().getUTCFullYear() - 1;
  const start = end - YEARS + 1;
  const params = new URLSearchParams({
    parameters: "PRECTOTCORR,T2M",
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: String(start),
    end: String(end),
    format: "JSON",
  });
  const res = await fetch(`${URL_BASE()}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The climate service (NASA POWER) answered ${res.status}`);
  const parameter = ((await res.json()) as PowerBody).properties?.parameter;
  const rain = parameter?.PRECTOTCORR;
  const temp = parameter?.T2M;
  if (!rain || !temp) throw new Error("The climate service returned no data for this point");

  // Keys are YYYYMM; month 13 is the yearly mean and -999 marks a missing value
  const average = (series: Record<string, number>, month: number): number | null => {
    const values = Object.entries(series)
      .filter(([k, v]) => Number(k.slice(4)) === month + 1 && v > -900)
      .map(([, v]) => v);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };

  const months: ClimateMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const perDay = average(rain, m);
    const t = average(temp, m);
    if (perDay === null || t === null) throw new Error("The climate service returned incomplete data for this point");
    // POWER gives millimetres per day
    months.push({ month: MONTHS[m]!, rainfall_mm: round(perDay * DAYS[m]!), mean_temp_c: round(t, 1) });
  }

  const wettest = months.reduce((a, b) => (b.rainfall_mm > a.rainfall_mm ? b : a));
  const driest = months.reduce((a, b) => (b.rainfall_mm < a.rainfall_mm ? b : a));
  const summary: ClimateSummary = {
    lat,
    lon,
    source: "NASA POWER monthly data (0.5 degree grid, modelled from satellite and reanalysis)",
    period: `${start}-${end}`,
    months,
    annual_rainfall_mm: months.reduce((a, b) => a + b.rainfall_mm, 0),
    mean_temp_c: round(months.reduce((a, b) => a + b.mean_temp_c, 0) / 12, 1),
    wettest_month: wettest.month,
    driest_month: driest.month,
    wet_months: months.filter((m) => m.rainfall_mm >= WET_MONTH_MM).map((m) => m.month),
    wet_month_threshold_mm: WET_MONTH_MM,
  };
  cache.set(key, { at: Date.now(), summary });
  return summary;
}
