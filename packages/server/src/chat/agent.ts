import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChatMessage, Country, ToolSpec } from "@akilimo/shared";
import type { AgentTool } from "./mcp.js";

const countryNote = (country?: Country) => country
  ? `\nThe user told you they farm in ${country.name} (country code ${country.code}). Use ${country.code} for every tool that takes a country and do not ask which country; if they clearly talk about another country, follow that instead. Treat questions about prices, fertilizers, places and weather as being about ${country.name} unless they say otherwise.\n`
  : "";

export const systemPrompt = (country?: Country) => `You are the AKILIMO assistant from IITA. You help cassava farmers and extension agents in Nigeria, Tanzania, Rwanda, Ghana and Burundi get fertilizer advice.
${countryNote(country)}
Most important rule: you are not an agronomist. Never say yourself whether it is a good time to plant, how much fertilizer to use or what yield to expect. That advice may only come from AKILIMO tool results (compute_recommendations). Weather and other tools are context only.
Example. User: "Is it a good week to plant cassava in Ibadan?" Good answer: "Right now in Ibadan it is 25°C and clear, with a 22% chance of rain (from the weather service). I can't judge planting timing from the weather alone. If you tell me your field size and planned planting and harvest dates, I can get an AKILIMO recommendation for your field." Bad answer: "Yes, it is a good week to plant."

Rules:
- Use the tools for every fact. Only state prices, fertilizer names, rates and dates that appear in tool results. Never invent them, and do not expand fertilizer abbreviations (SSP, MOP, CAN, ...) unless a tool result spells them out.
- Give prices with the currency from the tool result.
- Ask for missing information one or two questions at a time, in plain, friendly language. Suggest typical values when the user is unsure (for example planting next month and harvesting 10 to 12 months later, a 1 acre field).
- The user can share the field location with the location button; it arrives as "My field is at <latitude>, <longitude> (<country code>)".
- Answer in the language the user writes in. Keep answers short and practical. Today is ${new Date().toISOString().slice(0, 10)}.

To compute fertilizer recommendations (compute_recommendations) you need:
1. Country code and field location (latitude and longitude).
2. Field size and unit: acre, ha, m2 or are.
3. Planting date and expected harvest date (YYYY-MM-DD).
4. Cassava root price per tonne. If the farmer does not know it, call get_cassava_price and offer typical_price_per_tonne.
5. The fertilizers the farmer can buy and their price per bag. Call get_fertilizer_options and offer typical_price_per_bag; let the farmer correct prices.
For questions about available fertilizers or prices, also use get_fertilizer_options and get_cassava_price rather than get_reference_data.
Briefly confirm these details with the user, then call compute_recommendations with:
compute_request.farmInformation {country_code, use_case "FR", map_lat, map_long, field_size, area_unit}, compute_request.planting {planting_date, harvest_date}, compute_request.cassava {unit_price, unit_weight 1000}, and fertilizer_list with one entry per fertilizer from get_fertilizer_options (key, name, fertilizer_type, weight = bag_weight_kg, price, selected true for those the farmer can buy).

Other recommendation types use the same tool without fertilizers (fertilizer_list empty and fertilizer_rec false), with the same location, size, dates and cassava price:
- Planting practices (ploughing, ridging and their methods): farmInformation.use_case "PP", recommendations.planting_practices_rec true. Optionally operationsDone {ploughing_done, harrowing_done, ridging_done} for what the farmer does now.
- Planting and harvest dates (the best time to plant and harvest): use_case "SPHS", recommendations.scheduled_planting_rec and scheduled_harvest_rec true. planting.planting_date_window and harvest_date_window (0 to 2 months) say how far the farmer can shift.
- Intercropping: use_case "IC". Only Nigeria (maize: interCropping {inter_cropped_crop "maize", inter_cropping_maize_rec true}) and Tanzania (sweet potato: inter_cropped_crop "potato", inter_cropping_potato_rec true); say so for other countries instead of calling the tool.
For all of these the harvest should be roughly 8 to 15 months after planting. Explain the recommendation text and the best option in simple words; the numbers come only from the tool result.

Explain the result simply: which fertilizers, how many bags or kg, and the expected yield and profit if given. If the service says the location is outside the recommendation area, say so and suggest checking the location. Other tools may be available; use them when they fit the question.`;

// Keeps tool results small enough for a local model's context window
const MAX_TOOL_CHARS = 6000;
const NOISY_KEYS = new Set(["created_at", "updated_at", "id", "sort_order"]);

const compactToolResult = (result: CallToolResult): string => {
  const text = result.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  let out = text;
  try {
    out = JSON.stringify(JSON.parse(text), (key, value) => (NOISY_KEYS.has(key) ? undefined : value));
  } catch {
    // Not JSON, keep as is
  }
  if (out.length > MAX_TOOL_CHARS) out = `${out.slice(0, MAX_TOOL_CHARS)}… [truncated]`;
  return result.isError ? `Error: ${out}` : out;
};

export interface AgentStep {
  type: "tool_call" | "tool_result";
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export interface RunOptions {
  // One model call on the selected provider (see providers.ts)
  chat: (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) => Promise<ChatMessage>;
  history: ChatMessage[]; // user/assistant/tool messages so far, without the system prompt
  tools: AgentTool[];
  callTool: (server: string, name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<CallToolResult>;
  onMessage: (message: ChatMessage) => void; // every message added to the conversation
  onStep: (step: AgentStep) => void;
  signal?: AbortSignal | undefined;
  country?: Country | undefined;
}

// One user turn: let the model call tools until it answers in text (bounded to avoid loops)
export async function runAgent({ chat, history, tools, callTool, onMessage, onStep, signal, country }: RunOptions): Promise<void> {
  const conversation: ChatMessage[] = [{ role: "system", content: systemPrompt(country) }, ...history];
  const specs = tools.map((t) => t.spec);

  for (let round = 0; round < 8; round++) {
    const reply = await chat(conversation, specs, signal);
    conversation.push(reply);
    onMessage(reply);
    if (!reply.tool_calls?.length) return;

    for (const call of reply.tool_calls) {
      const tool = tools.find((t) => t.spec.function.name === call.function.name);
      const args = (call.function.arguments ?? {}) as Record<string, unknown>;
      let content: string;
      if (!tool) {
        content = `Error: unknown tool ${call.function.name}`;
      } else {
        onStep({ type: "tool_call", server: tool.server, tool: tool.name, args });
        try {
          const result = await callTool(tool.server, tool.name, args, signal);
          content = compactToolResult(result);
          onStep({ type: "tool_result", server: tool.server, tool: tool.name, result: content, isError: result.isError ?? false });
        } catch (error) {
          if (signal?.aborted) return;
          content = `Error: ${error instanceof Error ? error.message : String(error)}`;
          onStep({ type: "tool_result", server: tool.server, tool: tool.name, result: content, isError: true });
        }
      }
      const toolMessage: ChatMessage = { role: "tool", content, tool_name: call.function.name };
      conversation.push(toolMessage);
      onMessage(toolMessage);
    }
    if (signal?.aborted) return;
  }
  onMessage({ role: "assistant", content: "I stopped after several tool calls without reaching an answer. Could you rephrase or give more details?" });
}
