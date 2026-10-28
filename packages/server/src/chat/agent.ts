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
- As soon as you have a field location, call check_location with the country and the coordinates. If covered is false, tell the user the spot is outside the area AKILIMO supports and ask them to pick another one (the map shows the supported area); do not call compute_recommendations for it. If covered is true or null, carry on.
- The user can share the field location with the location button; it arrives as "My field is at <latitude>, <longitude> (<country code>)".
- The user can also pick the dates on a calendar; they arrive as "I plan to plant on <YYYY-MM-DD> and harvest on <YYYY-MM-DD>. Planting window: <0-2>, harvest window: <0-2> (...)". Use those dates exactly, and pass the two windows (how many months the date can shift, 0, 1 or 2) as planting.planting_date_window and planting.harvest_date_window.
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

Also ask what cassava yield the farmer gets now (fresh roots per hectare in a normal season) and send the class as compute_request.yieldInfo.current_field_yield: 3.75 (under 7.5 t/ha), 11.25 (7.5 to 15), 18.75 (15 to 22.5), 26.25 (22.5 to 30) or 33.75 (over 30). One acre is about 0.4 hectare, so help a farmer who thinks in acres. It matters: the advice treats 15 t/ha or more as a high yield, and on low-yield fields ploughing and ridging never pay, so never guess it; if the farmer does not know, say that 11.25 (low) is assumed and that the advice may then be too cautious.

Shape of a complete call (the values only show the format; never copy them, use what the user told you and what the tools returned; call it only when you have all of them, and ask for anything missing, above all the planting and harvest dates):
{"compute_request":{"farmInformation":{"country_code":"NG","use_case":"FR","map_lat":7.38,"map_long":3.9,"field_size":1,"area_unit":"acre"},"planting":{"planting_date":"2026-11-27","harvest_date":"2027-09-27"},"cassava":{"unit_price":15000,"unit_weight":1000},"yieldInfo":{"current_field_yield":18.75},"recommendations":{"lang":"en"}},"fertilizer_list":[{"key":"<key>","name":"<name>","fertilizer_type":"<type>","weight":50,"price":18000,"selected":true}]}
If the tool answers "Invalid payload", fix exactly what it lists, or ask the user for the missing information, and try again.

Other recommendation types use the same tool without fertilizers (fertilizer_list empty and fertilizer_rec false), with the same location, size, dates and cassava price:
- Planting practices (ploughing, ridging and their methods): farmInformation.use_case "PP", recommendations.planting_practices_rec true. Ask which of ploughing, harrowing and ridging the farmer does now and, for each one done, whether it is done by hand or with a tractor. Send that as operationsDone {ploughing_done, harrowing_done, ridging_done}, methods {method_ploughing, method_harrowing, method_ridging} ("manual" or "tractor"; use "manual" for operations not done) and tractorCosts {tractor_plough, tractor_harrow, tractor_ridger} (true only for an operation done with a tractor). Also call get_operation_costs for the country, tell the farmer the typical costs it returns (per the field's area unit), let them correct them, and send them as manualCosts {cost_manual_ploughing, cost_manual_harrowing, cost_manual_ridging}, tractorCosts {cost_tractor_ploughing, cost_tractor_harrowing, cost_tractor_ridging, cost_lmo_area_basis "areaUnit"} and weedingCosts {cost_weeding_one, cost_weeding_two}. A cost that is null has no standard value: ask the farmer for it or send 0, and say that the advice is less reliable without costs.
- Planting and harvest dates (the best time to plant and harvest): use_case "SPHS", recommendations.scheduled_planting_rec and scheduled_harvest_rec true. planting.planting_date_window and harvest_date_window (0 to 2 months) say how far the farmer can shift.
- Intercropping: use_case "IC". Only Nigeria (maize: interCropping {inter_cropped_crop "maize", inter_cropping_maize_rec true}) and Tanzania (sweet potato: inter_cropped_crop "potato", inter_cropping_potato_rec true); say so for other countries instead of calling the tool.
For all of these the planting date may be at most 6 months in the past, and the harvest must be 8 to 12 months after planting; if the user gives dates outside that, explain the limit and ask for other dates. Explain the recommendation text and the best option in simple words; the numbers come only from the tool result.

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

  // Small models sometimes answer with nothing (or only hidden reasoning) after a tool result, which
  // would look like the chat just stopped: ask once more, then say so in words
  let nudged = false;

  for (let round = 0; round < 8; round++) {
    let reply = await chat(conversation, specs, signal);
    if (!reply.tool_calls?.length && !reply.content.trim()) {
      if (!nudged) {
        nudged = true;
        conversation.push({ role: "user", content: "Please answer now in plain words, using the information above." });
        continue;
      }
      reply = { role: "assistant", content: "I could not put an answer together this time. Please try again, or ask in a different way." };
    }
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
