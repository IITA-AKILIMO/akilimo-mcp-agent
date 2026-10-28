import express from "express";
import { z } from "zod/v4";
import { DEFAULT_CROPS, parseCrops, type Crop } from "@akilimo/shared";
import type { AkilimoApiClient } from "../api/client.js";

// The crops for the web UI's crop selector, from the Akilimo API (GET /v1/crops, optionally per country;
// managed in its admin area). An API without the route, or one that cannot be reached, answers with the
// built-in list (cassava), so the selector always works. `source` says which one it was.
const CACHE_MS = 5 * 60 * 1000;
const COUNTRY = z.string().length(2).transform((c) => c.toUpperCase());

export function cropsRouter(api: AkilimoApiClient) {
  const router = express.Router();
  const cache = new Map<string, { at: number; body: { crops: Crop[]; source: "api" | "default" } }>();

  router.get("/", async (req, res) => {
    const country = req.query.country === undefined ? undefined : COUNTRY.safeParse(req.query.country);
    if (country && !country.success) {
      res.status(400).json({ error: "Use a 2-letter country code" });
      return;
    }
    const code = country?.data;
    const cacheKey = code ?? "*";

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      res.json(cached.body);
      return;
    }

    try {
      const { data } = await api.getAll<Record<string, unknown>>(code ? `/v1/crops/country/${code}` : "/v1/crops");
      const crops = parseCrops(data);
      const body = crops.length > 0 ? { crops, source: "api" as const } : { crops: DEFAULT_CROPS, source: "default" as const };
      cache.set(cacheKey, { at: Date.now(), body });
      res.json(body);
    } catch {
      // Not cached: ask the API again next time
      res.json({ crops: DEFAULT_CROPS, source: "default" });
    }
  });

  return router;
}
