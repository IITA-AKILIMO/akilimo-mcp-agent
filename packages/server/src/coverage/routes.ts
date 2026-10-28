import express from "express";
import { z } from "zod/v4";
import type { AkilimoApiClient } from "../api/client.js";

// The supported area of each country, for the web UI's map and early location checks. The Akilimo API
// keeps it (GET /v1/coverage/{country}, copied from the compute service); this relays it from the same
// origin as the UI and keeps a copy in memory, since it changes only when the yield data does.
const CACHE_MS = 30 * 60 * 1000;
const COUNTRY = z.string().length(2).transform((c) => c.toUpperCase());

export function coverageRouter(api: AkilimoApiClient) {
  const router = express.Router();
  const cache = new Map<string, { at: number; body: unknown }>();

  const upstreamStatus = (error: unknown) => Number(/\[Akilimo API (\d{3})\]/.exec(String((error as Error)?.message))?.[1]) || 502;

  // Is a point inside the area? The API decides (it also guards compute requests); `covered` is null
  // when it has no area for the country yet. Declared before /:country so "check" is not read as one.
  router.get("/check", async (req, res) => {
    const query = z.object({ country: COUNTRY, lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: z.prettifyError(query.error) });
      return;
    }
    try {
      res.json(await api.get("/v1/coverage/check", query.data));
    } catch (error) {
      res.status(upstreamStatus(error)).json({ error: (error as Error).message });
    }
  });

  router.get("/:country", async (req, res) => {
    const country = COUNTRY.safeParse(req.params.country);
    if (!country.success) {
      res.status(400).json({ error: "Use a 2-letter country code" });
      return;
    }

    const cached = cache.get(country.data);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      res.type("application/geo+json").setHeader("Cache-Control", "public, max-age=900").json(cached.body);
      return;
    }

    try {
      const body = await api.get<unknown>(`/v1/coverage/${country.data}`);
      cache.set(country.data, { at: Date.now(), body });
      res.type("application/geo+json").setHeader("Cache-Control", "public, max-age=900").json(body);
    } catch (error) {
      // No area yet (404) or an older API without this route: the UI just goes without the overlay
      res.status(upstreamStatus(error)).json({ error: (error as Error).message });
    }
  });

  return router;
}
