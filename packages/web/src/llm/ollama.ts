// Minimal client for Ollama's native chat API, reached through the same-origin /proxy/ollama path
// (vite.config.ts, nginx.conf). The native API is used because it lets us raise num_ctx: tool
// schemas plus the system prompt overflow Ollama's small default context.
import type { ChatMessage, ToolSpec } from './types';

const BASE = '/proxy/ollama';

// Enough for the compute tool schema, instructions and a conversation; fits an 8B model on 6 GB VRAM
const CONTEXT_TOKENS = 8192;

const json = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
};

// Models whose long reasoning pass we switch off: it makes each answer take minutes on a laptop GPU
const thinkingModels = new Set<string>();

// Installed models that support tool calling
export async function listToolModels(): Promise<string[]> {
  const { models } = await json<{ models: { name: string }[] }>(await fetch(`${BASE}/api/tags`));
  const checked = await Promise.all(models.map(async ({ name }) => {
    const info = await json<{ capabilities?: string[] }>(await fetch(`${BASE}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    }));
    if (info.capabilities?.includes('thinking')) thinkingModels.add(name);
    return info.capabilities?.includes('tools') ? name : null;
  }));
  return checked.filter((n): n is string => n !== null);
}

export interface PullProgress {
  status: string; // e.g. "pulling manifest", "downloading", "verifying sha256 digest", "success"
  completed?: number;
  total?: number;
}

// Downloads a model into the local Ollama (POST /api/pull streams one JSON object per line)
export async function pullModel(name: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as PullProgress & { error?: string };
      if (event.error) throw new Error(event.error);
      onProgress(event);
    }
    if (done) return;
  }
}

// Reasoning models may inline their thinking; users only need the answer
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export async function chat(model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length ? tools : undefined,
      stream: false,
      // Only sent to models that support it; others reject the parameter
      ...(thinkingModels.has(model) ? { think: false } : {}),
      options: { num_ctx: CONTEXT_TOKENS, temperature: 0.3 },
    }),
    signal,
  });
  const { message } = await json<{ message: ChatMessage }>(res);
  return { ...message, content: stripThinking(message.content ?? '') };
}
