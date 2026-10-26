# Akilimo MCP Connection Guide

This guide explains how to connect the Akilimo MCP Agents to various LLM clients and providers.

## 1. Available Akilimo MCP Servers

Depending on your needs, you can use the custom agent or the official Akilimo 2.0 agent.

### Official Akilimo 2.0 Agent (Hosted)
The official, production-ready MCP server for Akilimo.
- **SSE Endpoint**: `https://app2.akilimo.org/mcp/sse` (refer to [developer portal](https://app2.akilimo.org/developers/mcp-connect) for latest)
- **Best for**: Production usage, stable official tools.

### Custom Akilimo MCP Agent (This Repo)
The specialized agent built in this repository.
- **Hosted**: `https://akilimo-mcp.akilimo.org/sse`
- **Local**: `http://localhost:3000/sse`
- **Best for**: Custom extensions, specific demo scenarios, and internal development.

## 2. Connection Instructions

### Claude Desktop (Native Support)
Add this to your `claude_desktop_config.json` (found in `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "akilimo-official": {
      "command": "node",
      "args": [], 
      "url": "https://app2.akilimo.org/mcp/sse"
    },
    "akilimo-custom": {
      "command": "node",
      "args": ["D:/Dev/php/akilimo-mcp-agent/dist/index.js"],
      "env": {
        "AKILIMO_API_BASE_URL": "https://api.akilimo.org",
        "AKILIMO_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Remote Connection (SSE)
For clients that support remote SSE endpoints, use:
- Official: `https://app2.akilimo.org/mcp/sse`
- Custom: `https://akilimo-mcp.akilimo.org/sse`

---

## 3. ChatGPT & DeepSeek
Currently, ChatGPT and DeepSeek's official desktop apps do not have a native `config.json` for MCP servers like Claude does. To use them, you must use an **MCP Gateway/Proxy**.

### Using an MCP Proxy
1. Install an MCP-to-OpenAI proxy (e.g., `mcp-proxy` or custom bridge).
2. The proxy converts MCP tool definitions into OpenAI "Function Calling" (Tools) format.
3. In the ChatGPT "Custom GPT" or DeepSeek API settings, add the proxy URL as an **Action**.

**Action Schema Example:**
- **URL**: `https://your-mcp-proxy.com/akilimo`
- **Authentication**: API Key (provided by your proxy)

---

## 4. Ollama (Local Hosting)
Ollama is an LLM *provider*, not a *client*. To use MCP tools with Ollama, you need a **Client Interface** that supports both Ollama and MCP.

### Recommended: Open WebUI
Open WebUI is the most popular interface for Ollama that supports tool integration.

1. Install **Open WebUI**.
2. Connect it to your local Ollama instance.
3. Go to **Workspace** $\rightarrow$ **Tools**.
4. Import the Akilimo MCP server by providing the SSE URL:
   `https://akilimo-mcp.akilimo.org/sse` OR `https://app2.akilimo.org/mcp/sse`
5. Select the Akilimo tools when chatting with your local Ollama model.

---

## Summary Table

| Server | Endpoint | Method | Status |
| :--- | :--- | :--- | :--- |
| **Akilimo 2.0 (Official)** | `app2.akilimo.org` | SSE | ✅ Production |
| **Akilimo Custom** | `akilimo-mcp.akilimo.org` | SSE/Stdio | ✅ Development |
| **Local Custom** | `localhost:3000` | SSE/Stdio | ✅ Local |

## Troubleshooting
- **Permission Denied**: Ensure the `dist/index.js` file is executable and you have read access to the directory.
- **Timeout**: The Akilimo API can take up to 120s for computations; ensure your client timeout is set high enough.
- **API Key**: Double check that your `AKILIMO_API_KEY` is valid and has the required scopes.
