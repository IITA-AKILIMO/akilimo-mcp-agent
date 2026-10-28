import {
  ComputeFieldsSchema,
  ComputeRequestSchema,
  FertilizerSchema,
  UserInfoSchema,
} from "@akilimo/shared";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { errorResult, jsonResult, type ToolDefinition } from "./types.js";

// The API requires user_info; the agent sends an anonymous profile unless the caller overrides it
export const DEFAULT_USER_INFO = {
  device_token: config.deviceToken || randomUUID(),
  risk_attitude: 0,
  user_name: "akilimo-mcp",
  first_name: "Akilimo",
  last_name: "MCP",
  gender: "M" as const,
  send_sms: false,
  send_email: false,
};

const ComputeToolInputSchema = z.object({
  compute_request: ComputeFieldsSchema,
  fertilizer_list: z.array(FertilizerSchema).default([])
    .describe("Fertilizers available to the farmer; get keys and names from get_reference_data 'fertilizers'"),
  user_info: UserInfoSchema.partial().optional()
    .describe("Optional overrides for the farmer profile; an anonymous profile is used by default"),
});

export const computeRecommendationsTool: ToolDefinition = {
  name: "compute_recommendations",
  description: "Compute a recommendation for a cassava field. Four types, chosen by farmInformation.use_case and the flags under recommendations: FR fertilizer (needs fertilizer_list with prices and selected), PP planting practices (ploughing and ridging), SPHS scheduled planting and harvest dates, IC intercropping (maize in Nigeria, sweet potato in Tanzania only). Location, field size, planting and harvest dates and the cassava root price are required; other fields default to neutral values. The answer holds rec_type, a recommendation text and data rows.",
  // Generated from the shared schema so the model sees exactly what validation accepts
  inputSchema: z.toJSONSchema(ComputeToolInputSchema, { io: "input" }) as ToolDefinition["inputSchema"],

  async handler(args, api) {
    const validation = ComputeRequestSchema.safeParse({
      compute_request: args?.compute_request,
      fertilizer_list: args?.fertilizer_list,
      user_info: { ...DEFAULT_USER_INFO, ...(args?.user_info as object | undefined) },
    });
    if (!validation.success) {
      // The reader is often a language model that left a section out: say what a complete call needs
      return errorResult(
        `Invalid payload:\n${z.prettifyError(validation.error)}\n\n`
        + "A complete call needs compute_request.farmInformation {country_code, use_case, map_lat, map_long, field_size, area_unit}, "
        + "compute_request.planting {planting_date, harvest_date as YYYY-MM-DD} and compute_request.cassava {unit_price}. "
        + "If the user has not given a value yet, ask them for it; do not invent dates, prices or locations.",
      );
    }

    return jsonResult(await api.post("/v1/recommendations/compute", validation.data));
  },
};
