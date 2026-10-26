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

Copy `.env.example` to `.env`. Server env vars: `AKILIMO_API_BASE_URL`, `AKILIMO_API_KEY` (optional), `AKILIMO_DEVICE_TOKEN` (optional), `TRANSPORT` (`sse` or stdio by default), `PORT`, `ALLOWED_ORIGINS` (comma-separated CORS list). `docker-compose` additionally requires `WEBUI_SECRET_KEY`.

## Architecture

- **Naming** — this repo's agent is **Akilimo 1.0** (MCP server name and client config key `akilimo-1.0`); the hosted MCP at `app2.akilimo.org` is **Akilimo 2.0** (`akilimo-2.0`). Use these labels in code, demo scenarios and docs.
- **Upstream API** — the Akilimo 1.0 API (Laravel, separate repo `new-akilimo-api`, hosted at `https://api.akilimo.org`, `composer dev` serves it locally on port 8600). Its `routes/api.php`, `app/Rules/*Rules.php` and `app/Data/*Data.php` are the source of truth for endpoints and the compute payload. Where the rules and DTOs disagree (e.g. rules say `unit_price_maize_1`, DTOs read `unit_price_maize1`), follow the DTOs. The R compute service behind it errors with "subscript out of bounds" on values it cannot look up, so shared schema defaults follow what the AKILIMO mobile app sends (`use_case` `FR`, `"NA"` instead of null, yield class instead of 0).
- **`packages/server`** (`@akilimo/server`) — the MCP server, all in `src/index.ts`. Uses the low-level `Server` from `@modelcontextprotocol/sdk` with manual `ListToolsRequestSchema` / `CallToolRequestSchema` handlers (not `McpServer.tool()`). Tools:
  - `get_reference_data` → `GET /v1/{category}` or `/v1/{category}/country/{countryCode}`. `REFERENCE_CATEGORIES` and `COUNTRY_FILTERABLE` must match the API's public routes; only some categories have a `/country/` route.
  - `compute_recommendations` → `POST /v1/recommendations/compute` with `{ user_info, compute_request, fertilizer_list }`. The tool's JSON schema is generated from the shared Zod schema (`z.toJSONSchema(..., { io: "input" })`), so defaulted fields are optional for the model. `user_info` is filled with an anonymous `DEFAULT_USER_INFO` that callers may override.
  
  Adding a tool means editing both handlers. Transport is chosen at startup: stdio by default, or Express + `SSEServerTransport` (`GET /sse`, `POST /messages`) when `TRANSPORT=sse`. The SSE path keeps a single module-level `transport`, so only one SSE client is effectively supported at a time. Logs go to stderr (stdout is reserved for the stdio protocol).
- **`src/api/client.ts`** — axios wrapper sending `X-Api-Key` only when one is configured (the routes used are public), 120s timeout (compute calls are slow), normalizing errors to `[Akilimo API <status>] <message>`.
- **`packages/shared`** (`@akilimo/shared`) — Zod schemas (imported from `zod/v4`) mirroring the API's compute validation rules (camelCase section keys, snake_case fields, defaults matching the AKILIMO mobile app's requests), plus UI types (`MCPEvent`, `Message`, `Scenario`). Consumed as raw TS source (`main: src/index.ts`), no build step; the server's Vite build bundles it in (`ssr.noExternal: true`). `zod` is also a direct server dependency so it resolves from the server's own `node_modules` at runtime.
- **`packages/web`** (`@akilimo/web`) — React 18 + Tailwind + framer-motion "showcase" UI (chat pane + "Engine Room" activity feed). It does **not** connect to the MCP server; it replays hard-coded `DEMO_SCENARIOS` in `App.tsx` with timed delays.

## Build / deployment gotchas

- The server is built with Vite in library/SSR mode (`packages/server/vite.config.ts`) to `dist/index.cjs`; runtime deps (`@modelcontextprotocol/sdk` and `zod` including their subpaths, `axios`, `express`, `cors`) are externalized, everything else (including `@akilimo/shared`) is bundled. A new runtime dependency must be added both to the server's `package.json` and to the Vite `external` list.
- Two images, both built with the repo root as context: `Dockerfile` (MCP server) and `packages/web/Dockerfile` (static demo UI served by unprivileged nginx on 8080, config in `packages/web/nginx.conf`). Each installs only its own package via `pnpm install --filter <pkg>...`, but every workspace `package.json` must still be copied for the `--frozen-lockfile` check.
- The server image's runner gets its `node_modules` from `pnpm deploy --prod --legacy`, so runtime versions come from `pnpm-lock.yaml`. The pnpm version is pinned by `packageManager` in the root `package.json`. The server exposes `GET /health` (SSE mode only) for the Docker `HEALTHCHECK`.
- Open WebUI reaches Ollama on the Docker host via `host.docker.internal` (override with `OLLAMA_BASE_URL`); host Ollama must listen beyond `127.0.0.1` (`OLLAMA_HOST=0.0.0.0`). The compose file expects an external `dokploy-network` Docker network.
- `docs/MCP_CONNECTION_GUIDE.md` documents client configs and the hosted endpoints (Akilimo 1.0, this server, at `akilimo-mcp.akilimo.org/sse`; Akilimo 2.0 at `app2.akilimo.org/mcp/sse`).
