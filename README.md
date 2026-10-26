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
The web UI is a real MCP client for both Akilimo agents:
1. With `pnpm dev:server:http` running, open a **new** terminal window and run:
   ```bash
   pnpm dev:web
   ```
2. Open `http://localhost:5173`.
3. In **MCP servers**, switch on **Akilimo 1.0**. For **Akilimo 2.0**, enter your partner key first; it stays in browser memory only.
4. Pick a tool, fill in the form generated from its input schema, and press **Run tool**. Calls and responses appear under **Activity**.

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
