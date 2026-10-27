// Client for the chat API on the Akilimo 1.0 server (packages/server/src/chat), reached through the
// same-origin /chat path. The server holds the provider keys and runs the model calls and the MCP
// tool calls; the browser only sends the conversation and shows what comes back.
import type { LlmTest, ProviderId } from '@akilimo/llm';
import type { ChatMessage } from '@akilimo/shared';

// The provider code itself lives in @akilimo/llm and runs on the server; the browser only needs its types
export type { LlmTest, ProviderId };

// What every signed-in user sees of a provider
export interface ProviderOption { id: ProviderId; label: string }

// What admins see and edit; keys are never sent back, only the last characters
export interface ProviderStatus extends ProviderOption {
  key: 'none' | 'required' | 'optional';
  keyUrl?: string;
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  keyHint: string | null;
  editableBase: boolean;
}

export interface AgentStep {
  type: 'tool_call' | 'tool_result';
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

const fail = async (res: Response): Promise<never> => {
  let message = `Request failed (${res.status})`;
  try { message = (await res.json()).error ?? message; } catch { /* not JSON */ }
  throw new Error(message);
};

const request = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`/chat${path}`, {
    method,
    credentials: 'same-origin',
    // Always JSON on writes: the server rejects other content types (CSRF guard)
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (!res.ok) await fail(res);
  return res.json() as Promise<T>;
};

export const fetchProviders = () => request<{ admin: boolean; providers: (ProviderOption | ProviderStatus)[] }>('GET', '/providers');
export const fetchModels = (provider: ProviderId) =>
  request<{ models: string[]; default: string | null }>('GET', `/models/${provider}`);
export const testProvider = (provider: ProviderId, model: string) => request<LlmTest>('POST', '/test', { provider, model });

// Admin: provider settings (a key is sent once and stored encrypted) and MCP server keys
export interface ProviderChange { apiKey?: string; clearKey?: boolean; baseUrl?: string; enabled?: boolean }
export const updateProvider = (id: ProviderId, change: ProviderChange) =>
  request<{ providers: ProviderStatus[] }>('PUT', `/admin/providers/${id}`, change);
export const getServerKeys = () => request<{ keys: Record<string, string> }>('GET', '/admin/server-keys');
export const setServerKey = (id: string, key: string) => request<{ keys: Record<string, string> }>('PUT', `/admin/server-keys/${id}`, { key });
export const deleteServerKey = (id: string) => request<{ keys: Record<string, string> }>('DELETE', `/admin/server-keys/${id}`);

interface StreamOptions {
  provider: ProviderId;
  model: string;
  country?: string;
  messages: ChatMessage[]; // user/assistant/tool messages so far, without the system prompt
  signal?: AbortSignal;
  onMessage: (message: ChatMessage) => void; // every message the server adds to the conversation
  onStep: (step: AgentStep) => void;
  onWarning: (text: string) => void; // e.g. an MCP server that could not be reached
}

type StreamEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'step'; step: AgentStep }
  | { type: 'warning'; text: string }
  | { type: 'error'; error: string }
  | { type: 'ping' }
  | { type: 'done' };

// One user turn: the server runs the agent loop and streams events as newline-delimited JSON
export async function streamChat({ provider, model, country, messages, signal, onMessage, onStep, onWarning }: StreamOptions): Promise<void> {
  const res = await fetch('/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, country, messages }),
    signal,
  });
  if (!res.ok) await fail(res);
  if (!res.body) throw new Error('The server sent no answer');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finished = false; // the server ends every answer with a "done" event
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'message') onMessage(event.message);
      else if (event.type === 'step') onStep(event.step);
      else if (event.type === 'warning') onWarning(event.text);
      else if (event.type === 'error') throw new Error(event.error);
      else if (event.type === 'done') finished = true;
    }
    if (done) {
      // A stream that just ends (a proxy or the network cut it) must not look like a finished answer
      if (!finished && !signal?.aborted) throw new Error('The connection was interrupted before the answer was complete. Please send your question again.');
      return;
    }
  }
}
