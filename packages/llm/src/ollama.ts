import type { ChatMessage, ToolSpec } from "@akilimo/shared";

// Client for Ollama's native chat API. The native API is used because it lets us raise num_ctx: tool
// schemas plus the system prompt overflow Ollama's small default context.

// The compute tool schema, the instructions (which have grown) and several tools already take about
// half of 8192 tokens, and Ollama silently drops the oldest messages beyond num_ctx, which made the
// assistant forget what the farmer had said; 16384 leaves room for a conversation. Set OLLAMA_NUM_CTX
// lower for a small GPU.
const CONTEXT_TOKENS = Number(globalThis.process?.env?.OLLAMA_NUM_CTX) || 16384;

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
};

// Models whose long reasoning pass we switch off: it makes each answer take minutes on a laptop GPU
const thinkingModels = new Set<string>();

// Ollama Cloud takes the API key as a bearer token; a local Ollama needs no headers
const authHeaders = (key: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

// Models that support tool calling. `lenient` is for Ollama Cloud, whose /api/show is not
// documented: a model it cannot describe is listed instead of dropped.
export async function listToolModels(base: string, key = "", lenient = false): Promise<string[]> {
  const headers = authHeaders(key);
  const { models } = await json<{ models: { name: string }[] }>(await fetch(`${base}/api/tags`, { headers }));
  const checked = await Promise.all(models.map(async ({ name }) => {
    try {
      const info = await json<{ capabilities?: string[] }>(await fetch(`${base}/api/show`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      }));
      if (info.capabilities?.includes("thinking")) thinkingModels.add(name);
      return info.capabilities?.includes("tools") ? name : null;
    } catch (error) {
      if (lenient) return name;
      throw error;
    }
  }));
  return checked.filter((n): n is string => n !== null);
}

// Reasoning models may inline their thinking; users only need the answer
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export async function chat(base: string, key: string, model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length ? tools : undefined,
      stream: false,
      // Only sent to models that support it; others reject the parameter
      ...(thinkingModels.has(model) ? { think: false } : {}),
      options: { num_ctx: CONTEXT_TOKENS, temperature: 0.3 },
    }),
    ...(signal ? { signal } : {}),
  });
  const { message } = await json<{ message: ChatMessage }>(res);
  return { ...message, content: stripThinking(message.content ?? "") };
}
