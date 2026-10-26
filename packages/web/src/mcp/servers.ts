export interface McpServerConfig {
  id: string;
  label: string;
  description: string;
  // Same-origin proxy path, see vite.config.ts and nginx.conf
  url: string;
  needsKey: boolean;
  keyHelp?: string;
}

export const MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'akilimo-1.0',
    label: 'Akilimo 1.0',
    description: 'This repository\'s agent on the Akilimo 1.0 API',
    url: '/proxy/akilimo-1.0/mcp',
    needsKey: false,
  },
  {
    id: 'akilimo-2.0',
    label: 'Akilimo 2.0',
    description: 'Hosted agent at mcp.akilimo.org',
    url: '/proxy/akilimo-2.0/mcp',
    needsKey: true,
    keyHelp: 'Partner key issued by Hub operations, sent as Authorization: Bearer',
  },
];
