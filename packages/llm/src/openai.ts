import type { ChatMessage, ToolCall, ToolSpec } from "@akilimo/shared";
import { pairToolIds } from "./toolIds.js";

// Client for OpenAI-compatible chat APIs (OpenAI, Gemini, DeepSeek, Groq, Mistral, OpenRouter and
// self-hosted servers), called from the server with the key an admin saved.
export interface Endpoint {
  base: string; // e.g. https://api.openai.com/v1
  headers: Record<string, string>; // authentication
  label: string; // for error messages
}

// Shared with anthropic.ts; both APIs put the reason in error.message
export const request = async <T>(endpoint: Endpoint, path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${endpoint.base}/${path}`, {
    ...init,
    headers: { Accept: "application/json", ...endpoint.headers, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text);
      message = body.error?.message ?? body.error ?? body.message ?? message;
    } catch { /* not JSON */ }
    throw new Error(`${endpoint.label} ${res.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
  }
  return res.json() as Promise<T>;
};

// Model lists include embedding, speech, image and moderation models that cannot chat
const NOT_CHAT = /embed|whisper|tts|transcri|speech|audio|realtime|dall-e|image|imagen|moderation|davinci|babbage|guard|aqa|search|computer-use|ocr/i;

interface ModelEntry { id: string; supported_parameters?: string[] }

export async function listModels(endpoint: Endpoint): Promise<string[]> {
  const { data } = await request<{ data: ModelEntry[] }>(endpoint, "models");
  return data
    // OpenRouter says which models take tools; other providers do not
    .filter((m) => !m.supported_parameters || m.supported_parameters.includes("tools"))
    .map((m) => m.id.replace(/^models\//, ""))
    .filter((id) => !NOT_CHAT.test(id))
    .sort((a, b) => a.localeCompare(b));
}

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const toOpenAi = (messages: ChatMessage[]): OpenAiMessage[] =>
  pairToolIds(messages).map(({ message: m, toolCallId }): OpenAiMessage => {
    if (m.role === "tool") return { role: "tool", tool_call_id: toolCallId ?? "call_unknown", content: m.content };
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.tool_calls?.length ? {
          tool_calls: m.tool_calls.map((c) => ({ id: c.id!, type: "function" as const, function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) } })),
        } : {}),
      };
    }
    return { role: m.role, content: m.content };
  });

const parseArguments = (raw: string | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

interface Completion {
  choices: { message: { content: string | null; tool_calls?: { id?: string; function: { name: string; arguments?: string } }[] } }[];
}

export async function chat(endpoint: Endpoint, model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  const { choices } = await request<Completion>(endpoint, "chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, messages: toOpenAi(messages), ...(tools.length ? { tools } : {}) }),
    ...(signal ? { signal } : {}),
  });
  const message = choices[0]?.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((c) => ({
    id: c.id || `call_${crypto.randomUUID().slice(0, 8)}`,
    function: { name: c.function.name, arguments: parseArguments(c.function.arguments) },
  }));
  return {
    role: "assistant",
    content: (message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}
