import express from "express";
import type { AkilimoApiClient } from "../api/client.js";
import { fetchCountries } from "./list.js";

// The supported countries for the web UI (country selector, map, examples), straight from the Akilimo API
// through the server's cache. There is no built-in list: if the API cannot be reached the UI says so and
// offers a retry.
export function countriesRouter(api: AkilimoApiClient) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      res.json({ countries: await fetchCountries(api) });
    } catch (error) {
      res.status(502).json({ error: `Cannot load the supported countries: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  return router;
}
