// Client for Anthropic's Messages API (Claude), reached through the server's /llm relay
import { request, type Endpoint } from './openai';
import { pairToolIds } from './toolIds';
import type { ChatMessage, ToolCall, ToolSpec } from './types';

const MAX_TOKENS = 4096;

// Newest first, as the API returns them
export async function listModels(endpoint: Endpoint): Promise<string[]> {
  const { data } = await request<{ data: { id: string }[] }>(endpoint, 'models?limit=100');
  return data.map(m => m.id);
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage { role: 'user' | 'assistant'; content: Block[] }

// System prompt goes to the top-level field; tool results are user-turn blocks; consecutive
// messages of the same role are merged because the API expects alternating turns
const toAnthropic = (messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } => {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const out: AnthropicMessage[] = [];
  for (const { message: m, toolCallId } of pairToolIds(messages)) {
    let role: AnthropicMessage['role'];
    let blocks: Block[];
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      role = 'user';
      blocks = [{ type: 'tool_result', tool_use_id: toolCallId ?? 'call_unknown', content: m.content, ...(m.content.startsWith('Error:') ? { is_error: true } : {}) }];
    } else if (m.role === 'assistant') {
      role = 'assistant';
      blocks = [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...(m.tool_calls ?? []).map(c => ({ type: 'tool_use' as const, id: c.id!, name: c.function.name, input: c.function.arguments ?? {} })),
      ];
    } else {
      role = 'user';
      blocks = [{ type: 'text', text: m.content }];
    }
    if (blocks.length === 0) continue;
    const last = out[out.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  return { system, messages: out };
};

export async function chat(endpoint: Endpoint, model: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatMessage> {
  const { system, messages: converted } = toAnthropic(messages);
  const { content } = await request<{ content: Block[] }>(endpoint, 'messages', {
    method: 'POST',
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      ...(system ? { system } : {}),
      messages: converted,
      ...(tools.length ? {
        tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
      } : {}),
    }),
    signal,
  });
  const text = content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
  const toolCalls: ToolCall[] = content
    .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
    .map(b => ({ id: b.id, function: { name: b.name, arguments: b.input ?? {} } }));
  return { role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}
