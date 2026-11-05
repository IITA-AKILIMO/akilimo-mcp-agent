# PRD: AKILIMO MCP Hub

> **IITA Internal Use.** Product requirements for one MCP endpoint that gives integrators consolidated access to every AKILIMO MCP server. Status: **draft, decisions D1–D22 recorded 2026-11-05** (§11); one item open (terms of use text). Architecture of the existing server: [`AGENTS.md`](../AGENTS.md); current state and decisions: [`HANDOVER.md`](HANDOVER.md).

## 1. Summary

AKILIMO's tools are spread over several MCP servers: **Akilimo 1.0** (this repository, `https://akilimo-mcp.akilimo.org/mcp`), **Akilimo 2.0** (`https://mcp.akilimo.org/mcp`, partner key), and supporting servers (weather, agriculture). Each has its own address, key and conventions. An integrator who wants "everything AKILIMO offers" must connect to each server, hold a key for each, and handle each one's failures.

The **AKILIMO MCP Hub** is one MCP endpoint, served by this repository's server, that exposes the tools of all enabled servers behind **one key per integrator**, with per-integrator access rules, limits and usage reporting. The mobile app's backend and partner systems connect once and get the whole catalogue.

Most building blocks exist already: the shared server registry and gateway, the multi-server MCP session used by the web chat, admin-issued client keys with limits, encrypted upstream keys and per-user quotas. The hub puts them behind one public endpoint.

## 2. Goals and non-goals

**Goals**

1. One streamable HTTP MCP endpoint that lists and calls the tools of every enabled registry server.
2. One key per integrator (an admin-issued `amk_` key), with per-key access to a chosen set of servers and per-key limits.
3. Clear tool names and descriptions that say which server a tool comes from.
4. A failing or slow server never breaks the hub: its tools are left out or its call fails on its own.
5. Usage per integrator, per server and per tool, for operations and for reporting to partners and donors.
6. No change for existing clients of `/mcp` (Akilimo 1.0 only) or of the web UI.

**Non-goals (this release)**

- **SMS.** Not needed; there is no SMS channel or key-authenticated chat endpoint in scope.
- New AKILIMO tools or changes to the upstream servers (Akilimo 2.0, weather, agriculture).
- MCP resources and prompts (tools only, D18; revisit when an upstream offers them).
- A public developer portal or self-service sign-up for integrators (admins issue keys).
- Billing.

## 3. Users and use cases

| Consumer | How it connects | Typical use |
| :--- | :--- | :--- |
| **AKILIMO mobile app** (its backend, never the APK) | Hub endpoint with an `amk_` key held on the backend | Recommendations, prices, coverage check, weather in one integration |
| **Partner systems** (extension services, NGOs, agri-businesses) | Hub endpoint with their own `amk_` key, limited to the servers agreed with them | Embed AKILIMO advice in their own apps or assistants |
| **AI clients** (Claude Desktop, Open WebUI, agents built by partners) | Hub endpoint as a remote MCP server | Conversational access to all AKILIMO tools |
| **IITA internal tools** (later: this repo's web chat) | Server-side, loopback | Optional: replace the per-request multi-server session with the hub |

## 4. Current state (what exists today)

| Piece | Where | Reused by the hub for |
| :--- | :--- | :--- |
| Server registry: id, label, description, URL, auth type, enabled, order | `mcp_servers` table, `gateway/registry.ts`, Manage > MCP servers | The list of upstream servers |
| Multi-server MCP session: connects to the enabled servers, names tools `<server>__<tool>` (server id sanitised, 64 characters max), 15 s connect / 120 s call timeouts | `chat/mcp.ts` | Upstream connections, naming, timeouts |
| Upstream keys, encrypted (AES-256-GCM, `SECRETS_KEY`) | `mcp_server_keys`, Manage > AI providers > Shared keys | Calling Akilimo 2.0 and other keyed servers |
| Admin-issued client keys `amk_…` with per-minute / per-day limits, expiry, revocation, usage count | `mcp_client_keys`, `mcpkeys/store.ts`, Manage > MCP keys | The integrator's hub key |
| Key checks, Origin check, per-IP limits, security headers, JSON-RPC errors | `transports/guards.ts`, `transports/http.ts` | The hub endpoint's front door |
| 1.0 + 2.0 side-by-side fertilizer advice | `chat/dual.ts`, `@akilimo/shared` `akilimo2.ts` | A combined tool (FR-11) |
| Admin audit trail of key actions | `key_events` | Auditing hub key changes |

What is missing: a public endpoint that serves the combined catalogue, per-key server access, per-integrator usage records, and a catalogue cache.

## 5. Functional requirements

**FR-1 Endpoint.** `POST /hub/mcp` (streamable HTTP, stateless, like `/mcp`; GET and DELETE answer 405) on the existing host: `https://akilimo-mcp.akilimo.org/hub/mcp` (decision D3). Legacy SSE is not offered. The Caddy site must expose `/hub/mcp` alongside `/mcp`.

**FR-1a Server-side clients only** (D9). The hub is for integrators' backends. Any request that carries a browser `Origin` header is refused with `403`, whatever `ALLOWED_ORIGINS` says, so integrator keys are never used from, or exposed in, a browser. Loopback calls from this server itself are not affected.

**FR-2 Authentication.** Every request carries a key as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Accepted keys: admin-issued `amk_` client keys (primary), and operator keys from `MCP_API_KEYS`, which reach **every enabled server with no per-server allowance** (D12; they belong to IITA's operators). They keep the per-IP limits and the compute limit of 10 a minute (D21, FR-8), and need no terms of use. Users' personal `ak_` keys from the Akilimo API playground are **not** accepted on the hub (D4); they keep working on `/mcp`. No key or an unknown, revoked or expired key: `401` with `WWW-Authenticate: Bearer`; an `ak_` key: `403` with a message pointing to the integrator key process.

**FR-3 Per-key server access.** Each `amk_` key has a list of server ids it may use (`allowed_servers`). Admins set it when creating or editing the key (Manage > MCP keys, checkboxes per server). A registry entry has a **"granted to new hub keys"** flag (`hub_default`): new keys start with every server that has it. Defaults: on for Akilimo 1.0 and the third-party servers (weather, agriculture; D2: available to all partners), **off for Akilimo 2.0**, which an admin grants per approved partner (D1). Keys issued before the hub get the same default servers from the migration (D11), not Akilimo 2.0, but can use the hub **only once their partner's acceptance of the terms of use is recorded** (D19, FR-14); until then the hub answers `403` "terms of use not accepted", while `/mcp` keeps working for them as before. `tools/list` only lists tools of allowed, enabled servers; `tools/call` to any other server's tool answers a JSON-RPC error "tool not available for this key", never the upstream's answer.

**FR-4 Tool catalogue.**
- `tools/list` returns the union of the allowed servers' tools.
- Name: `<server>__<tool>`, the server id lower-cased with any character outside `[a-z0-9_]` replaced by `_` (so `akilimo-1.0` becomes `akilimo_1_0`), at most 64 characters, so it works in clients that restrict names to `^[a-zA-Z0-9_-]{1,64}$`. A clash after shortening is resolved by a numeric suffix and logged. **The web chat switches to the same rule** (D5; today it produces `akilimo-1_0__…`), through one shared naming function, so a tool has one name everywhere. The chat's names are internal (saved conversations only show them in tool steps), so nothing outside depends on the old form.
- Description: `[<server label>] ` + the upstream description, unchanged otherwise.
- Input schema and annotations: passed through unchanged; a tool without annotations gets `readOnlyHint` false and `openWorldHint` true (the hub does not assume what a third-party tool does).
- A hub tool `hub__list_sources` (always listed) returns, for the calling key, each allowed server's id, label, description, status (up, down, not configured) and tool count.

**FR-5 Catalogue cache.** Upstream tool lists are cached per server for 5 minutes (configurable, `HUB_CATALOG_TTL_SECONDS`) and refreshed in the background. An admin's change to the registry (add, edit, disable, remove) clears that server's cache at once.

**FR-6 Calls.** `tools/call` is routed to the owning server with the arguments unchanged, using that server's registry URL and upstream key. **A partner's own upstream key** (D14): a request may carry `X-Upstream-Key-<server>` (server id in the hub's naming, e.g. `X-Upstream-Key-akilimo_2_0`); calls to that server then use the partner's key instead of IITA's shared key, and do not count against the shared-key allowance (FR-8). The header is only forwarded to that server, never stored and never logged; the usage record notes "own key". The key still needs the server in its allowed servers. Results (all content types, including embedded resources such as Akilimo 1.0's PDF report) and `isError` are passed back unchanged. Upstream timeouts: 15 s to connect, 120 s per call (compute is slow); a timeout answers a JSON-RPC error naming the server.

**FR-7 Failure isolation.** A server that cannot be reached when the catalogue is built is left out of `tools/list` (and shown as `down` by `hub__list_sources`); the rest is served. A failing call affects only that call. The hub never returns an upstream's internal error details (hosts, stack traces); it logs them and answers a generic message, as `/mcp` does.

**FR-8 Limits.** Per-key limits from `mcp_client_keys` (per minute, per day) apply to the hub. **One counter per key** covers `/mcp` and the hub together (D20). A key with no limits of its own gets **30 requests a minute and 1,000 a day** (D6), on both endpoints: the existing defaults `MCP_KEY_RATE_PER_MINUTE` / `MCP_KEY_RATE_PER_DAY` change from 60 / 5,000 to 30 / 1,000, so keys issued before the hub without their own limits become stricter on `/mcp` too (see §10). Admins can change the limits per key. Calls to the hub's own tools (`hub__list_sources`) are not counted. Additionally, calls that go through a **shared upstream key** (Akilimo 2.0's partner key) count against a per-key, per-server allowance (`hub_server_limits`; default the existing `SHARED_KEY_RATE_PER_MINUTE` / `SHARED_KEY_RATE_PER_DAY`, 20 and 300, overridable per key and server), so one integrator cannot exhaust IITA's 2.0 quota for everyone (a partner using its own 2.0 key, FR-6, is not counted). Akilimo 1.0's `compute_recommendations` (slow, up to 2 minutes, and it runs the R service) has its own limit of **10 calls a minute per key** (D13; `HUB_COMPUTE_RATE_PER_MINUTE`, changeable per key; operator keys too, D21), the per-key version of `/mcp`'s per-IP compute limit, because the hub reaches Akilimo 1.0 over loopback, where the per-IP limit does not apply. Over a limit: `429` with `Retry-After` and a JSON-RPC error saying which limit. The existing per-IP limits also apply.

**FR-9 Usage records.** Every `tools/call` of an upstream tool (not the hub's own `hub__list_sources`) is recorded: time, client key id, server id, tool name, duration, outcome (ok, tool error, upstream error, timeout, limited). **No arguments or results are stored** (they can hold farm locations and names). Records are **kept indefinitely** (D7); because they hold only ids, names and counts, this needs no personal-data retention rule, but the table is partitioned or indexed by month so it stays fast.

**FR-10 Admin.** Manage > MCP keys gains: allowed servers per key, per-server allowances, the compute limit, the terms-of-use record (FR-14), the "IITA internal" mark (FR-14), and a **Usage** view (per key: calls per server and tool per day, errors, last use; IITA internal keys listed apart from partners; export as CSV). **Only IITA admins see usage** (D15); they share reports with partners from the export. Changes are written to `key_events`.

**FR-11 Combined tools (phase 3).** The hub may add its own tools that call several servers, starting with `hub__recommend_fertilizer`: puts one field to Akilimo 1.0 (`compute_recommendations`) and, when the key may use it, Akilimo 2.0 (`get_recommendation`) in parallel and returns both answers side by side, never merged (the logic of `chat/dual.ts`). Only listed when the key can reach Akilimo 1.0.

**FR-12 Documentation.** `docs/MCP_CONNECTION_GUIDE.md` gains a Hub section (endpoint, key, naming, `hub__list_sources`, own upstream keys, errors, limits, change policy, terms of use) with Claude Desktop and plain-HTTP examples; `docs/ANDROID_INTEGRATION.md` points the app's backend at the hub.

**FR-13 Change policy** (D8). **Changes take effect immediately.** The catalogue always reflects the registry and the upstream servers as they are now: a tool that is added, renamed or removed (by the hub or an upstream) appears or disappears at the next catalogue refresh (FR-5), with no aliases and no deprecation period. A call to a tool that no longer exists answers a JSON-RPC "unknown tool" error. Integrators are expected to read `tools/list` (or `hub__list_sources`) rather than hard-code the catalogue, and to handle that error; the connection guide says so.

**FR-14 Terms of use** (D16). Before an admin issues a hub key, the partner accepts the **AKILIMO Hub terms of use**: what the hub is for, that farm data in their calls goes to the servers they use (including Akilimo 2.0 and third parties), their duty to have their farmers' consent, the limits and the change policy. The key form records the terms version, the date of acceptance and who accepted for the partner (name and organisation, no other personal data); a key cannot be issued without it. A new terms version is recorded per key when the partner accepts it. **IITA's own keys** (the mobile app backend, internal tools) are marked "IITA internal" by an admin and need no terms (D22); operator keys need none either. The terms text itself is to be written with IT Operations & Information Security (see §11, still open).

## 6. Design notes

**6.1 Where it runs.** In the existing server process (HTTP mode, needs the database), new module `src/hub/`: `routes.ts` (endpoint), `catalog.ts` (cache, naming), `router.ts` (call routing), `usage.ts` (records). It reuses `chat/mcp.ts`'s connection code, refactored into a shared upstream client so the chat and the hub do not drift.

**6.2 Server-per-request.** Like `/mcp`, a low-level MCP `Server` is created per request; its `ListTools` handler reads the cached catalogue filtered by the key, its `CallTool` handler routes the call.

**6.3 Upstream connections.** A small pool of connected SDK clients per upstream server (stateless streamable HTTP upstreams need no session affinity), reconnected on error. Akilimo 1.0 itself is reached over loopback (`http://127.0.0.1:$PORT/mcp`, exempt from the key check, as the gateway does today).

**6.4 Data model changes** (Drizzle migration):
- `mcp_client_keys.allowed_servers` `text[]` not null default `{}`; the migration fills it for existing keys with the `hub_default` servers (D11). Existing keys keep working on `/mcp` as before.
- `mcp_client_keys.compute_per_minute` `integer` (null = `HUB_COMPUTE_RATE_PER_MINUTE`, 10).
- `mcp_client_keys.terms_version` `text`, `terms_accepted_at` `timestamptz`, `terms_accepted_by` `text` (name and organisation); existing keys get the terms recorded when their partner accepts them (until then no hub access, D19).
- `mcp_client_keys.internal` `boolean` not null default `false` ("IITA internal": no terms needed, D22).
- `mcp_servers.hub_default` `boolean` not null default `false`. Server ids are chosen by admins and differ between deployments (a dev registry may call Akilimo 1.0 `akilimo-mcp-dev`), so the migration does not match ids: it sets the flag for every currently enabled server **except Akilimo 2.0, recognised by its URL host `mcp.akilimo.org`**. Admins adjust it afterwards in Manage > MCP servers.
- `hub_server_limits (client_key_id, server_id, per_minute, per_day)`.
- `hub_usage (id, at, client_key_id, server_id, tool, duration_ms, outcome)`, indexed by `(client_key_id, at)` and `(server_id, at)`, kept indefinitely.

**6.5 Naming example**

| Upstream | Hub tool name |
| :--- | :--- |
| `akilimo-1.0` / `compute_recommendations` | `akilimo_1_0__compute_recommendations` |
| `akilimo-2.0` / `get_recommendation` | `akilimo_2_0__get_recommendation` |
| `weather` / `get_current_weather` | `weather__get_current_weather` |
| hub's own | `hub__list_sources`, `hub__recommend_fertilizer` |

## 7. Non-functional requirements

| Area | Requirement |
| :--- | :--- |
| Security | Keys checked before any upstream contact; upstream keys never leave the server; browser requests refused (FR-1a); security headers as on `/mcp`; registry URLs remain admin-only (SSRF). |
| Privacy | No storage of tool arguments or results; usage records hold ids and counts only. Data sent upstream is the integrator's responsibility under their agreement; the connection guide states which servers are third parties. Follows IITA's data guidelines. |
| Performance | `tools/list` from cache under 100 ms; hub overhead per call under 50 ms on top of the upstream's time. |
| Availability | Same as `/mcp`; one upstream's outage never makes the hub unavailable. |
| Observability | Logs per call (key id, server, tool, outcome, duration) to stderr; usage view. The public `GET /health` reports only an overall status (`ok` or `degraded`, D17); per-server reachability is shown by `hub__list_sources` (for a key's own servers) and in the admin view. |
| Compatibility | MCP protocol version as supported by `@modelcontextprotocol/sdk` in this repo; works with Claude Desktop, Open WebUI and plain JSON-RPC over HTTP. |

## 8. Success metrics

- The mobile app's backend uses only the hub (one key) for all AKILIMO tools.
- At least two partner integrations on the hub within three months of release.
- Hub-attributable error rate (excluding upstream errors) below 0.5 % of calls.
- Every integrator's monthly usage report produced from the Usage view without manual log work.

## 9. Rollout

| Phase | Content | Exit criteria |
| :--- | :--- | :--- |
| 1. Core | FR-1 to FR-7 (incl. FR-1a), FR-10 (allowed servers, `hub_default`), migration, shared naming (chat switches to it), `hub__list_sources`, docs | Works end to end with Akilimo 1.0, 2.0 and weather from Claude Desktop and a JSON-RPC script; browser requests refused; existing `/mcp` and web UI unchanged |
| 2. Control | FR-8 (default 30/min, 1,000/day; per-server allowances), FR-9 (usage records), Usage view and CSV export | Limits enforced in tests; usage visible per key |
| 3. Combined | FR-11 `hub__recommend_fertilizer`; optional: web chat uses the hub | Both answers returned side by side; chat parity |
| 4. Launch | Caddy exposes `/hub/mcp`; Akilimo 2.0 owners informed (D1); third-party terms confirmed (D2); hub terms of use written and approved (FR-14); existing keys without own limits reviewed (D20) and their partners' terms collected (D19); internal key for the mobile app backend, keys for first partners | First partner live, with terms accepted |

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| Partners' Akilimo 2.0 calls all run on IITA's partner key (D1), so IITA answers for their use and their volume counts against IITA | Admins grant 2.0 only to approved partners; per-key, per-server allowances (FR-8); usage records per partner (FR-9); inform the Akilimo 2.0 owners before launch |
| Third-party servers (weather, agriculture) open to all partners (D2) may have licence or data terms on re-distribution | Confirm each server's terms before launch; `hub_default` can be switched off per server at any time |
| One integrator exhausts a shared upstream key | Per-key, per-server allowances (FR-8) |
| Lower default limits (D20: 30/min, 1,000/day instead of 60 / 5,000) also apply on `/mcp` to keys issued before the hub that have no limits of their own, so an existing integration may start getting `429` | Before deploying, list keys without their own limits and either set limits for them or tell their owners |
| Keys issued before the hub get no hub access until terms are recorded (D19) | Collect acceptance from existing partners before launch; `/mcp` is unaffected |
| Tool changes take effect immediately (D8), so an integrator that hard-codes a renamed or removed tool breaks at once | The connection guide tells integrators to read `tools/list` and handle "unknown tool"; `hub__list_sources` shows each server's tool count; IITA may announce planned changes to partners as a courtesy |
| Catalogue too large for small AI clients | Per-key allowed servers keeps lists short; descriptions unchanged (no padding) |
| Personal data in arguments goes to Akilimo 2.0 and third parties, with only accepted terms of use (no signed agreement, D16) as the basis | Not stored by the hub (FR-9); the terms make partners responsible for their farmers' consent (FR-14); upstreams are listed as third parties in the guide; have IT Operations & Information Security review the terms before launch |

## 11. Decisions (2026-11-05)

| # | Decision | Effect |
| :--- | :--- | :--- |
| D1 | **Akilimo 2.0: any approved partner** may use its tools through the hub, on IITA's partner key | Granted per key by an admin (not a default, FR-3); per-key 2.0 allowance (FR-8); inform the 2.0 owners (§10) |
| D2 | **Third-party servers (weather, agriculture): available to all partners** | `hub_default` on for them (FR-3); terms to confirm before launch (§10) |
| D3 | **Endpoint: path on the existing host**, `https://akilimo-mcp.akilimo.org/hub/mcp` | No new DNS or certificate; Caddy exposes `/hub/mcp` |
| D4 | **Admin-issued keys only**; personal `ak_` keys are refused on the hub | FR-2; `ak_` keys keep working on `/mcp` |
| D5 | **Tool names `akilimo_1_0__tool`**, shared with the web chat | FR-4; the chat changes to the same rule |
| D6 | **Default limits for a key: 30 a minute, 1,000 a day** (see D20 for how they apply) | FR-8; admins change them per key |
| D7 | **Usage records kept indefinitely** (ids, names and counts only) | FR-9 |
| D8 | **Tool changes take effect immediately**: no aliases or deprecation period | FR-13; integrators read the catalogue rather than hard-code it |
| D9 | **Server-side clients only**; browser requests are refused | FR-1a |
| D10 | **Combined 1.0 + 2.0 tool in a later phase** (phase 3) | FR-11 unchanged |
| D11 | **Keys issued before the hub get the default servers** (1.0, weather, agriculture; not 2.0), usable once terms are recorded (D19) | FR-3; migration (§6.4) |
| D12 | **Operator keys (`MCP_API_KEYS`) reach all servers**, with no per-server allowance | FR-2 |
| D13 | **Compute limit: 10 `compute_recommendations` calls a minute per key** | FR-8; changeable per key |
| D14 | **A partner's own upstream key is used when sent** (`X-Upstream-Key-<server>`) | FR-6; not counted against IITA's shared-key allowance |
| D15 | **Only IITA admins see usage**; partners get reports from them | FR-10 |
| D16 | **Partners accept terms of use** before a key is issued (no signed data agreement) | FR-14; acceptance recorded on the key |
| D17 | **Public `/health` gives an overall status only** | §7 Observability |
| D18 | **Tools only**: MCP resources and prompts are not passed through for now | §2 non-goals |
| D19 | **Keys issued before the hub use it only after their terms are recorded** | FR-3; `/mcp` unaffected |
| D20 | **One limit counter per key across `/mcp` and the hub; keys without own limits get 30/min, 1,000/day everywhere** | FR-8; the `/mcp` defaults change too (§10) |
| D21 | **Operator keys get the compute limit (10 a minute)** too | FR-2, FR-8 |
| D22 | **IITA's own keys are marked "IITA internal" and need no terms** | FR-14; listed apart in usage |

**Still open:** the text of the hub terms of use (FR-14), to be written with IT Operations & Information Security before launch.

## 12. Out of scope

SMS and any natural-language (LLM) endpoint for machine clients; billing; self-service integrator sign-up; changes to the upstream servers.
