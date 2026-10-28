import { cassavaPriceTool, checkLocationTool, fertilizerOptionsTool, operationCostsTool } from "./advisory.js";
import { computeRecommendationsTool } from "./compute-recommendations.js";
import { countriesTool } from "./countries.js";
import { cropsTool } from "./crops.js";
import { checkPriceTool, cropPricesTool, fertilizerPlanTool, investmentOptionsTool } from "./farm-inputs.js";
import { marketOptionsTool } from "./market.js";
import { referenceDataTool } from "./reference-data.js";
import type { ToolDefinition } from "./types.js";

// Register new tools here; server.ts lists and dispatches whatever is in this array
export const tools: ToolDefinition[] = [
  referenceDataTool,
  countriesTool,
  cropsTool,
  fertilizerOptionsTool,
  cassavaPriceTool,
  operationCostsTool,
  checkLocationTool,
  cropPricesTool,
  marketOptionsTool,
  checkPriceTool,
  investmentOptionsTool,
  computeRecommendationsTool,
  fertilizerPlanTool,
];
