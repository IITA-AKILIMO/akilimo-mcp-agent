// Provider-neutral chat format used by the agent loop and saved conversations. It follows Ollama's
// native shape; providers.ts converts it to and from each provider's API.

export interface ToolCall {
  // Set by providers that pair tool results with calls (OpenAI, Anthropic); Ollama has none
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
