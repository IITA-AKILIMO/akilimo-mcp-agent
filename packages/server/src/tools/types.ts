import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AkilimoApiClient } from "../api/client.js";

export type ToolArgs = Record<string, unknown> | undefined;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  // Behaviour hints for clients; server.ts marks every tool read-only unless a tool says otherwise
  annotations?: Tool["annotations"];
  handler: (args: ToolArgs, api: AkilimoApiClient) => Promise<CallToolResult>;
}

// An error whose message is written for the caller (bad input, missing data); server.ts shows it,
// while any other error is only logged and answered with a generic message
export class ToolError extends Error {}

export const jsonResult = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
