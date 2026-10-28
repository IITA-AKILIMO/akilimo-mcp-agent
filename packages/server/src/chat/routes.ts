import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import { findCountry, type ChatMessage } from "@akilimo/shared";
import { loadUser, rateLimit, requireAdmin, requireJson, requireUser } from "../accounts/auth.js";
import type { AkilimoApiClient } from "../api/client.js";
import { fetchCountries } from "../countries/list.js";
import type { Db } from "../db/index.js";
import type { Registry } from "../gateway/registry.js";
import { WEB_SERVER, runWebSearch, searchWeb, webSearchTool } from "./websearch.js";
import { runAgent } from "./agent.js";
import { openTools } from "./mcp.js";
import { chat, listModels, pickDefaultModel, testProvider } from "@akilimo/llm";
import { ChatSettings, SettingsError } from "./store.js";

const passThrough = (req: Request, res: Response, next: NextFunction) => next();

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().max(100_000),
  tool_calls: z.array(z.object({
    id: z.string().max(200).optional(),
    function: z.object({ name: z.string().max(200), arguments: z.record(z.string(), z.unknown()).default({}) }),
  })).max(20).optional(),
  tool_name: z.string().max(200).optional(),
});

const ChatRequestSchema = z.object({
  provider: z.string().max(40),
  model: z.string().min(1).max(200),
  country: z.string().length(2).optional(),
  // The crop chosen in the selector; it only changes what the assistant is told (see CropChoice)
  // Only used without accounts: with accounts the user's profile setting (users.web_search) decides
  webSearch: z.boolean().optional(),
  crop: z.object({ key: z.string().regex(/^[a-z0-9_]{1,50}$/), name: z.string().min(1).max(100), advice_available: z.boolean() }).optional(),
  messages: z.array(MessageSchema).min(1).max(400),
});

const WebSearchChangeSchema = z.object({
  provider: z.string().max(20).optional(),
  baseUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Use an http(s) URL" })]).optional(),
  apiKey: z.string().trim().min(1).max(500).optional(),
  clearKey: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const ProviderChangeSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
  clearKey: z.boolean().optional(),
  baseUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Use an http(s) URL" })]).optional(),
  enabled: z.boolean().optional(),
});

const sendError = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) res.status(400).json({ error: z.prettifyError(error) });
  else if (error instanceof SettingsError) res.status(error.status).json({ error: error.message });
  else res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
};

// The chat's server side: it holds the provider settings and keys (encrypted in the database), calls
// the model, runs the MCP tool calls and streams the conversation back as newline-delimited JSON.
// With accounts enabled only signed-in users can chat, because the keys belong to the organisation.
export function chatRouter(settings: ChatSettings, registry: Registry, db: Db | null, api: AkilimoApiClient) {
  const router = express.Router();
  const withUser = db ? loadUser(db) : passThrough;
  const signedIn = db ? [withUser, requireUser] : [passThrough];
  const admin = db ? [withUser, requireJson, requireAdmin] : [(req: Request, res: Response) => { res.status(403).json({ error: "Managing providers needs user accounts" }); }];
  const limit = rateLimit(60, 60_000);

  router.get("/providers", ...signedIn, async (req, res) => {
    try {
      const isAdmin = req.user?.role === "admin";
      const all = await settings.statuses();
      res.json({
        admin: isAdmin,
        providers: isAdmin
          ? all
          : all.filter((p) => p.enabled && p.configured).map(({ id, label }) => ({ id, label })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  // What this server can offer beyond the models: web search exists only when a search service is configured
  router.get("/capabilities", ...signedIn, async (_req, res) => {
    try {
      res.json({ webSearch: { available: (await settings.webSearchStatus()).available } });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/models/:provider", ...signedIn, async (req, res) => {
    try {
      const provider = await settings.resolve(String(req.params.provider));
      let models: string[];
      try {
        models = await listModels(provider);
      } catch (error) {
        const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
        const reason = error instanceof Error ? (error.message === "fetch failed" && cause?.code ? `cannot connect (${cause.code})` : error.message) : String(error);
        res.status(502).json({ error: `${provider.info.label}: ${reason}` });
        return;
      }
      res.json({ models, default: pickDefaultModel(provider.info, models) ?? null });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/test", express.json(), ...admin, async (req, res) => {
    try {
      const { provider, model } = z.object({ provider: z.string(), model: z.string().default("") }).parse(req.body);
      res.json(await testProvider(await settings.resolve(provider), model));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/", express.json({ limit: "5mb" }), ...signedIn, limit, async (req, res) => {
    let body: z.infer<typeof ChatRequestSchema>;
    let provider;
    let keys: Record<string, string>;
    try {
      body = ChatRequestSchema.parse(req.body);
      provider = await settings.resolve(body.provider);
      keys = await settings.serverKeys();
    } catch (error) {
      sendError(res, error);
      return;
    }

    res.status(200).type("application/x-ndjson").setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    const send = (event: Record<string, unknown>) => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };

    // Stop the model call and tool calls when the user presses Stop (the browser closes the request)
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    // The supported countries come from the API; if they cannot be read the chat still works, just without the country note
    const countries = await fetchCountries(api).catch(() => []);
    const session = await openTools(registry, keys);
    // The user's choice, and only if a search service is set up; otherwise the model never sees the tool
    // A signed-in user's profile decides (their setting applies to every conversation and the request cannot
    // override it); without accounts there is no profile, so the request's own switch is used
    const wantsSearch = req.user ? req.user.web_search : body.webSearch === true;
    const searchConfig = wantsSearch ? await settings.webSearchConfig().catch(() => null) : null;
    const webSearch = searchConfig !== null;
    if (wantsSearch && !webSearch) session.warnings.push("Web search is not set up on this server, so it was not used");
    // A slow model can take minutes without sending anything, and proxies close connections that stay
    // silent; a small line every 15 s keeps the stream open (the client ignores it)
    const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
    try {
      for (const text of session.warnings) send({ type: "warning", text });
      await runAgent({
        chat: (messages, tools, signal) => chat(provider, body.model, messages, tools, signal),
        history: body.messages as ChatMessage[],
        tools: webSearch ? [...session.tools, webSearchTool] : session.tools,
        callTool: (server, name, args, signal) => (server === WEB_SERVER ? runWebSearch(searchConfig!, args, signal) : session.callTool(server, name, args, signal)),
        webSearch,
        country: findCountry(countries, body.country),
        crop: body.crop,
        signal: abort.signal,
        onMessage: (message) => send({ type: "message", message }),
        onStep: (step) => send({ type: "step", step }),
      });
      send({ type: "done" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!abort.signal.aborted) {
        console.error(`Chat failed (${body.provider} ${body.model}): ${text}`);
        send({ type: "error", error: text });
      }
    } finally {
      clearInterval(heartbeat);
      await session.close();
      res.end();
    }
  });

  // ── admin: provider settings and the keys of upstream MCP servers ───────────

  // Web search service: set by an admin (key encrypted), the SEARCH_* variables are the fallback
  router.get("/admin/web-search", ...admin, async (_req, res) => {
    try {
      res.json(await settings.webSearchStatus());
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/admin/web-search", express.json(), ...admin, async (req, res) => {
    try {
      await settings.updateWebSearch(WebSearchChangeSchema.parse(req.body));
      res.json(await settings.webSearchStatus());
    } catch (error) {
      sendError(res, error);
    }
  });

  // One real search with the saved setup, so an admin sees whether it works before anyone relies on it
  router.post("/admin/web-search/test", express.json(), ...admin, async (_req, res) => {
    const started = Date.now();
    try {
      const config = await settings.webSearchConfig();
      if (!config) {
        res.json({ ok: false, ms: 0, error: "Web search is not set up, is incomplete or is turned off" });
        return;
      }
      const hits = await searchWeb(config, "cassava price");
      res.json({ ok: true, ms: Date.now() - started, hits: hits.length, first: hits[0]?.title ?? null });
    } catch (error) {
      res.json({ ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/admin/providers/:id", express.json(), ...admin, async (req, res) => {
    try {
      await settings.updateProvider(String(req.params.id), ProviderChangeSchema.parse(req.body));
      res.json({ providers: await settings.statuses() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/admin/server-keys", ...admin, async (req, res) => {
    try {
      res.json({ keys: await settings.serverKeyHints() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/admin/server-keys/:id", express.json(), ...admin, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!(await registry.get(id))) throw new SettingsError(404, `No server with id '${id}'`);
      await settings.setServerKey(id, z.object({ key: z.string().trim().min(1).max(2000) }).parse(req.body).key);
      res.json({ keys: await settings.serverKeyHints() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/admin/server-keys/:id", ...admin, async (req, res) => {
    try {
      await settings.deleteServerKey(String(req.params.id));
      res.json({ keys: await settings.serverKeyHints() });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
