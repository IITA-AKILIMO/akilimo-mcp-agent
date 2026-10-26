import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the MCP protocol, so logs go to stderr
  console.error("Akilimo 1.0 MCP Agent running on stdio");
}
