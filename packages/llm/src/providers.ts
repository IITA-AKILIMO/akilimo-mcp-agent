import type { ChatMessage, ToolSpec } from "@akilimo/shared";
import * as anthropic from "./anthropic.js";
import * as ollama from "./ollama.js";
import * as openai from "./openai.js";

export type ProviderId = "ollama" | "ollama-cloud" | "openai" | "anthropic" | "gemini" | "deepseek" | "groq" | "mistral" | "openrouter" | "custom";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  api: "ollama" | "openai" | "anthropic";
  // Fixed endpoint of a hosted provider; ollama and custom use the URL an admin saved
  base?: string;
  key: "none" | "required" | "optional";
  keyUrl?: string;
  // Picked when the user has not chosen a model yet: the first pattern with a match wins, and the
  // last match in the sorted list (usually the newest version)
  preferred: RegExp[];
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "ollama", label: "Ollama (local)", api: "ollama", key: "none", preferred: [/^qwen3/, /^qwen2\.5(?!-coder)/, /^llama3\.1/, /^mistral/, /^llama3\.2/] },
  { id: "ollama-cloud", label: "Ollama Cloud", api: "ollama", base: "https://ollama.com", key: "required", keyUrl: "https://ollama.com/settings/keys", preferred: [/^gpt-oss/, /^qwen3/, /^deepseek/, /^gemma/] },
  { id: "openai", label: "OpenAI", api: "openai", base: "https://api.openai.com/v1", key: "required", keyUrl: "https://platform.openai.com/api-keys", preferred: [/^gpt-4\.1-mini$/, /^gpt-4o-mini$/] },
  { id: "anthropic", label: "Anthropic (Claude)", api: "anthropic", base: "https://api.anthropic.com/v1", key: "required", keyUrl: "https://console.anthropic.com/settings/keys", preferred: [/^claude-sonnet/, /^claude-haiku/] },
  { id: "gemini", label: "Google Gemini", api: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "required", keyUrl: "https://aistudio.google.com/apikey", preferred: [/^gemini-[\d.]+-flash$/] },
  { id: "deepseek", label: "DeepSeek", api: "openai", base: "https://api.deepseek.com", key: "required", keyUrl: "https://platform.deepseek.com/api_keys", preferred: [/^deepseek-chat$/] },
  { id: "groq", label: "Groq", api: "openai", base: "https://api.groq.com/openai/v1", key: "required", keyUrl: "https://console.groq.com/keys", preferred: [/^llama-3\.3-70b/] },
  { id: "mistral", label: "Mistral", api: "openai", base: "https://api.mistral.ai/v1", key: "required", keyUrl: "https://console.mistral.ai/api-keys", preferred: [/^mistral-small-latest$/, /^mistral-large-latest$/] },
  { id: "openrouter", label: "OpenRouter", api: "openai", base: "https://openrouter.ai/api/v1", key: "required", keyUrl: "https://openrouter.ai/keys", preferred: [/^openai\/gpt-4\.1-mini$/, /^openai\/gpt-4o-mini$/] },
  { id: "custom", label: "Custom (OpenAI-compatible)", api: "openai", key: "optional", preferred: [] },
];

export const providerInfo = (id: string) => PROVIDERS.find((p) => p.id === id);

// A provider with everything needed to call it: the saved base URL and the decrypted key
export interface ResolvedProvider {
  info: ProviderInfo;
  base: string;
  key: string;
}

const endpointFor = ({ info, base, key }: ResolvedProvider): openai.Endpoint => ({
  base: base.replace(/\/+$/, ""),
  label: info.label,
  headers: info.api === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : key ? { Authorization: `Bearer ${key}` } : {},
});

export function pickDefaultModel(provider: ProviderInfo, models: string[]): string | undefined {
  for (const pattern of provider.preferred) {
    const matches = models.filter((m) => pattern.test(m));
    if (matches.length) return matches[matches.length - 1];
  }
  return models[0];
}

export async function listModels(provider: ResolvedProvider): Promise<string[]> {
  if (provider.info.api === "ollama") return ollama.listToolModels(provider.base, provider.key, provider.info.id === "ollama-cloud");
  const models = provider.info.api === "anthropic"
    ? await anthropic.listModels(endpointFor(provider))
    : await openai.listModels(endpointFor(provider));
  return [...models].sort((a, b) => a.localeCompare(b));
}

export function chat(provider: ResolvedProvider, model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  if (provider.info.api === "ollama") return ollama.chat(provider.base, provider.key, model, messages, tools, signal);
  if (provider.info.api === "anthropic") return anthropic.chat(endpointFor(provider), model, messages, tools, signal);
  return openai.chat(endpointFor(provider), model, messages, tools, signal);
}

export interface LlmTest {
  ok: boolean;
  ms: number;
  models?: number;
  model?: string;
  toolCall?: boolean; // the model called the probe tool, so tool calling (needed for AKILIMO) works
  reply?: string;
  error?: string;
}

const PROBE_TOOL: ToolSpec = {
  type: "function",
  function: { name: "ping", description: "Connection test. Call it when asked to.", parameters: { type: "object", properties: {}, required: [] } },
};

// Lists the models (reachability and key) and sends the selected model one tiny tool-calling request
export async function testProvider(provider: ResolvedProvider, model: string): Promise<LlmTest> {
  const started = Date.now();
  try {
    const models = await listModels(provider);
    if (!model) return { ok: models.length > 0, ms: Date.now() - started, models: models.length, ...(models.length ? {} : { error: "Connected, but no usable model was found" }) };
    const reply = await chat(provider, model, [
      { role: "system", content: "This is a connection test. Do exactly what the user asks." },
      { role: "user", content: "Call the ping tool now." },
    ], [PROBE_TOOL], AbortSignal.timeout(90_000));
    return {
      ok: true,
      ms: Date.now() - started,
      models: models.length,
      model,
      toolCall: !!reply.tool_calls?.some((c) => c.function.name === "ping"),
      reply: reply.content.slice(0, 160),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    const message = error instanceof Error ? (error.message === "fetch failed" && cause?.code ? `Cannot connect: ${cause.code}` : error.message) : String(error);
    return { ok: false, ms: Date.now() - started, error: timedOut ? "The model did not answer within 90 s" : message };
  }
}
