export interface MCPEvent {
  id: string;
  timestamp: Date;
  type: 'thought' | 'tool_call' | 'tool_response' | 'synthesis';
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
  content: string;
  payload?: any;
  delay: number;
}
