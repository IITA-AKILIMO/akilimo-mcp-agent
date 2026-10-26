# Akilimo MCP Connection Guide

This guide explains how to connect the Akilimo MCP Agents to various LLM clients and providers.

## 1. Available Akilimo MCP Servers

There are two Akilimo MCP agents. Use the names **akilimo-1.0** and **akilimo-2.0** in client configs so they are easy to tell apart.

### Akilimo 1.0 Agent (This Repo)
The agent built in this repository, backed by the Akilimo 1.0 API (the Laravel `new-akilimo-api`, hosted at `https://api.akilimo.org`).
- **Hosted**: `https://akilimo-mcp.akilimo.org/sse`
- **Local**: `http://localhost:3000/sse` (`pnpm dev:server` with `TRANSPORT=sse`) or `http://localhost:3080/sse` (docker compose)
- **Tools**: `get_reference_data`, `compute_recommendations`
- **Best for**: Custom extensions, demo scenarios and internal development.

### Akilimo 2.0 Agent (Hosted)
The hosted MCP server of the Akilimo 2.0 platform.
- **SSE Endpoint**: `https://app2.akilimo.org/mcp/sse` (refer to [developer portal](https://app2.akilimo.org/developers/mcp-connect) for latest)
- **Best for**: Production usage on the Akilimo 2.0 platform.

## 2. Connection Instructions

### Claude Desktop (Native Support)
Add this to your `claude_desktop_config.json` (found in `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "akilimo-1.0": {
      "command": "node",
      "args": ["D:/Dev/php/akilimo-mcp-agent/packages/server/dist/index.cjs"],
      "env": {
        "AKILIMO_API_BASE_URL": "https://api.akilimo.org"
      }
    },
    "akilimo-2.0": {
      "url": "https://app2.akilimo.org/mcp/sse"
    }
  }
}
```


### Remote Connection (SSE)
For clients that support remote SSE endpoints, use:
- Akilimo 1.0: `https://akilimo-mcp.akilimo.org/sse`
- Akilimo 2.0: `https://app2.akilimo.org/mcp/sse`

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
4. Import the Akilimo MCP servers by providing their SSE URLs, naming them `akilimo-1.0` and `akilimo-2.0`:
   `https://akilimo-mcp.akilimo.org/sse` (Akilimo 1.0) and `https://app2.akilimo.org/mcp/sse` (Akilimo 2.0).
   From the bundled docker compose, Open WebUI reaches Akilimo 1.0 at `http://akilimo-mcp:3000/sse`.
5. Select the Akilimo tools when chatting with your local Ollama model.

---

## Summary Table

| Server | Endpoint | Method | Status |
| :--- | :--- | :--- | :--- |
| **akilimo-1.0** (this repo) | `akilimo-mcp.akilimo.org` | SSE/Stdio | ✅ Development |
| **akilimo-1.0** (local) | `localhost:3000` / `localhost:3080` | SSE/Stdio | ✅ Local |
| **akilimo-2.0** | `app2.akilimo.org` | SSE | ✅ Production |

## Troubleshooting
- **Permission Denied**: Ensure `packages/server/dist/index.cjs` exists (`pnpm --filter @akilimo/server build`) and you have read access to the directory.
- **Timeout**: The Akilimo API can take up to 120s for computations; ensure your client timeout is set high enough.
- **API Key**: Reference data and recommendations are public on the Akilimo 1.0 API; `AKILIMO_API_KEY` is only needed for protected routes.
