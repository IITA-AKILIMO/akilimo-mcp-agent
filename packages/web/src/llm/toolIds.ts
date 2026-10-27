import type { ChatMessage } from './types';

// OpenAI and Anthropic pair each tool result with the call it answers by id. Ollama has no ids and
// saved conversations do not store them on tool messages, so ids are assigned here: calls without
// one get call_<message>_<call>, and tool messages take the preceding calls' ids in order (the
// agent loop answers calls in the order they were made).
export function pairToolIds(messages: ChatMessage[]): { message: ChatMessage; toolCallId?: string }[] {
  let pending: string[] = [];
  return messages.map((message, i) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const withIds = message.tool_calls.map((c, j) => ({ ...c, id: c.id || `call_${i}_${j}` }));
      pending = withIds.map(c => c.id);
      return { message: { ...message, tool_calls: withIds } };
    }
    if (message.role === 'tool') return { message, toolCallId: pending.shift() };
    pending = [];
    return { message };
  });
}
