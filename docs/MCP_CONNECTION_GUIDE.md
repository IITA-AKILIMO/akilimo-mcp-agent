# Akilimo MCP Connection Guide

This guide explains how to connect the Akilimo MCP Agents to various LLM clients and providers.

## 1. Available Akilimo MCP Servers

There are two Akilimo MCP agents. Use the names **akilimo-1.0** and **akilimo-2.0** in client configs so they are easy to tell apart.

### Akilimo 1.0 Agent (This Repo)
The agent built in this repository, backed by the Akilimo 1.0 API (the Laravel `new-akilimo-api`, hosted at `https://api.akilimo.org`). No key needed. In HTTP mode it serves two transports:
- **Streamable HTTP** (current MCP transport): `/mcp`
- **SSE** (older clients): `/sse`

| Where | Base URL |
| :--- | :--- |
| Hosted | `https://akilimo-mcp.akilimo.org` |
| Local (`pnpm dev:server:http`) | `http://localhost:3001` |
| docker compose (from the host) | `http://localhost:3080` |
| docker compose (from other containers) | `http://akilimo-mcp:3000` |
| Claude Desktop and other stdio clients | `node packages/server/dist/index.cjs` |

- **Tools**:
  - `get_fertilizer_options` — a country's available fertilizers with bag weight, price bands and a typical price (compact; best for chat models)
  - `get_cassava_price` — cassava root price bands and a typical price per tonne
  - `compute_recommendations` — fertilizer recommendations for a farm
  - `get_reference_data` — any raw reference list (all pages merged)

### Akilimo 2.0 Agent (Hosted)
The hosted MCP server of the Akilimo 2.0 platform ([developer portal](https://app2.akilimo.org/developers/mcp-connect)).
- **Streamable HTTP**: `https://mcp.akilimo.org/mcp`
- **Partner key required** on every request, as `Authorization: Bearer <key>` or `X-API-Key: <key>`; without it the edge replies `401 missing API key`. Keys are issued to your workspace by Hub operations.
- It does not answer browser CORS preflights, so browser apps must go through a same-origin proxy (the web UI in this repo does).

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
      "type": "http",
      "url": "https://mcp.akilimo.org/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PARTNER_KEY"
      }
    }
  }
}
```

### Remote Connection
For clients that support remote MCP servers:
- Akilimo 1.0: `https://akilimo-mcp.akilimo.org/mcp` (streamable HTTP) or `https://akilimo-mcp.akilimo.org/sse` (SSE)
- Akilimo 2.0: `https://mcp.akilimo.org/mcp` (streamable HTTP, partner key header required)

### This repo's web UI and MCP gateway
`pnpm dev:web` (or the `web` compose service) reaches MCP servers through the **gateway** on the Akilimo 1.0 server, via the same-origin `/gateway/` path (see `packages/web/vite.config.ts` and `packages/web/nginx.conf`; override the dev target with `AKILIMO_1_MCP_URL`, default `http://localhost:3001`). Its chat mode reaches Ollama through `/proxy/ollama/` (dev: `OLLAMA_URL`, default `http://localhost:11434`; Docker: `OLLAMA_BASE_URL`).

Gateway endpoints (HTTP mode only):

| Method and path | Purpose | Auth |
| :--- | :--- | :--- |
| `GET /gateway/servers` | Registered servers and whether editing is enabled | none |
| `GET /gateway/admin` | Check an admin token (204) | admin |
| `POST /gateway/servers`, `PUT /gateway/servers/:id`, `DELETE /gateway/servers/:id` | Add, change, remove a server | admin |
| `POST/GET/DELETE /gateway/servers/:id/mcp` | Streamable HTTP proxy to that server | the user's key in `X-Mcp-Key`, forwarded as the entry's bearer token or header |

Admin requests send `Authorization: Bearer <GATEWAY_ADMIN_TOKEN>`. Without `GATEWAY_ADMIN_TOKEN` the registry is read-only. Only admins can add targets because the gateway will call any URL it is given, including internal ones.

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
4. Add the Akilimo MCP servers, naming them `akilimo-1.0` and `akilimo-2.0`:
   - Akilimo 1.0: `https://akilimo-mcp.akilimo.org/mcp`; from the bundled docker compose use `http://akilimo-mcp:3000/mcp`.
   - Akilimo 2.0: `https://mcp.akilimo.org/mcp` with your partner key as the bearer token.
5. Select the Akilimo tools when chatting with your local Ollama model.

---

## Summary Table

| Server | Endpoint | Method | Status |
| :--- | :--- | :--- | :--- |
| **akilimo-1.0** (this repo) | `akilimo-mcp.akilimo.org/mcp` | Streamable HTTP / SSE / stdio | ✅ Development |
| **akilimo-1.0** (local) | `localhost:3001` / `localhost:3080` | Streamable HTTP / SSE / stdio | ✅ Local |
| **akilimo-2.0** | `mcp.akilimo.org/mcp` | Streamable HTTP, partner key | ✅ Production |

## Troubleshooting
- **Permission Denied**: Ensure `packages/server/dist/index.cjs` exists (`pnpm --filter @akilimo/server build`) and you have read access to the directory.
- **Timeout**: The Akilimo API can take up to 120s for computations; ensure your client timeout is set high enough.
- **API Key**: Reference data and recommendations are public on the Akilimo 1.0 API; `AKILIMO_API_KEY` is only needed for protected routes.
