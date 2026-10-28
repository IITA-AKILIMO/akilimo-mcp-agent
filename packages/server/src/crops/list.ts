import { DEFAULT_CROPS, parseCrops, type Crop } from "@akilimo/shared";
import type { AkilimoApiClient } from "../api/client.js";

export interface CropList {
  crops: Crop[];
  // "api" when the Akilimo API answered, "default" when the built-in list (cassava) was used instead
  source: "api" | "default";
}

// The crops from the Akilimo API (GET /v1/crops, or /v1/crops/country/{code}), shared by the web UI's
// selector (crops/routes.ts) and the get_crops tool. An API without the route (not deployed or migrated
// yet), an empty answer or an error gives the built-in list, so callers always have a crop to offer.
export async function fetchCrops(api: AkilimoApiClient, countryCode?: string): Promise<CropList> {
  try {
    const { data } = await api.getAll<Record<string, unknown>>(countryCode ? `/v1/crops/country/${countryCode}` : "/v1/crops");
    const crops = parseCrops(data);
    return crops.length > 0 ? { crops, source: "api" } : { crops: DEFAULT_CROPS, source: "default" };
  } catch {
    return { crops: DEFAULT_CROPS, source: "default" };
  }
}
