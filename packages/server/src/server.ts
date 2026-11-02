import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json" with { type: "json" };
import type { AkilimoApiClient } from "./api/client.js";
import { tools } from "./tools/index.js";
import { errorResult, ToolError } from "./tools/types.js";

// Every tool only reads (reference data, computed advice, public soil, climate and exchange rate
// services); none changes anything, and all of them reach services outside this server
const TOOL_HINTS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createServer(api: AkilimoApiClient): Server {
  const server = new Server(
    {
      // Akilimo 1.0 = this agent on the Laravel Akilimo API; Akilimo 2.0 is the hosted MCP at app2.akilimo.org
      name: "akilimo-1.0",
      version: pkg.version,
    },
    {
      // Only tools: declaring resources or prompts without handlers makes those requests fail
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations: { ...TOOL_HINTS, ...annotations },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return errorResult(`Tool not found: ${name}`);
    }

    try {
      return await tool.handler(args, api);
    } catch (error: any) {
      // Tool and API errors are written for the caller; anything else (a bug, a library error) is only logged
      if (error instanceof ToolError) return errorResult(error.message);
      console.error(`Tool ${name} failed:`, error);
      return errorResult(`${name} failed unexpectedly, try again later`);
    }
  });

  return server;
}
