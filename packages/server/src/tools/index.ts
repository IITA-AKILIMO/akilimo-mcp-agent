import { computeRecommendationsTool } from "./compute-recommendations.js";
import { referenceDataTool } from "./reference-data.js";
import type { ToolDefinition } from "./types.js";

// Register new tools here; server.ts lists and dispatches whatever is in this array
export const tools: ToolDefinition[] = [
  referenceDataTool,
  computeRecommendationsTool,
];
