# 🌿 Akilimo MCP Agent: Getting Started Guide

Welcome to the Akilimo MCP Agent! This project allows an AI (like Claude or ChatGPT) to "talk" to the Akilimo Agricultural API to provide real-world farming advice, price checks, and recommendations.

This repository is the **Akilimo 1.0** agent (`akilimo-1.0`), backed by the Akilimo 1.0 API. The separate, hosted **Akilimo 2.0** agent (`akilimo-2.0`) lives at `app2.akilimo.org`; see [docs/MCP_CONNECTION_GUIDE.md](docs/MCP_CONNECTION_GUIDE.md) for both.

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

It has two modes, switched in the top bar:
- **Chat** (default): ask in plain language, e.g. "I grow cassava in Tanzania, which fertilizer should I use?". A local model in **Ollama** asks for the missing details, calls the AKILIMO tools and explains the answer. Use the 📍 button to share the field location on a map. Requires Ollama running locally with a tool-capable model (`ollama pull qwen3:8b`); the dev proxy expects it at `http://localhost:11434` (override with `OLLAMA_URL`).
- **Advanced**: pick a tool, fill in the form generated from its input schema (with prefill buttons and a map for coordinates), and press **Run tool**.

Every connection, tool call and response appears under **Activity**.

#### Accounts, saved chats and activity
People can use the UI as guests, or **Sign in / Create account** (top bar) to keep their chat history and activity. Signed-in users get a **History** button in the chat to reopen or delete past conversations; signing out clears the screen.

This needs **PostgreSQL**, set with Laravel-style variables in `.env`: `DB_HOST`, `DB_PORT` (default 5432), `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`. Without `DB_HOST` the UI is guest-only.

The schema is managed with **Prisma** (`packages/server/prisma/schema.prisma`): `pnpm dev:server:http` and the Docker image apply pending migrations automatically; run them by hand with `pnpm db:migrate`. With docker compose, `DB_HOST=db` uses the bundled PostgreSQL service, which is created from the same `DB_*` values.

To add a table or column: edit `schema.prisma`, run `npx prisma migrate dev --name <change>` in `packages/server` against a development database, and commit the schema together with the new folder under `prisma/migrations/`.

Passwords are stored as salted scrypt hashes and sessions as hashed tokens in an HttpOnly cookie. There is no email verification or password reset yet. Chats can contain farm details and locations, so treat the database as personal data under IITA's data guidelines (access, backups, retention).

#### Admins and roles
Every account is a **user** or an **admin**; new accounts start as users. Admins see **Manage** in the MCP servers panel, which opens the **Admin** dialog with two tabs: **MCP servers** (add, change, remove) and **Users** (make someone an admin or remove admin rights). The last admin cannot be demoted.

Create the first admin (needs the database):
- **On start**: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`) in `.env` or the compose environment. Every start makes sure that account exists as an admin: it is created if missing, an existing account with that email is promoted, and an existing password is never changed.
- **On demand**: with the same variables set, run `pnpm seed:admin` (in the Docker container: `node dist/index.cjs --seed-admin`).

#### Adding, changing and removing MCP servers
The server list is shared by everyone using the UI and stored by the MCP gateway on the Akilimo 1.0 server (`packages/server/data/mcp-servers.json` locally, the `mcp-gateway` volume in Docker). It starts with Akilimo 1.0 and Akilimo 2.0. Only admins can change it; without a database there are no accounts, so the list is read-only.
1. Sign in as an admin and open **MCP servers → Manage**.
2. Add a server with its **streamable HTTP** endpoint URL and how its key is sent (none, `Authorization: Bearer`, or a custom header such as `X-API-Key`). The gateway calls the URL, so it works even if the server does not allow browser requests, and internal addresses (e.g. `http://akilimo-mcp:3000/mcp`) are allowed.

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

Open WebUI uses **Ollama running on your machine** (not in Docker). On Linux, Ollama must listen beyond localhost (`OLLAMA_HOST=0.0.0.0`). With Docker in WSL and Ollama on Windows, enable `hostAddressLoopback=true` in `.wslconfig` and set `OLLAMA_BASE_URL=http://<Windows IP>:11434` in `.env`. Pick a model that supports tools (e.g. `qwen3:8b`, `llama3.1:8b`); plain `llama3` does not.

---

## ❓ Frequently Asked Questions
**Q: What do I do if I get a "Connection Error"?**
A: Check that `AKILIMO_API_BASE_URL` in `.env` points to a reachable Akilimo 1.0 API and that your internet is connected.

**Q: How do I know the AI is actually using the tools?**
A: The web UI's **Activity** panel shows every connection, tool call and response it makes. In Open WebUI or Claude Desktop, tool calls are shown in the chat.

**Q: Can I use this with my own local LLM?**
A: Yes! Run Ollama locally and use the Docker setup, which adds **Open WebUI** and the MCP agent, so the AI and the agent run entirely on your own machine.
