# Akilimo MCP Connection Guide

This guide explains how to connect the Akilimo MCP Agent to various LLM clients and providers.

## 1. Claude Desktop (Native Support)
Claude Desktop is currently the primary client with native MCP support.

### Local Connection (Stdio)
Add this to your `claude_desktop_config.json` (found in `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "akilimo": {
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
`https://akilimo-mcp.akilimo.org/sse`

---

## 2. ChatGPT & DeepSeek
Currently, ChatGPT and DeepSeek's official desktop apps do not have a native `config.json` for MCP servers like Claude does. To use them, you must use an **MCP Gateway/Proxy**.

### Using an MCP Proxy
1. Install an MCP-to-OpenAI proxy (e.g., `mcp-proxy` or custom bridge).
2. The proxy converts MCP tool definitions into OpenAI "Function Calling" (Tools) format.
3. In the ChatGPT "Custom GPT" or DeepSeek API settings, add the proxy URL as an **Action**.

**Action Schema Example:**
- **URL**: `https://your-mcp-proxy.com/akilimo`
- **Authentication**: API Key (provided by your proxy)

---

## 3. Ollama (Local Hosting)
Ollama is an LLM *provider*, not a *client*. To use MCP tools with Ollama, you need a **Client Interface** that supports both Ollama and MCP.

### Recommended: Open WebUI
Open WebUI is the most popular interface for Ollama that supports tool integration.

1. Install **Open WebUI**.
2. Connect it to your local Ollama instance.
3. Go to **Workspace** $\rightarrow$ **Tools**.
4. Import the Akilimo MCP server by providing the SSE URL:
   `https://akilimo-mcp.akilimo.org/sse`
5. Select the Akilimo tools when chatting with your local Ollama model.

---

## Summary Table

| Client | Connection Method | Config Type | Status |
| :--- | :--- | :--- | :--- |
| **Claude Desktop** | Stdio / SSE | JSON Config | ✅ Native |
| **ChatGPT** | Proxy $\rightarrow$ Actions | OpenAPI Spec | ⚠️ Via Proxy |
| **DeepSeek** | Proxy $\rightarrow$ Actions | OpenAPI Spec | ⚠️ Via Proxy |
| **Ollama** | Open WebUI $\rightarrow$ MCP | UI Settings | ✅ Via Client |

## Troubleshooting
- **Permission Denied**: Ensure the `dist/index.js` file is executable and you have read access to the directory.
- **Timeout**: The Akilimo API can take up to 120s for computations; ensure your client timeout is set high enough.
- **API Key**: Double check that your `AKILIMO_API_KEY` is valid and has the required scopes.
