export interface MCPEvent {
  id: string;
  timestamp: Date;
  type: 'thought' | 'tool_call' | 'tool_response' | 'synthesis';
  server: string; // Added to identify which MCP server is acting
  message: string;
  payload?: any;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export interface ScenarioStep {
  type: 'user_message' | 'tool_call' | 'tool_response' | 'assistant_message';
  server?: string; // Which server is performing the action
  content: string;
  payload?: any;
  delay: number;
}
