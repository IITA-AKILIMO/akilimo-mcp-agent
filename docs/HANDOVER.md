# Handover: AKILIMO MCP agent

> **IITA Internal Use.** Written 2026-10-26, updated 2026-11-02 (MCP endpoint hardening and keys) for the next agent or developer picking up this repository. Read [`AGENTS.md`](../AGENTS.md) for architecture and conventions; this file covers state, decisions and open work. It contains no credentials.

## 1. What this project is

A pnpm monorepo (TypeScript) for IITA's AKILIMO cassava advisory tools:

- **`packages/server`**: the **Akilimo 1.0** MCP server (MCP name `akilimo-1.0`). Wraps the Akilimo 1.0 REST API (Laravel repo `new-akilimo-api`, hosted at `https://api.akilimo.org`). Over HTTP it also hosts an **MCP gateway** (shared server registry and proxy) and an **accounts API** (PostgreSQL).
- **`packages/web`**: a React + Bootstrap web UI that is a real MCP client. **Chat** mode (default) has a Guided view (no AI) and an Ask AI view whose model and tool calls run on the server (`/chat`), with providers set up by admins; **Advanced** mode runs tools through forms generated from their schemas.
- **`packages/shared`**: the Zod compute-request schema and shared types.
- **Akilimo 2.0** is a separate hosted MCP server (`https://mcp.akilimo.org/mcp`, partner key required). It is not in this repo.

## 2. Current state

| Area | State |
| :--- | :--- |
| Branch | `main`; everything is pushed to `origin/main` except the MCP endpoint hardening and key commit described below, which is local until pushed |
| Builds | `pnpm build` passes; the server passes a strict `tsc` check; `pnpm install --frozen-lockfile` passes |
| Tests | No automated test suite exists. Everything below was verified by hand (scripts and browser) |

Use `git log` for the history. The latest piece of work, newest first:

- **MCP endpoint hardening and client keys** (after the scanner at mcpplaygroundonline.com scored 56/100): Origin check against `ALLOWED_ORIGINS`, per-IP rate limits (compute stricter), SSE session caps and idle timeout, security headers, JSON-RPC errors without internals, `ToolError` so only safe messages reach callers, tool annotations, real version, only the `tools` capability. Optional keys like Akilimo 2.0 (`Authorization: Bearer` or `X-API-Key`): operator keys in `MCP_API_KEYS`, and **MCP keys users create in the Akilimo API playground** (`ak_…`, ability `mcp:use`), checked by the API's `POST /v1/mcp/verify-key` with this server's `AKILIMO_API_KEY` (ability `mcp:verify-keys`), cached 60 s / 30 s. A key is always mandatory (the `MCP_REQUIRE_KEY` switch was removed). The matching API side is in `new-akilimo-api` (`docs/MCP_KEYS.md` there). A first version also let users create keys in this web UI (`akm_…`, own table); the user chose the API as the only place that issues keys, so it was removed before committing.
## 3. Features and how they were verified

| Feature | Where | Verified |
| :--- | :--- | :--- |
| `get_reference_data` returns **all pages** (the API paginates at 50 rows) | `server/src/api/client.ts` `getAll` | NG fertilizer prices: 60 of 60 rows |
| Compact advisory tools `get_fertilizer_options`, `get_cassava_price` | `server/src/tools/advisory.ts` | About 3 KB vs 28 KB; NG lists all 10 fertilizers |
| `compute_recommendations` matches the API and mobile app payload | `shared/src/index.ts` | One live call to production succeeded (location was outside the recommendation area, so no rates came back) |
| Streamable HTTP `/mcp` plus multi-client SSE | `server/src/transports/http.ts` | SDK clients, two concurrent SSE sessions |
| Chat mode (agent loop, now on the server) | `server/src/chat/`, `ChatView.tsx` | `qwen3:8b`: correct NG fertilizer answer in under 30 s; asks for missing farm details |
| MCP gateway: registry, admin API, proxy | `server/src/gateway/` | Add, edit, remove, validation, 401/404/409, key forwarding, Akilimo 2.0 401 passthrough |
| Server manager UI | `ServerManager.tsx`, `ServerPanel.tsx` | Browser: unlock, add, connect, edit, remove |
| Accounts, saved chats, activity | `server/src/accounts/`, `server/src/db/`, `web/src/account/` | API script (isolation, rate limit, CSRF guard, hashed storage) and browser round trip |
| Drizzle ORM with PostgreSQL, migrations applied by the server at start | `server/src/db/`, `server/drizzle/`, `server/drizzle.config.ts` | Baseline applied to an empty DB gave the same tables, indexes, FKs and enum as the Prisma-created one; the existing Prisma-created DB adopted it with data intact and a repeat run is a no-op; full API, roles, seeding and sign-in scripts passed; server image built, ran against an empty DB (migrated, seeded, healthy, sign-in OK) |
| Prefill buttons and map picker (country via Nominatim) | `web/src/mcp/presets.ts`, `MapPicker.tsx` | Browser |
| User roles (`user`/`admin`), admin-only registry and Users tab, admin seeding | `server/src/accounts/{auth,seed,routes}.ts`, `gateway/routes.ts`, `web/src/components/AdminDialog.tsx` | Role script: guest 401, user 403, admin allowed, promote/demote takes effect, last admin protected, CSRF guard, seed on start idempotent, `--seed-admin` promotes, no-DB read-only; browser check of badge, Manage and both tabs |
| MCP endpoint hardening and keys | `server/src/transports/guards.ts`, `http.ts`, `api/keys.ts`, `server.ts` | Probe scripts against a local server: foreign Origin 403, rate limits 429 (loopback exempt), SSE caps, headers, -32700, annotations; operator key, API-issued MCP key, ordinary API key refused, unknown key 401, revocation effective after the cache expires, API down 503 |
| Weather MCP server (`mcp_weather_server` 0.6.1, Open-Meteo) registered as `weather` | `uvx` locally (README); `weather-mcp` compose service for Docker | Locally through the gateway: 8 tools, live Ibadan weather; chat uses it unprompted. Docker image not built |
| Gateway survives clients disconnecting mid-stream | `server/src/gateway/routes.ts` (`pipeline`) | Regression script: old build crashed on the first disconnect, fixed build survived three |
| Chat refuses its own agronomic judgement (weather is context only) | system prompt in `server/src/chat/agent.ts` | Ibadan planting question answered correctly after adding an explicit example; other phrasings not tested |

## 4. Decisions made by the user (do not reverse without asking)

1. **Naming**: this repo's agent is **Akilimo 1.0**; the hosted one is **Akilimo 2.0**. Use `akilimo-1.0` / `akilimo-2.0` everywhere.
2. **No mocks** in the web UI: only real MCP servers; the user enters all information.
3. **Chat is the default mode**, Advanced is the alternative. The chat's model and tool calls run on the **server** (`/chat`): admins set up providers (Ollama by default, plus hosted ones) in Manage > AI providers, and their keys are stored encrypted (`SECRETS_KEY`), so browsers hold no provider keys. Models are fetched live. **Test connection** exists for LLM providers (also checks that the model calls tools) and, for admins, for MCP servers before saving (`POST /gateway/test`). Ollama models can be pulled by admins; that goes through `/proxy/ollama`, which is open to anyone who can reach the site.
4. **MCP servers are managed through a shared gateway** on the backend, by users with the **admin role** (this replaced the earlier `GATEWAY_ADMIN_TOKEN`). It is not per browser. An admin can be seeded with `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
5. **Upstream keys are remembered in the browser** (localStorage), never stored on the server.
6. **Accounts**: email + password, plus a unique username (sign-in accepts either), **guests can still use everything** (nothing is saved for them). Database: **PostgreSQL only**, one schema and one migration history managed by **Drizzle ORM** (replaced Prisma on request because Prisma's engine download from `binaries.prisma.sh` failed in Docker builds on the user's WSL network, where that host stalls TLS 1.3), configured with individual Laravel-style `DB_*` values (no `DATABASE_URL`). SQLite support was added and then removed on request. Migrations are SQL files in `packages/server/drizzle/` created by `pnpm db:generate` and applied by the server itself at start; the baseline is idempotent so databases that Prisma created are adopted without a manual step.
7. Bootstrap (not Tailwind), with a light/dark toggle.
8. No `network_mode: host` in compose.
9. **MCP client keys come from three places, all accepted**: admins issue them in this server's database (Manage > MCP keys, table `mcp_client_keys`, hashed, own limits, revocable), users create `ak_` keys in the Akilimo API playground (type "MCP key", checked through the API), and operator keys in `MCP_API_KEYS` stay for partner apps.

## 5. Non-obvious facts and gotchas

- **API quirks** (`new-akilimo-api`): its validation rules name crop prices `unit_price_maize_1`, but the DTOs read `unit_price_maize1`, so follow the DTOs. The R compute service fails with "subscript out of bounds" on nulls, yield 0 or unknown produce types, so schema defaults copy the mobile app (`use_case` `FR`, `"NA"` instead of null, yield class 11.25). Price lists contain placeholder rows (`-1`, `0`, negative), which must be skipped.
- **Real `use_case` codes** seen in data: `FR`, `CIS`, `CIM`. `CASSAVA` exists only in API tests.
- **Small local models also give their own advice** (e.g. "not a good week to plant" from a weather reading). A general rule in the prompt was not enough; an explicit good/bad example at the top of the system prompt fixed the tested case. Keep the rule first and test other phrasings.
- **Weather server dependency**: `mcp_weather_server` 0.6.1 crashes with the `mcp` 2.x SDK (`McpError` was renamed); pin `mcp[cli]==1.30.0`. The `weather-mcp` compose service (`docker/weather-mcp/Dockerfile`) installs both pinned versions. **Its image has not been built or run**: the user builds it; an earlier unpinned build exited at start for the reason above. Registries are only seeded on first start, so in Docker add it via Manage (`http://weather-mcp:8080/mcp`).
- **Small local models guess when data is truncated.** Keep tool results compact; the system prompt forbids facts not found in tool results.
- **`think: false`** is sent to Ollama models with the thinking capability (otherwise answers take minutes). The native `/api/chat` is used so `num_ctx` can be 8192.
- **CORS**: Akilimo 2.0 and Ollama reject browser origins. The web app reaches everything through same-origin paths (`/gateway`, `/api`, `/chat`, `/proxy/ollama`), via Vite in dev and nginx in Docker. Ollama proxies drop `Origin`.
- **Ports**: port 3000 is taken by Dokploy on the dev machine, so the server defaults to **3001** locally; containers use 3000.
- **pnpm 12 lockfile bug**: it may write `@modelcontextprotocol/sdk` as `1.32.2` instead of `1.32.2(zod@3.25.76)` for `packages/web`, leaving a broken link. Fix the importer entry by hand and run `pnpm install --frozen-lockfile`.
- **Vite on Windows sometimes misses rapid edits** and serves stale modules. Touch the file (`(Get-Item f).LastWriteTime = Get-Date`).
- `.gitignore` lists `pnpm-lock.yaml` (since the first commit). It is harmless because the file is tracked, but misleading.
- Docker runs in **WSL** with mirrored networking; Ollama runs on **Windows**. Containers reach it via the Windows IP with `hostAddressLoopback=true` (see README).

## 6. Running it locally

```bash
pnpm install
pnpm dev:server:http   # server on :3001 (reads repo-root .env)
pnpm dev:web           # UI on :5173, proxies /gateway, /api, /chat, /proxy/ollama
```

Relevant `.env` settings (see `.env.example`): `AKILIMO_API_BASE_URL`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (PostgreSQL; enables accounts), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_USERNAME` (optional admin seed). Docker additionally needs the `DB_*` values (compose requires them; `DB_HOST=db` for the bundled PostgreSQL) and `WEBUI_SECRET_KEY`. The user does not use `DATABASE_URL`; it is not supported. The user's own `.env` had a malformed first line (a literal `\n` joining two variables); they were told, but it was not edited because it holds secrets.

## 7. Open items and suggested next steps

1. **Push** the hardening commit (section 2) once the user agrees; pushes to `main` run `docker-publish.yml`. To use API-issued MCP keys in production: deploy the `new-akilimo-api` change, create a key there with only **Verify MCP keys**, set it as this server's `AKILIMO_API_KEY`. Keys are always mandatory.
2. **Production deployment** (`proxy-tool` repo, uncommitted there): service `mcp` added to `stacks/akilimo/docker-compose.yml` (`127.0.0.1:9101`, `AKILIMO_MCP_*` env, volume `akilimo-mcp-data`) and the Caddy site `akilimo-mcp.akilimo.org` in `config/caddy/snippets/domains/akilimo.caddy` (mirrored in `stacks/akilimo/Caddyfile`). Still needed: a DNS record for `akilimo-mcp.akilimo.org` pointing at the host, `AKILIMO_MCP_TAG` in the stack `.env`, optionally the `akilimo_mcp` database on the shared PostgreSQL for accounts, then `docker compose up -d mcp` and a Caddy reload.
2. **Docker images have not been built** in this session (`docker compose up -d --build`), so the nginx template, the gateway volume and the `db` service are unverified at runtime. `docker compose config` passes.
3. **Accounts**: no email verification, password reset, account deletion or data export. The rate limiter is in memory only (it resets on restart and is per instance).
4. **Images**: the server image was built and run once against an empty database (see section 3); the web image builds fine for the user; the weather image has not been built here.
4. **Data protection**: chats can contain farm locations and personal details; agree on retention, backups and access with IITA IT Operations & Information Security.
5. **No automated tests.** Good first candidates: shared schema vs the API test payload, gateway routes, and accounts routes (the manual scripts in section 3 show what to cover).
6. **A full compute conversation through chat** (ending in `compute_recommendations`) has not been run, because it writes to the production API. Test against a local `new-akilimo-api` if possible.
7. **Upstream API fixes to suggest** (in `new-akilimo-api`, not here): surface `data.message` from compute errors in `RecommendationService.php` (around line 139), and align the rule names with the DTO field names.
8. The web bundle is about 720 kB (MCP SDK + Leaflet). Code splitting would help.
9. Keys of servers removed from the registry stay in localStorage; prune them on reload.
10. The Nominatim reverse lookup sends rounded coordinates to OpenStreetMap. If farm locations must stay in-house, replace it with bundled country boundaries.

## 8. Leftovers on the dev machine from this session

- Throwaway PostgreSQL container **`akilimo-test-pg`** (WSL Docker, `127.0.0.1:55432`, `--rm`), holding only a test account. Remove it with `wsl -e docker stop akilimo-test-pg`.
- A local dev server on port 3001 on the test database, which holds two test accounts (`admin@example.test`, `user@example.test`, both admin).
- MCP server list: table `mcp_servers` when a database is configured (filled on the first start from the old registry file `packages/server/data/mcp-servers.json` if present, which had the two defaults plus `weather`, otherwise with the defaults); read-only from that file or the defaults without a database.
- The weather MCP server running via `uvx` on `127.0.0.1:8090` (background process from this session).
