# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that exposes the Akilimo agricultural API (IITA) as tools for LLM clients (Claude Desktop, Open WebUI + Ollama, etc.), plus a demo web UI. pnpm monorepo, TypeScript throughout.

## Commands

Run from the repo root (pnpm workspace, Node 20+):

```bash
pnpm install
pnpm dev:server      # vite-node packages/server/src/index.ts (stdio transport unless TRANSPORT=sse)
pnpm dev:web         # Vite dev server for the demo UI at http://localhost:5173
pnpm build           # builds all @akilimo/* packages
pnpm start           # node packages/server/dist/index.cjs
pnpm --filter @akilimo/server build   # build only the server
docker-compose up -d # MCP server (127.0.0.1:3080), demo web UI (127.0.0.1:4173), Open WebUI (127.0.0.1:8089)
```

There is no test suite or linter configured.

Copy `.env.example` to `.env`. Server env vars: `AKILIMO_API_BASE_URL`, `AKILIMO_API_KEY`, `AKILIMO_V2_API_KEY`, `TRANSPORT` (`sse` or stdio by default), `PORT`, `ALLOWED_ORIGINS` (comma-separated CORS list). `docker-compose` additionally requires `WEBUI_SECRET_KEY`.

## Architecture

- **`packages/server`** (`@akilimo/server`) — the MCP server, all in `src/index.ts`. Uses the low-level `Server` from `@modelcontextprotocol/sdk` with manual `ListToolsRequestSchema` / `CallToolRequestSchema` handlers (not `McpServer.tool()`). Tools:
  - `get_reference_data` → `GET /v1/{category}` or `/v1/{category}/country/{countryCode}`; the allowed categories are an `enum` in the tool's inputSchema.
  - `compute_recommendations` → validates the payload with `ComputeRequestSchema` from `@akilimo/shared`, then `POST /v1/recommendations/compute`.
  
  Adding a tool means editing both handlers. Transport is chosen at startup: stdio by default, or Express + `SSEServerTransport` (`GET /sse`, `POST /messages`) when `TRANSPORT=sse`. The SSE path keeps a single module-level `transport`, so only one SSE client is effectively supported at a time. Logs go to stderr (stdout is reserved for the stdio protocol).
- **`src/api/client.ts`** — axios wrapper sending `X-Api-Key` and `X-Akilimo-V2-Key` headers, 120s timeout (compute calls are slow), normalizing errors to `[Akilimo API <status>] <message>`.
- **`packages/shared`** (`@akilimo/shared`) — Zod schemas for the compute request plus UI types (`MCPEvent`, `Message`, `Scenario`). Consumed as raw TS source (`main: src/index.ts`), no build step; the server's Vite build bundles it in (`ssr.noExternal: true`). `zod` is also a direct server dependency so it resolves from the server's own `node_modules` at runtime.
- **`packages/web`** (`@akilimo/web`) — React 18 + Tailwind + framer-motion "showcase" UI (chat pane + "Engine Room" activity feed). It does **not** connect to the MCP server; it replays hard-coded `DEMO_SCENARIOS` in `App.tsx` with timed delays.

## Build / deployment gotchas

- The server is built with Vite in library/SSR mode (`packages/server/vite.config.ts`) to `dist/index.cjs`; runtime deps (`@modelcontextprotocol/sdk` and its subpaths, `axios`, `express`, `cors`, `zod`) are externalized, everything else (including `@akilimo/shared`) is bundled. A new runtime dependency must be added both to the server's `package.json` and to the Vite `external` list.
- Two images, both built with the repo root as context: `Dockerfile` (MCP server) and `packages/web/Dockerfile` (static demo UI served by unprivileged nginx on 8080, config in `packages/web/nginx.conf`). Each installs only its own package via `pnpm install --filter <pkg>...`, but every workspace `package.json` must still be copied for the `--frozen-lockfile` check.
- The server image's runner gets its `node_modules` from `pnpm deploy --prod --legacy`, so runtime versions come from `pnpm-lock.yaml`. The pnpm version is pinned by `packageManager` in the root `package.json`. The server exposes `GET /health` (SSE mode only) for the Docker `HEALTHCHECK`.
- Open WebUI reaches Ollama on the Docker host via `host.docker.internal` (override with `OLLAMA_BASE_URL`); host Ollama must listen beyond `127.0.0.1` (`OLLAMA_HOST=0.0.0.0`). The compose file expects an external `dokploy-network` Docker network.
- `docs/MCP_CONNECTION_GUIDE.md` documents client configs and the hosted endpoints (this server at `akilimo-mcp.akilimo.org/sse`, the official Akilimo 2.0 MCP at `app2.akilimo.org/mcp/sse`).
