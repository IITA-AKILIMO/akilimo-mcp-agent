# 🌿 Akilimo MCP Agent: Getting Started Guide

Welcome to the Akilimo MCP Agent! This project allows an AI (like Claude or ChatGPT) to "talk" to the Akilimo Agricultural API to provide real-world farming advice, price checks, and recommendations.

This repository is the **Akilimo 1.0** agent (`akilimo-1.0`), backed by the Akilimo 1.0 API. The separate, hosted **Akilimo 2.0** agent (`akilimo-2.0`) lives at `app2.akilimo.org`; see [docs/MCP_CONNECTION_GUIDE.md](docs/MCP_CONNECTION_GUIDE.md) for both. Using the server from the AKILIMO Android app: [docs/ANDROID_INTEGRATION.md](docs/ANDROID_INTEGRATION.md).

## 🎓 What is MCP?
**MCP (Model Context Protocol)** is like a "universal plug" for AI. Instead of building a custom integration for every AI, we build an MCP Server. Any AI client that supports MCP can then use our tools to fetch data from the Akilimo API.

---

## 🛠️ Prerequisites
Before you start, make sure you have these installed on your computer:
1. **Node.js (v20 or newer)**: The engine that runs our code. [Download here](https://nodejs.org/).
2. **pnpm**: A faster version of npm. Install it by running: `npm install -g pnpm`
3. **Docker Desktop**: Used to run the AI interface (Open WebUI) and the agent in a container. [Download here](https://www.docker.com/products/docker-desktop/).
4. **Access to the Akilimo API** (the Laravel `new-akilimo-api`, hosted at `https://api.akilimo.org` or run locally on port 8600). Reference data and recommendations are public; an API key is only needed for protected routes.

---

## 🚀 Quick Start (Step-by-Step)

### Step 1: Setup the Agent (The "Brain")
1. Open your terminal/command prompt.
2. Navigate to the root of this repository.
3. Install all dependencies across the monorepo:
   ```bash
   pnpm install
   ```
4. Create a configuration file:
   - Copy `.env.example` and rename it to `.env`.
   - Set `AKILIMO_API_BASE_URL` (`https://api.akilimo.org`, or `http://localhost:8600` for a local API). `AKILIMO_API_KEY` is optional.
5. Start the agent in development mode. The server reads the repo-root `.env`.
   - Over HTTP (for the web UI and remote clients), on `http://localhost:3001`:
     ```bash
     pnpm dev:server:http
     ```
     *You should see: "Akilimo 1.0 MCP Agent listening on http://localhost:3001 …"*
   - Over stdio (how Claude Desktop runs it):
     ```bash
     pnpm dev:server
     ```

### Step 2: Use the Web UI
The web UI is a real MCP client for both Akilimo agents. With `pnpm dev:server:http` running, open a **new** terminal window and run `pnpm dev:web`, then open `http://localhost:5173`. Akilimo 1.0 connects automatically; for **Akilimo 2.0**, enter your partner key in **MCP servers** first (it stays in browser memory only).

It has two modes, switched in the top bar. Inside **Chat** there is a **Guided | Ask AI** switch:
- **Chat, Guided** (default): no AI provider needed. Choose your country, then use the buttons: cassava prices, fertilizers with typical prices, or a short form (field on the map, size, dates, root price, fertilizers) that requests a fertilizer recommendation. Answers come straight from the AKILIMO tools.
- **Chat, Ask AI** also covers all four kinds of advice (fertilizer, planting practices, planting and harvest dates, and intercropping where available): an **Advice** row of buttons starts each one, a calendar button picks the planting and harvest dates with their flexibility, and the 📍 button picks the field. Choose your country, then ask in plain language, e.g. "I grow cassava in Tanzania, which fertilizer should I use?". The model asks for the missing details, calls the AKILIMO tools and explains the answer; example questions are suggested for the chosen country, and messages typed while an answer is running are queued. Use the 📍 button to share the field location on a map: the map highlights the area where AKILIMO can give advice and warns as soon as you pick a spot outside it. The **server** runs the model calls and the tool calls (`/chat`), so users never handle API keys; with accounts enabled, users must sign in to chat.
  - **LLM providers**: admins set them up in **Manage > AI providers**: Ollama (default; address from `OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`), Ollama Cloud (hosted by Ollama at `https://ollama.com`, needs an API key from ollama.com/settings/keys), OpenAI, Anthropic (Claude), Google Gemini, DeepSeek, Groq, Mistral, OpenRouter, OpenCode (`https://opencode.ai/inference/v1`, key from the OpenCode console), or any OpenAI-compatible server (LM Studio, vLLM, ...). Keys are saved **encrypted in the database** (AES-256-GCM) under the master key `SECRETS_KEY` (`openssl rand -base64 32`; keep it, a different key cannot read saved keys), and are never shown again, only their last characters. The same tab saves the keys of MCP servers that need one (e.g. Akilimo 2.0). Users pick among the providers that are on; the model list is fetched live. Note that with a hosted provider the conversation, including any farm details, is sent to that provider.
  - **Test connection** (admins, in the chat's settings panel) checks the provider, refreshes the model list and sends the selected model one tiny request with a test tool, warning when the model does not call tools (it then cannot use the AKILIMO tools reliably). With Ollama admins can also **download models** (`ollama pull`, with progress) into the Ollama the site uses (through `/proxy/ollama`, so do not expose that path publicly with an Ollama you care about).
- **Advanced**: pick a tool, fill in the form generated from its input schema (with prefill buttons and a map for coordinates), and press **Run tool**.

Every connection, tool call and response appears under **Activity**.

#### Accounts, saved chats and activity
People can use the UI as guests, or **Sign in / Create account** (top bar) to keep their chat history and activity. An account has a name, an email and a unique username (3–30 lowercase letters, digits, dots, underscores or hyphens); sign-in accepts the email or the username. Signed-in users get a **History** button in the chat to reopen or delete past conversations; signing out clears the screen. **Guided sessions are saved too**: every finished step (a price, the fertilizer list, a recommendation) is stored with its request and result, grouped into a session until you press **New**; History shows the sessions of the mode you are in, and opening one shows its steps again and lets you continue it.

This needs **PostgreSQL**, set with Laravel-style variables in `.env`: `DB_HOST`, `DB_PORT` (default 5432), `DB_DATABASE` (default `akilimo_mcp`), `DB_SCHEMA` (default `public`, where drizzle keeps its migration bookkeeping table), `DB_USERNAME`, `DB_PASSWORD`. Without `DB_HOST` the UI is guest-only; with a host set, a username and password are required.

The schema is managed with **Drizzle ORM** (`packages/server/src/db/schema.ts`; plain npm packages, no engine binaries are downloaded). The server applies pending migrations from `packages/server/drizzle/` itself whenever it connects, so `pnpm dev:server:http` and the Docker image need no separate migration step; run them by hand with `pnpm db:migrate`. With docker compose, `DB_HOST=db` uses the bundled PostgreSQL service, which is created from the same `DB_*` values.

To add a table or column: edit `schema.ts`, run `pnpm db:generate` (drizzle-kit compares the schema with the last migration's snapshot; no database needed), review the new SQL file, and commit it together with the `drizzle/meta/` changes. Never edit a migration that has been applied elsewhere. Databases created by the earlier Prisma setup are adopted automatically (the baseline migration skips what exists); their old `_prisma_migrations` table is no longer used and can be dropped.

Passwords are stored as salted scrypt hashes and sessions as hashed tokens in an HttpOnly cookie. There is no email verification or password reset yet. Chats can contain farm details and locations, so treat the database as personal data under IITA's data guidelines (access, backups, retention).

#### Admins and roles
Every account is a **user** or an **admin**; new accounts start as users. Admins see **Manage** in the MCP servers panel, which opens the **Admin** dialog with two tabs: **MCP servers** (add, change, remove) and **Users** (make someone an admin or remove admin rights). The last admin cannot be demoted.

Create the first admin (needs the database):
- **On start**: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (and optionally `ADMIN_NAME` and `ADMIN_USERNAME`) in `.env` or the compose environment. Every start makes sure that account exists as an admin: it is created if missing, an existing account with that email is promoted, and an existing password or username is never changed. Without `ADMIN_USERNAME` the username comes from the email (`admin@example.org` becomes `admin`, with a short suffix if that is taken).
- **On demand**: with the same variables set, run `pnpm seed:admin` (in the Docker container: `node dist/index.cjs --seed-admin`).

#### Adding, changing and removing MCP servers
The server list is shared by everyone using the UI and stored in the accounts database (table `mcp_servers`). On the first start the table is filled with Akilimo 1.0 and Akilimo 2.0 (or, if an older `mcp-servers.json` registry file exists at `GATEWAY_DATA_FILE`, with its entries); after that the table is the only source, so restarts never bring removed servers back. Only admins can change it; without a database there are no accounts, so the list is read-only and the defaults (or that file) are used.
1. Sign in as an admin and open **MCP servers → Manage**.
2. Add a server with its **streamable HTTP** endpoint URL and how its key is sent (none, `Authorization: Bearer`, or a custom header such as `X-API-Key`). The gateway calls the URL, so it works even if the server does not allow browser requests, and internal addresses (e.g. `http://akilimo-mcp:3000/mcp`) are allowed.
3. Use **Test connection** in the form (with an optional key that is used only for the test) before saving, or the plug button on any listed server. The gateway connects and reports the server name, response time and its tools, or why it failed (unreachable, wrong path, key missing or rejected).

Keys themselves are entered per user in the server panel and remembered in that browser only; the gateway forwards them per request and never stores them.

#### Example: Weather MCP server
[mcp_weather_server](https://github.com/isdaniel/mcp_weather_server) adds current weather, forecasts, air quality and time-zone tools from the free Open-Meteo API (no key).

- **Docker**: the `weather-mcp` compose service (`docker/weather-mcp/Dockerfile`) runs it on the internal network. Add it under **Manage** with id `weather`, URL `http://weather-mcp:8080/mcp`, no key.
- **Locally** (needs Python and [uv](https://docs.astral.sh/uv/)), then add it under **Manage** with URL `http://127.0.0.1:8090/mcp`:

  ```bash
  uvx --from "mcp_weather_server==0.6.1" --with "mcp[cli]==1.30.0" python -m mcp_weather_server --mode streamable-http --stateless --host 127.0.0.1 --port 8090
  ```
 Version 0.6.1 does not declare an upper bound on the `mcp` SDK and fails to start with `mcp` 2.x (`cannot import name 'McpError'`), so keep the `mcp[cli]==1.30.0` pin. On Windows with a pyenv `uvx` shim, avoid `<` in version specifiers (cmd treats it as a redirect).

### Step 3: Using it with Claude Desktop
To make the actual Claude app use these tools:
1. Open the file: `%APPDATA%\Claude\claude_desktop_config.json`
2. Paste the configuration found in [docs/MCP_CONNECTION_GUIDE.md](docs/MCP_CONNECTION_GUIDE.md) (build the server first with `pnpm --filter @akilimo/server build`).
3. Restart Claude. You will now see a 🔌 icon indicating the Akilimo tools are active!

---

## 🐳 Using Docker (The "All-in-One" Way)
If you don't want to install Node.js or pnpm manually, you can run everything using Docker:
1. Ensure Docker Desktop is running.
2. Create your `.env` file from `.env.example` and set `WEBUI_SECRET_KEY` (required by Open WebUI).
3. Run:
   ```bash
   docker compose up -d --build
   ```
4. Open:
   - Open WebUI (AI chat interface): `http://localhost:8089`
   - Web UI: `http://localhost:4173`
   - Akilimo 1.0 MCP server: `http://localhost:3080/mcp` (streamable HTTP) or `/sse`; inside the compose network Open WebUI reaches it at `http://akilimo-mcp:3000/mcp`

### Published images (GHCR)
`.github/workflows/docker-publish.yml` builds both images on every push to `main` and on `v*` tags and pushes them to GitHub Container Registry (not Docker Hub): `ghcr.io/iita-akilimo/akilimo-mcp-agent` (MCP server) and `ghcr.io/iita-akilimo/akilimo-mcp-agent-web` (web UI), tagged `latest` (main), the version (`v1.2.3` → `1.2.3`, `1.2`) and `sha-<commit>`. Pull requests only build. `docker compose build` tags local builds with the same names. The Node and nginx base images come from Docker Hub by default; set the repository variables `NODE_IMAGE` / `NGINX_IMAGE` (or the `--build-arg`s of the same names) to pull them from a mirror instead.

In production the server runs in the `akilimo` stack of the hosting repo (`proxy-tool`), service `mcp`, behind Caddy at `https://akilimo-mcp.akilimo.org` (only `/mcp`, `/sse`, `/messages` and `/health` are public). `mcp.akilimo.org` is the Akilimo 2.0 MCP.

Open WebUI uses **Ollama running on your machine** (not in Docker). On Linux, Ollama must listen beyond localhost (`OLLAMA_HOST=0.0.0.0`). With Docker in WSL and Ollama on Windows, enable `hostAddressLoopback=true` in `.wslconfig` and set `OLLAMA_BASE_URL=http://<Windows IP>:11434` in `.env`. Pick a model that supports tools (e.g. `qwen3:8b`, `llama3.1:8b`); plain `llama3` does not.

---

## ❓ Frequently Asked Questions
**Q: What do I do if I get a "Connection Error"?**
A: Check that `AKILIMO_API_BASE_URL` in `.env` points to a reachable Akilimo 1.0 API and that your internet is connected.

**Q: How do I know the AI is actually using the tools?**
A: The web UI's **Activity** panel shows every connection, tool call and response it makes. In Open WebUI or Claude Desktop, tool calls are shown in the chat.

**Q: Can I use this with my own local LLM?**
A: Yes! Run Ollama locally and use the Docker setup, which adds **Open WebUI** and the MCP agent, so the AI and the agent run entirely on your own machine.
