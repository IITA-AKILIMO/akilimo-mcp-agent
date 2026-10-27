# Handover: AKILIMO MCP agent

> **IITA Internal Use.** Written 2026-10-26 (updated after committing all work) for the next agent or developer picking up this repository. Read [`AGENTS.md`](../AGENTS.md) for architecture and conventions; this file covers state, decisions and open work. It contains no credentials.

## 1. What this project is

A pnpm monorepo (TypeScript) for IITA's AKILIMO cassava advisory tools:

- **`packages/server`**: the **Akilimo 1.0** MCP server (MCP name `akilimo-1.0`). Wraps the Akilimo 1.0 REST API (Laravel repo `new-akilimo-api`, hosted at `https://api.akilimo.org`). Over HTTP it also hosts an **MCP gateway** (shared server registry and proxy) and an **accounts API** (PostgreSQL).
- **`packages/web`**: a React + Bootstrap web UI that is a real MCP client. **Chat** mode (default) uses a local Ollama model; **Advanced** mode runs tools through forms generated from their schemas.
- **`packages/shared`**: the Zod compute-request schema and shared types.
- **Akilimo 2.0** is a separate hosted MCP server (`https://mcp.akilimo.org/mcp`, partner key required). It is not in this repo.

## 2. Current state

| Area | State |
| :--- | :--- |
| Branch | `main`, **20 commits ahead of `origin/main`, nothing pushed**; working tree clean |
| Builds | `pnpm build` passes; the server passes a strict `tsc` check; `pnpm install --frozen-lockfile` passes |
| Tests | No automated test suite exists. Everything below was verified by hand (scripts and browser) |

Latest commits, newest first:

| Commit | Content |
| :--- | :--- |
| docs commit (this file) | README, `AGENTS.md`, this handover (PostgreSQL only) |
| `ddfc7ab` | Docker: SQLite settings removed from the image, compose and `.env.example` |
| `c4d9770` | Server: PostgreSQL only, one Prisma schema and migration history (SQLite removed) |
| `31f1ef8` | Docs: Prisma, `DB_*` settings, weather server |
| `09eecc5` | Docker: migrations at start, `DB_*` in compose, `weather-mcp` service, `.env.example` |
| `b077b11` | Server: Prisma 7 with PostgreSQL or SQLite (SQLite later removed in `c4d9770`), `DB_*` settings, `db:generate` / `db:migrate` |
| `fdd4cdc` | Chat: no agronomic advice that is not from AKILIMO tools |
| `f0b5e4b` | Gateway: survive clients disconnecting mid-stream (was a server crash) |
| `7fc29f8` | Docs: chat, gateway, accounts; first version of this handover |
| `1f0fa01` | Compose: PostgreSQL `db` service, gateway volume, Ollama for the web UI, `.env.example` |
| `f1ebeaa` | Web: chat mode, MCP server manager, accounts UI, `/gateway` `/api` `/proxy/ollama` proxies |
| `94aa9e3` | Server: MCP gateway (`/gateway`) and accounts API (`/api`, PostgreSQL) |
| `545afe5` | Server: all reference pages, compact advisory tools |
| `cf03dbc` and earlier | Map country lookup, web MCP client with prefill and map, server modules and streamable HTTP, Akilimo 1.0 API alignment, Docker images |

`f1ebeaa` also contains the lockfile changes for `pg` (used from `94aa9e3`), so a frozen install at exactly `94aa9e3` fails; from `f1ebeaa` onwards it passes.

## 3. Features and how they were verified

| Feature | Where | Verified |
| :--- | :--- | :--- |
| `get_reference_data` returns **all pages** (the API paginates at 50 rows) | `server/src/api/client.ts` `getAll` | NG fertilizer prices: 60 of 60 rows |
| Compact advisory tools `get_fertilizer_options`, `get_cassava_price` | `server/src/tools/advisory.ts` | About 3 KB vs 28 KB; NG lists all 10 fertilizers |
| `compute_recommendations` matches the API and mobile app payload | `shared/src/index.ts` | One live call to production succeeded (location was outside the recommendation area, so no rates came back) |
| Streamable HTTP `/mcp` plus multi-client SSE | `server/src/transports/http.ts` | SDK clients, two concurrent SSE sessions |
| Chat mode (Ollama agent loop) | `web/src/llm/`, `ChatView.tsx` | `qwen3:8b`: correct NG fertilizer answer in under 30 s; asks for missing farm details |
| MCP gateway: registry, admin API, proxy | `server/src/gateway/` | Add, edit, remove, validation, 401/404/409, key forwarding, Akilimo 2.0 401 passthrough |
| Server manager UI | `ServerManager.tsx`, `ServerPanel.tsx` | Browser: unlock, add, connect, edit, remove |
| Accounts, saved chats, activity | `server/src/accounts/`, `server/src/db/`, `web/src/account/` | API script (isolation, rate limit, CSRF guard, hashed storage) and browser round trip |
| Prisma 7 with PostgreSQL, one schema and migration history | `server/prisma/`, `prisma.config.ts`, `scripts/migrate.mjs` | Full API script passed after `db:migrate`; moved migration recognised as applied; repeat migrate = no-op; unmigrated DB refused at start; Docker image not built |
| Prefill buttons and map picker (country via Nominatim) | `web/src/mcp/presets.ts`, `MapPicker.tsx` | Browser |
| Weather MCP server (`mcp_weather_server` 0.6.1, Open-Meteo) registered as `weather` | `uvx` locally (README); `weather-mcp` compose service for Docker | Locally through the gateway: 8 tools, live Ibadan weather; chat uses it unprompted. Docker image not built |
| Gateway survives clients disconnecting mid-stream | `server/src/gateway/routes.ts` (`pipeline`) | Regression script: old build crashed on the first disconnect, fixed build survived three |
| Chat refuses its own agronomic judgement (weather is context only) | system prompt in `web/src/llm/agent.ts` | Ibadan planting question answered correctly after adding an explicit example; other phrasings not tested |

## 4. Decisions made by the user (do not reverse without asking)

1. **Naming**: this repo's agent is **Akilimo 1.0**; the hosted one is **Akilimo 2.0**. Use `akilimo-1.0` / `akilimo-2.0` everywhere.
2. **No mocks** in the web UI: only real MCP servers; the user enters all information.
3. **Chat is the default mode**, Advanced is the alternative. The LLM is local **Ollama** (data stays on the user's machine).
4. **MCP servers are managed through a shared gateway** on the backend, with an admin token. It is not per browser.
5. **Upstream keys are remembered in the browser** (localStorage), never stored on the server.
6. **Accounts**: email + password, **guests can still use everything** (nothing is saved for them). Database: **PostgreSQL only**, one schema and one migration history managed by **Prisma**, configured with individual Laravel-style `DB_*` values (no `DATABASE_URL`). SQLite support was added and then removed on request, because Prisma needs a separate schema and migrations per database type.
7. Bootstrap (not Tailwind), with a light/dark toggle.
8. No `network_mode: host` in compose.

## 5. Non-obvious facts and gotchas

- **API quirks** (`new-akilimo-api`): its validation rules name crop prices `unit_price_maize_1`, but the DTOs read `unit_price_maize1`, so follow the DTOs. The R compute service fails with "subscript out of bounds" on nulls, yield 0 or unknown produce types, so schema defaults copy the mobile app (`use_case` `FR`, `"NA"` instead of null, yield class 11.25). Price lists contain placeholder rows (`-1`, `0`, negative), which must be skipped.
- **Real `use_case` codes** seen in data: `FR`, `CIS`, `CIM`. `CASSAVA` exists only in API tests.
- **Small local models also give their own advice** (e.g. "not a good week to plant" from a weather reading). A general rule in the prompt was not enough; an explicit good/bad example at the top of the system prompt fixed the tested case. Keep the rule first and test other phrasings.
- **Weather server dependency**: `mcp_weather_server` 0.6.1 crashes with the `mcp` 2.x SDK (`McpError` was renamed); pin `mcp[cli]==1.30.0`. The `weather-mcp` compose service (`docker/weather-mcp/Dockerfile`) installs both pinned versions. **Its image has not been built or run**: the user builds it; an earlier unpinned build exited at start for the reason above. Registries are only seeded on first start, so in Docker add it via Manage (`http://weather-mcp:8080/mcp`).
- **Small local models guess when data is truncated.** Keep tool results compact; the system prompt forbids facts not found in tool results.
- **`think: false`** is sent to Ollama models with the thinking capability (otherwise answers take minutes). The native `/api/chat` is used so `num_ctx` can be 8192.
- **CORS**: Akilimo 2.0 and Ollama reject browser origins. The web app reaches everything through same-origin paths (`/gateway`, `/api`, `/proxy/ollama`), via Vite in dev and nginx in Docker. Ollama proxies drop `Origin`.
- **Ports**: port 3000 is taken by Dokploy on the dev machine, so the server defaults to **3001** locally; containers use 3000.
- **pnpm 12 lockfile bug**: it may write `@modelcontextprotocol/sdk` as `1.32.2` instead of `1.32.2(zod@3.25.76)` for `packages/web`, leaving a broken link. Fix the importer entry by hand and run `pnpm install --frozen-lockfile`.
- **Vite on Windows sometimes misses rapid edits** and serves stale modules. Touch the file (`(Get-Item f).LastWriteTime = Get-Date`).
- `.gitignore` lists `pnpm-lock.yaml` (since the first commit). It is harmless because the file is tracked, but misleading.
- Docker runs in **WSL** with mirrored networking; Ollama runs on **Windows**. Containers reach it via the Windows IP with `hostAddressLoopback=true` (see README).

## 6. Running it locally

```bash
pnpm install
pnpm dev:server:http   # server on :3001 (reads repo-root .env)
pnpm dev:web           # UI on :5173, proxies /gateway, /api, /proxy/ollama
```

Relevant `.env` settings (see `.env.example`): `AKILIMO_API_BASE_URL`, `GATEWAY_ADMIN_TOKEN` (enables server editing), `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (PostgreSQL; enables accounts). Docker additionally needs the `DB_*` values (compose requires them; `DB_HOST=db` for the bundled PostgreSQL) and `WEBUI_SECRET_KEY`. The user does not use `DATABASE_URL`; it is not supported. The user's own `.env` had a malformed first line (a literal `\n` joining two variables); they were told, but it was not edited because it holds secrets.

## 7. Open items and suggested next steps

1. **Push** `main` to `origin` once the user agrees (12 commits, see section 2).
2. **Docker images have not been built** in this session (`docker compose up -d --build`), so the nginx template, the gateway volume and the `db` service are unverified at runtime. `docker compose config` passes.
3. **Accounts**: no email verification, password reset, account deletion or data export. The rate limiter is in memory only (it resets on restart and is per instance).
4. **Images not built**: the server image (Prisma, migrations at start) and the weather image have not been built (the user builds them).
4. **Data protection**: chats can contain farm locations and personal details; agree on retention, backups and access with IITA IT Operations & Information Security.
5. **No automated tests.** Good first candidates: shared schema vs the API test payload, gateway routes, and accounts routes (the manual scripts in section 3 show what to cover).
6. **A full compute conversation through chat** (ending in `compute_recommendations`) has not been run, because it writes to the production API. Test against a local `new-akilimo-api` if possible.
7. **Upstream API fixes to suggest** (in `new-akilimo-api`, not here): surface `data.message` from compute errors in `RecommendationService.php` (around line 139), and align the rule names with the DTO field names.
8. The web bundle is about 720 kB (MCP SDK + Leaflet). Code splitting would help.
9. Keys of servers removed from the registry stay in localStorage; prune them on reload.
10. The Nominatim reverse lookup sends rounded coordinates to OpenStreetMap. If farm locations must stay in-house, replace it with bundled country boundaries.

## 8. Leftovers on the dev machine from this session

- Throwaway PostgreSQL container **`akilimo-test-pg`** (WSL Docker, `127.0.0.1:55432`, `--rm`), holding only a test account. Remove it with `wsl -e docker stop akilimo-test-pg`.
- A local dev server on port 3001, started with a throwaway admin token and the test database.
- Registry file `packages/server/data/mcp-servers.json` (gitignored; contains the two default servers plus `weather`).
- The weather MCP server running via `uvx` on `127.0.0.1:8090` (background process from this session).
