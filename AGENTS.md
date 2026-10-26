# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that exposes the Akilimo agricultural API (IITA) as tools for LLM clients (Claude Desktop, Open WebUI + Ollama, etc.), plus a web UI that acts as a real MCP client for it and for the hosted Akilimo 2.0 server. pnpm monorepo, TypeScript throughout.

## Commands

Run from the repo root (pnpm workspace, Node 20+):

```bash
pnpm install
pnpm dev:server      # MCP server over stdio (vite-node packages/server/src/index.ts)
pnpm dev:server:http # MCP server over HTTP on :3001 (streamable HTTP /mcp, SSE /sse)
pnpm dev:web         # web UI at http://localhost:5173; proxies to the server above
pnpm build           # builds all @akilimo/* packages
pnpm start           # node packages/server/dist/index.cjs
pnpm --filter @akilimo/server build   # build only the server
docker-compose up -d # MCP server (127.0.0.1:3080), demo web UI (127.0.0.1:4173), Open WebUI (127.0.0.1:8089)
```

There is no test suite or linter configured.

Copy `.env.example` to `.env`; `config.ts` loads the repo-root `.env` with `process.loadEnvFile` (existing env vars win). Server env vars: `AKILIMO_API_BASE_URL`, `AKILIMO_API_KEY` (optional), `AKILIMO_DEVICE_TOKEN` (optional), `TRANSPORT` (`http`, or legacy `sse`, for HTTP; stdio otherwise; `--http` flag does the same), `PORT` (default 3001 locally; containers set 3000; port 3000 is taken by Dokploy on the dev machine), `ALLOWED_ORIGINS` (comma-separated CORS list). The web dev proxy reads `AKILIMO_1_MCP_URL` / `AKILIMO_2_MCP_URL`. `docker-compose` additionally requires `WEBUI_SECRET_KEY`.

## Architecture

- **Naming** — this repo's agent is **Akilimo 1.0** (MCP server name and client config key `akilimo-1.0`); the hosted MCP of the Akilimo 2.0 platform is **Akilimo 2.0** (`akilimo-2.0`): streamable HTTP at `https://mcp.akilimo.org/mcp`, partner key required (`Authorization: Bearer` or `X-API-Key`), no CORS support. Use these labels in code and docs.
- **Upstream API** — the Akilimo 1.0 API (Laravel, separate repo `new-akilimo-api`, hosted at `https://api.akilimo.org`, `composer dev` serves it locally on port 8600). Its `routes/api.php`, `app/Rules/*Rules.php` and `app/Data/*Data.php` are the source of truth for endpoints and the compute payload. Where the rules and DTOs disagree (e.g. rules say `unit_price_maize_1`, DTOs read `unit_price_maize1`), follow the DTOs. The R compute service behind it errors with "subscript out of bounds" on values it cannot look up, so shared schema defaults follow what the AKILIMO mobile app sends (`use_case` `FR`, `"NA"` instead of null, yield class instead of 0).
- **`packages/server`** (`@akilimo/server`) — the MCP server, split into modules under `src/`: `index.ts` (entry, picks the transport), `config.ts` (env vars), `server.ts` (builds the low-level `Server` from `@modelcontextprotocol/sdk` and dispatches `ListTools`/`CallTool` to the registry), `tools/` (one file per tool implementing `ToolDefinition` from `tools/types.ts`, registered in `tools/index.ts`), `transports/stdio.ts` and `transports/http.ts`. To add a tool, create a file in `tools/` and add it to the `tools` array; handlers may throw, `server.ts` turns errors into `isError` results. Tools:
  - `get_reference_data` → `GET /v1/{category}` or `/v1/{category}/country/{countryCode}`. `REFERENCE_CATEGORIES` and `COUNTRY_FILTERABLE` must match the API's public routes; only some categories have a `/country/` route.
  - `compute_recommendations` → `POST /v1/recommendations/compute` with `{ user_info, compute_request, fertilizer_list }`. The tool's JSON schema is generated from the shared Zod schema (`z.toJSONSchema(..., { io: "input" })`), so defaulted fields are optional for the model. `user_info` is filled with an anonymous `DEFAULT_USER_INFO` that callers may override.
  
  Transport is chosen at startup: stdio by default, or HTTP (`transports/http.ts`, Express) serving stateless streamable HTTP at `POST /mcp` (GET/DELETE return 405), legacy SSE at `GET /sse` + `POST /messages?sessionId=`, and `GET /health`. A `Server` instance can only serve one transport, so `index.ts` passes a factory and HTTP creates a server per request (streamable) or per session (SSE). Logs go to stderr (stdout is reserved for the stdio protocol).
- **`src/api/client.ts`** — axios wrapper sending `X-Api-Key` only when one is configured (the routes used are public), 120s timeout (compute calls are slow), normalizing errors to `[Akilimo API <status>] <message>`.
- **`packages/shared`** (`@akilimo/shared`) — Zod schemas (imported from `zod/v4`) mirroring the API's compute validation rules (camelCase section keys, snake_case fields, defaults matching the AKILIMO mobile app's requests), plus the web UI's `MCPEvent` activity type. Consumed as raw TS source (`main: src/index.ts`), no build step; the server's Vite build bundles it in (`ssr.noExternal: true`). `zod` is also a direct server dependency so it resolves from the server's own `node_modules` at runtime.
- **`packages/web`** (`@akilimo/web`) — React 18 + Bootstrap 5.3 MCP client (no mocks, no LLM). `src/mcp/servers.ts` lists the servers; `src/mcp/useMcpServers.ts` connects with the SDK's `StreamableHTTPClientTransport` through same-origin `/proxy/<server-id>/` paths (Vite `server.proxy` in dev, `nginx.conf` locations in Docker, because Akilimo 2.0 rejects CORS preflights). `ToolRunner` lists connected servers' tools and renders `SchemaForm`, a generic JSON-Schema form (nullable unions, enums, nested objects, arrays, JSON fallback) so the user enters every input; `ServerPanel` holds the connect switches and the in-memory Akilimo 2.0 key; `ActivityFeed` logs real calls. Any object in a schema with numeric lat/long-named fields gets a Leaflet/OpenStreetMap `MapPicker` (react-leaflet 4, since 5 needs React 19), centred on the object's `country_code` and rounding picks to 4 decimals. `src/mcp/presets.ts` holds per-tool prefill buttons keyed `${serverId}::${toolName}`; the compute presets fill typical defaults without overwriting user input, and load a country's available fertilizers plus middle-band fertilizer (`price_per_bag`) and cassava (`average_price`) prices via `get_reference_data`, skipping 0 and negative placeholder bands.

## Build / deployment gotchas

- The server is built with Vite in library/SSR mode (`packages/server/vite.config.ts`) to `dist/index.cjs`; runtime deps (`@modelcontextprotocol/sdk` and `zod` including their subpaths, `axios`, `express`, `cors`) are externalized, everything else (including `@akilimo/shared`) is bundled. A new runtime dependency must be added both to the server's `package.json` and to the Vite `external` list.
- Two images, both built with the repo root as context: `Dockerfile` (MCP server) and `packages/web/Dockerfile` (static web UI served by unprivileged nginx on 8080; `packages/web/nginx.conf` also proxies `/proxy/akilimo-1.0/` to `akilimo-mcp:3000` and `/proxy/akilimo-2.0/` to `https://mcp.akilimo.org`, resolving via Docker DNS at request time). Each installs only its own package via `pnpm install --filter <pkg>...`, but every workspace `package.json` must still be copied for the `--frozen-lockfile` check.
- The server image's runner gets its `node_modules` from `pnpm deploy --prod --legacy`, so runtime versions come from `pnpm-lock.yaml`. The pnpm version is pinned by `packageManager` in the root `package.json`. The server exposes `GET /health` (HTTP mode only) for the Docker `HEALTHCHECK`.
- pnpm 12 has written a peer-less `@modelcontextprotocol/sdk` version (`1.32.2` instead of `1.32.2(zod@3.25.76)`) into the web importer, leaving a dangling `node_modules` link and "Cannot find module '@modelcontextprotocol/sdk/…'" in `tsc`. Fix the importer entry in `pnpm-lock.yaml` and run `pnpm install --frozen-lockfile`.
- Open WebUI reaches Ollama on the Docker host via `host.docker.internal` (override with `OLLAMA_BASE_URL`); host Ollama must listen beyond `127.0.0.1` (`OLLAMA_HOST=0.0.0.0`). The compose file expects an external `dokploy-network` Docker network.
- `docs/MCP_CONNECTION_GUIDE.md` documents client configs and the hosted endpoints (Akilimo 1.0, this server, at `akilimo-mcp.akilimo.org/mcp` and `/sse`; Akilimo 2.0 at `mcp.akilimo.org/mcp`).
