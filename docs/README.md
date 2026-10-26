# 🌿 Akilimo MCP Agent: Getting Started Guide

Welcome to the Akilimo MCP Agent! This project allows an AI (like Claude or ChatGPT) to "talk" to the Akilimo Agricultural API to provide real-world farming advice, price checks, and recommendations.

## 🎓 What is MCP?
**MCP (Model Context Protocol)** is like a "universal plug" for AI. Instead of building a custom integration for every AI, we build an MCP Server. Any AI client that supports MCP can then use our tools to fetch data from the Akilimo API.

---

## 🛠️ Prerequisites
Before you start, make sure you have these installed on your computer:
1. **Node.js (v20 or newer)**: The engine that runs our code. [Download here](https://nodejs.org/).
2. **pnpm**: A faster version of npm. Install it by running: `npm install -g pnpm`
3. **Docker Desktop**: Used to run the AI interface (Open WebUI) and the agent in a container. [Download here](https://www.docker.com/products/docker-desktop/).
4. **An Akilimo API Key**: You will need a valid key to access the agricultural data.

---

## 🚀 Quick Start (Step-by-Step)

### Step 1: Setup the Agent (The "Brain")
1. Open your terminal/command prompt.
2. Navigate to the project folder: `cd D:/Dev/php/akilimo-mcp-agent`
3. Install the dependencies:
   ```bash
   pnpm install
   ```
4. Create a configuration file:
   - Copy `.env.example` and rename it to `.env`.
   - Open `.env` and paste your `AKILIMO_API_KEY`.
5. Start the agent in development mode:
   ```bash
   pnpm dev
   ```
   *You should see: "Akilimo MCP Agent running on stdio"*

### Step 2: Setup the Showcase UI (The "Demo")
If you want to show this to teammates, use the built-in dashboard:
1. Open a **new** terminal window.
2. Go to the web folder: `cd D:/Dev/php/akilimo-mcp-agent/web`
3. Install dependencies: `pnpm install`
4. Start the UI: `pnpm dev`
5. Open your browser to: `http://localhost:5173`

### Step 3: Using it with Claude Desktop
To make the actual Claude app use these tools:
1. Open the file: `%APPDATA%\Claude\claude_desktop_config.json`
2. Paste the configuration found in `docs/MCP_CONNECTION_GUIDE.md`.
3. Restart Claude. You will now see a 🔌 icon indicating the Akilimo tools are active!

---

## 🐳 Using Docker (The "All-in-One" Way)
If you don't want to install Node.js or pnpm manually, you can run everything using Docker:
1. Ensure Docker Desktop is running.
2. Create your `.env` file with your API Key.
3. Run:
   ```bash
   docker-compose up -d
   ```
4. Access the AI interface at: `http://localhost:8080`

---

## ❓ Frequently Asked Questions
**Q: What do I do if I get a "Connection Error"?**
A: Check if your `.env` file has the correct API Key and that your internet is connected.

**Q: How do I know the AI is actually using the tools?**
A: If using the Showcase UI, look at the **Engine Room** (right pane). It will show you exactly when the AI calls the API and what data it receives.

**Q: Can I use this with my own local LLM?**
A: Yes! Use the Docker setup. It includes **Ollama** and **Open WebUI**, allowing you to run the AI and the MCP agent entirely on your own machine.
