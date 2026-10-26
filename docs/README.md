# Akilimo MCP Agent

An MCP server that interfaces with the Akilimo Agricultural API to provide farming recommendations and reference data to LLMs.

**Official Hosted Instance:** `https://akilimo-mcp.akilimo.org`

## Setup

### Using the Hosted Version
If you are using a client that supports remote MCP servers, you can connect directly to:
`https://akilimo-mcp.akilimo.org`

### Local Development
1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Configure your `AKILIMO_API_BASE_URL` and `AKILIMO_API_KEY`.

## Running the Agent locally

### Development (Stdio)
```bash
pnpm dev
```

### Development (SSE/Hosted)
```bash
TRANSPORT=sse pnpm dev
```

### Showcase UI (For Demos)
We have a dedicated Showcase Dashboard to demonstrate the MCP flow to stakeholders.
1. Navigate to the web folder: `cd web`
2. Install dependencies: `pnpm install`
3. Start the UI: `pnpm dev`
4. Open `http://localhost:5173`

### Docker Compose (Local Stack)
Run the agent and Open WebUI (connects to Ollama running on your host):
```bash
docker-compose up -d
```
- **MCP Agent**: `http://localhost:3000/sse`
- **Open WebUI**: `http://localhost:8080`
- **Ollama**: (Using host machine at `http://localhost:11434`)

### Production
```bash
pnpm build
pnpm start
```

## Tools Implementation

- `get_reference_data`: Fetches regional data (fertilizers, prices, etc.).
- `compute_recommendations`: Orchestrates the complex `ComputeRequestData` payload to get agricultural advice.

## Configuration for Claude Desktop (Local)

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "akilimo": {
      "command": "node",
      "args": ["D:/Dev/php/akilimo-mcp-agent/dist/index.js"],
      "env": {
        "AKILIMO_API_BASE_URL": "https://api.akilimo.org",
        "AKILIMO_API_KEY": "your-api-key"
      }
    }
  }
}
```
