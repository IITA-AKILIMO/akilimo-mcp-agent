// LLM providers the chat can use. Ollama (local) is the default; hosted providers go through the
// server's /llm relay (packages/server/src/llm/routes.ts) with the user's own key; a custom
// OpenAI-compatible server (LM Studio, vLLM, ...) is called directly from the browser.
import { read, write } from '../mcp/keys';
import * as anthropic from './anthropic';
import * as ollama from './ollama';
import * as openai from './openai';
import type { ChatMessage, ToolSpec } from './types';

export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'openrouter' | 'custom';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  api: 'ollama' | 'openai' | 'anthropic';
  key: 'none' | 'required' | 'optional';
  keyUrl?: string;
  // Picked when the user has not chosen a model yet: the first pattern with a match wins, and the
  // last match in the sorted list (usually the newest version)
  preferred: RegExp[];
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'ollama', label: 'Ollama (local)', api: 'ollama', key: 'none', preferred: [/^qwen3/, /^qwen2\.5(?!-coder)/, /^llama3\.1/, /^mistral/, /^llama3\.2/] },
  { id: 'openai', label: 'OpenAI', api: 'openai', key: 'required', keyUrl: 'https://platform.openai.com/api-keys', preferred: [/^gpt-4\.1-mini$/, /^gpt-4o-mini$/] },
  { id: 'anthropic', label: 'Anthropic (Claude)', api: 'anthropic', key: 'required', keyUrl: 'https://console.anthropic.com/settings/keys', preferred: [/^claude-sonnet/, /^claude-haiku/] },
  { id: 'gemini', label: 'Google Gemini', api: 'openai', key: 'required', keyUrl: 'https://aistudio.google.com/apikey', preferred: [/^gemini-[\d.]+-flash$/] },
  { id: 'deepseek', label: 'DeepSeek', api: 'openai', key: 'required', keyUrl: 'https://platform.deepseek.com/api_keys', preferred: [/^deepseek-chat$/] },
  { id: 'groq', label: 'Groq', api: 'openai', key: 'required', keyUrl: 'https://console.groq.com/keys', preferred: [/^llama-3\.3-70b/] },
  { id: 'mistral', label: 'Mistral', api: 'openai', key: 'required', keyUrl: 'https://console.mistral.ai/api-keys', preferred: [/^mistral-small-latest$/, /^mistral-large-latest$/] },
  { id: 'openrouter', label: 'OpenRouter', api: 'openai', key: 'required', keyUrl: 'https://openrouter.ai/keys', preferred: [/^openai\/gpt-4\.1-mini$/, /^openai\/gpt-4o-mini$/] },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', api: 'openai', key: 'optional', preferred: [] },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0]!;

export interface LlmConfig {
  provider: ProviderId;
  key: string;
  baseUrl: string; // custom provider only
}

// Choices remembered in this browser: provider, last model per provider, custom server URL, and
// the user's keys (like the MCP server keys in mcp/keys.ts)
interface StoredSettings { provider: ProviderId; models: Partial<Record<ProviderId, string>>; baseUrl: string }
const SETTINGS = 'llm-settings';
const KEYS = 'llm-provider-keys';

export const loadSettings = (): StoredSettings => {
  const stored = read<Partial<StoredSettings>>(SETTINGS, {});
  return {
    provider: PROVIDERS.some(p => p.id === stored.provider) ? stored.provider! : 'ollama',
    models: stored.models ?? {},
    baseUrl: stored.baseUrl ?? '',
  };
};
export const saveSettings = (settings: StoredSettings) => write(SETTINGS, settings);
export const loadProviderKeys = (): Partial<Record<ProviderId, string>> => read(KEYS, {});
export const saveProviderKey = (id: ProviderId, key: string) => {
  const keys = loadProviderKeys();
  if (key) keys[id] = key;
  else delete keys[id];
  write(KEYS, keys);
};

// What the user still has to fill in before models can be listed, if anything
export function missingSetup(config: LlmConfig): string | null {
  const info = providerInfo(config.provider);
  if (config.provider === 'custom' && !/^https?:\/\/\S+$/.test(config.baseUrl)) return 'Enter the server URL, for example http://localhost:1234/v1';
  if (info.key === 'required' && !config.key) return `Enter your ${info.label} API key`;
  return null;
}

const endpointFor = (config: LlmConfig): openai.Endpoint => {
  const info = providerInfo(config.provider);
  if (config.provider === 'custom') {
    return { base: config.baseUrl.replace(/\/+$/, ''), headers: config.key ? { Authorization: `Bearer ${config.key}` } : {}, label: 'Custom server' };
  }
  return { base: `/llm/${config.provider}`, headers: { 'X-Llm-Key': config.key }, label: info.label };
};

export async function listModels(config: LlmConfig): Promise<string[]> {
  const info = providerInfo(config.provider);
  if (info.api === 'ollama') return ollama.listToolModels();
  try {
    const models = info.api === 'anthropic' ? await anthropic.listModels(endpointFor(config)) : await openai.listModels(endpointFor(config));
    return [...models].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    // fetch rejects with a TypeError when the server is unreachable or blocks the request (CORS)
    if (error instanceof TypeError && config.provider === 'custom') {
      throw new Error(`Cannot reach ${config.baseUrl}. Check the URL, and that the server allows requests from this site (CORS).`);
    }
    throw error;
  }
}

export function pickDefaultModel(provider: ProviderId, models: string[]): string | undefined {
  for (const pattern of providerInfo(provider).preferred) {
    const matches = models.filter(m => pattern.test(m));
    if (matches.length) return matches[matches.length - 1];
  }
  return models[0];
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
  type: 'function',
  function: { name: 'ping', description: 'Connection test. Call it when asked to.', parameters: { type: 'object', properties: {}, required: [] } },
};

// Lists the models (reachability and key) and sends the selected model one tiny tool-calling request
export async function testConnection(config: LlmConfig, model: string): Promise<LlmTest> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const models = await listModels(config);
    if (!model) return { ok: models.length > 0, ms: elapsed(), models: models.length, ...(models.length ? {} : { error: 'Connected, but no usable model was found' }) };
    const reply = await chat(config, model, [
      { role: 'system', content: 'This is a connection test. Do exactly what the user asks.' },
      { role: 'user', content: 'Call the ping tool now.' },
    ], [PROBE_TOOL], AbortSignal.timeout(90_000));
    return {
      ok: true,
      ms: elapsed(),
      models: models.length,
      model,
      toolCall: !!reply.tool_calls?.some(c => c.function.name === 'ping'),
      reply: reply.content.slice(0, 160),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, ms: elapsed(), error: error instanceof DOMException && error.name === 'TimeoutError' ? 'The model did not answer within 90 s' : message };
  }
}

export function chat(config: LlmConfig, model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  const info = providerInfo(config.provider);
  if (info.api === 'ollama') return ollama.chat(model, messages, tools, signal);
  if (info.api === 'anthropic') return anthropic.chat(endpointFor(config), model, messages, tools, signal);
  return openai.chat(endpointFor(config), model, messages, tools, signal);
}
