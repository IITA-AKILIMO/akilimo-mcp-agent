import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AkilimoApiClient } from "../api/client.js";

export type ToolArgs = Record<string, unknown> | undefined;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  handler: (args: ToolArgs, api: AkilimoApiClient) => Promise<CallToolResult>;
}

export const jsonResult = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
