import express from "express";
import { z } from "zod/v4";
import type { AkilimoApiClient } from "../api/client.js";
import { fetchCrops, type CropList } from "./list.js";

// The crops for the web UI's crop selector, from the Akilimo API (managed in its admin area) with the
// built-in list as the fallback (see list.ts). Only a real answer from the API is cached, so a crop list
// that appears after a deployment shows up within minutes instead of staying hidden behind a cached fallback.
const CACHE_MS = 5 * 60 * 1000;
const COUNTRY = z.string().length(2).transform((c) => c.toUpperCase());

export function cropsRouter(api: AkilimoApiClient) {
  const router = express.Router();
  const cache = new Map<string, { at: number; body: CropList }>();

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

    const body = await fetchCrops(api, code);
    if (body.source === "api") cache.set(cacheKey, { at: Date.now(), body });
    res.json(body);
  });

  return router;
}
