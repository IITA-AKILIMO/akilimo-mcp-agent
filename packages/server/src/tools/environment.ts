import { getClimateSummary } from "../geo/climate.js";
import { getSoilProfile } from "../geo/soil.js";
import { jsonResult, ToolError, type ToolArgs, type ToolDefinition } from "./types.js";

const pointSchema = {
  type: "object" as const,
  properties: {
    lat: { type: "number", description: "Latitude in decimal degrees" },
    lon: { type: "number", description: "Longitude in decimal degrees" },
  },
  required: ["lat", "lon"],
};

function point(args: ToolArgs): { lat: number; lon: number } {
  const lat = Number(args?.lat);
  const lon = Number(args?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ToolError("lat must be between -90 and 90 and lon between -180 and 180");
  }
  return { lat, lon };
}

// ── get_soil_profile ────────────────────────────────────────────────────────

export const soilProfileTool: ToolDefinition = {
  name: "get_soil_profile",
  description: "Typical soil of a location from the ISRIC SoilGrids maps (250 m): pH, organic carbon, nitrogen and clay/silt/sand per depth (0-5, 5-15 and 15-30 cm), plus the topsoil's pH class and texture class. These are modelled values, not a field measurement, so say they are an estimate and give context rather than advice: the compute service does not take soil as an input, so this never changes compute_recommendations. If the soil service is busy or has no data for the point, say so and carry on.",
  inputSchema: pointSchema,

  async handler(args) {
    const { lat, lon } = point(args);
    try {
      return jsonResult(await getSoilProfile(lat, lon));
    } catch (error) {
      // Soil is context, so an unavailable service must not stop the conversation
      return jsonResult({ lat, lon, available: false, message: `Soil data could not be read (${(error as Error).message})` });
    }
  },
};

// ── get_climate_summary ─────────────────────────────────────────────────────

export const climateSummaryTool: ToolDefinition = {
  name: "get_climate_summary",
  description: "Rainfall and temperature of a typical year at a location, from NASA POWER (twenty complete years averaged): rainfall in mm and mean temperature per month, annual rainfall, the wettest and driest months and the months with at least 100 mm of rain. Use it for questions about rainfall, the rainy seasons and when planting is usually possible. It is a long-term average on a coarse grid (0.5 degree, about 55 km), not a forecast and not this season's weather; for the coming days use the weather server.",
  inputSchema: pointSchema,

  async handler(args) {
    const { lat, lon } = point(args);
    try {
      return jsonResult(await getClimateSummary(lat, lon));
    } catch (error) {
      return jsonResult({ lat, lon, available: false, message: `Climate data could not be read (${(error as Error).message})` });
    }
  },
};
