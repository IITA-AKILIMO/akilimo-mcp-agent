// Soil properties of a point from ISRIC SoilGrids (250 m global maps, no key). The public REST service is
// often busy (503), so a failed call is retried and answers are cached; SOILGRIDS_URL can point to a copy of
// the service that we host ourselves, with the same /properties/query route.
const BASE_URL = () => (process.env.SOILGRIDS_URL?.trim() || "https://rest.isric.org/soilgrids/v2.0").replace(/\/+$/, "");
const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 3;

const PROPERTIES = ["phh2o", "soc", "nitrogen", "clay", "silt", "sand"] as const;
const DEPTHS = ["0-5cm", "5-15cm", "15-30cm"] as const;

export interface SoilLayer { depth: string; ph: number | null; organic_carbon_g_per_kg: number | null; nitrogen_g_per_kg: number | null; clay_percent: number | null; silt_percent: number | null; sand_percent: number | null }
export interface SoilProfile {
  lat: number;
  lon: number;
  source: string;
  resolution: string;
  layers: SoilLayer[];
  topsoil: { ph_class: string | null; texture: string | null };
}

interface SoilGridsBody { properties?: { layers?: { name: string; unit_measure?: { d_factor?: number }; depths?: { label: string; values?: { mean?: number | null } }[] }[] } }

const cache = new Map<string, { at: number; profile: SoilProfile }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(lat: number, lon: number): Promise<SoilGridsBody> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), value: "mean" });
  for (const p of PROPERTIES) params.append("property", p);
  for (const d of DEPTHS) params.append("depth", d);
  const url = `${BASE_URL()}/properties/query?${params}`;

  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as SoilGridsBody;
      last = `answered ${res.status}`;
      // Only a busy or failing service is worth another try
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      last = (error as Error).message;
    }
    if (attempt < ATTEMPTS) await sleep(1000 * attempt);
  }
  throw new Error(`The soil service (SoilGrids) ${last}`);
}

// USDA texture class from clay, silt and sand percentages
export function textureClass(clay: number, silt: number, sand: number): string {
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 1.5 * clay < 30 && silt + 2 * clay >= 15) return "loamy sand";
  if (clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) return "sandy loam";
  if (clay < 7 && silt < 50 && silt + 2 * clay >= 30) return "sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "silt loam";
  if (silt >= 80 && clay < 12) return "silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "silty clay loam";
  if (clay >= 35 && sand > 45) return "sandy clay";
  if (clay >= 40 && silt >= 40) return "silty clay";
  if (clay >= 40) return "clay";
  return "loam";
}

export function phClass(ph: number): string {
  if (ph < 4.5) return "extremely acidic";
  if (ph < 5.5) return "strongly acidic";
  if (ph < 6.5) return "moderately acidic";
  if (ph < 7.3) return "neutral";
  if (ph < 8.4) return "alkaline";
  return "strongly alkaline";
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export async function getSoilProfile(lat: number, lon: number): Promise<SoilProfile> {
  // 3 decimals is about 110 m, finer than the 250 m maps
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile;

  const body = await query(lat, lon);
  const layers = body.properties?.layers ?? [];
  if (layers.length === 0) throw new Error("The soil service returned no layers");

  // value per property and depth, scaled by the service's own d_factor to the units below
  const value = (property: string, depth: string): number | null => {
    const layer = layers.find((l) => l.name === property);
    const raw = layer?.depths?.find((d) => d.label.startsWith(depth))?.values?.mean;
    return typeof raw === "number" ? raw / (layer?.unit_measure?.d_factor || 1) : null;
  };
  const num = (v: number | null, digits = 1) => (v === null ? null : round(v, digits));

  const result: SoilLayer[] = DEPTHS.map((depth) => ({
    depth,
    ph: num(value("phh2o", depth)),
    organic_carbon_g_per_kg: num(value("soc", depth)),
    nitrogen_g_per_kg: num(value("nitrogen", depth), 2),
    clay_percent: num(value("clay", depth)),
    silt_percent: num(value("silt", depth)),
    sand_percent: num(value("sand", depth)),
  }));
  if (result.every((l) => l.ph === null && l.clay_percent === null)) {
    // SoilGrids has no value for water, built-up land and some other pixels
    throw new Error("SoilGrids has no soil data for this point (water, built-up land or outside its maps)");
  }

  const top = result.find((l) => l.ph !== null || l.clay_percent !== null)!;
  const profile: SoilProfile = {
    lat,
    lon,
    source: "ISRIC SoilGrids 2.0 (modelled, not a field measurement)",
    resolution: "250 m",
    layers: result,
    topsoil: {
      ph_class: top.ph === null ? null : phClass(top.ph),
      texture: top.clay_percent === null || top.silt_percent === null || top.sand_percent === null ? null : textureClass(top.clay_percent, top.silt_percent, top.sand_percent),
    },
  };
  cache.set(key, { at: Date.now(), profile });
  return profile;
}
