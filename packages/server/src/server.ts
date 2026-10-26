import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AkilimoApiClient } from "./api/client.js";
import { tools } from "./tools/index.js";
import { errorResult } from "./tools/types.js";

export function createServer(api: AkilimoApiClient): Server {
  const server = new Server(
    {
      // Akilimo 1.0 = this agent on the Laravel Akilimo API; Akilimo 2.0 is the hosted MCP at app2.akilimo.org
      name: "akilimo-1.0",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
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
      return errorResult(error.message);
    }
  });

  return server;
}
