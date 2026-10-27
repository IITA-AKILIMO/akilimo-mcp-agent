import express from "express";

// Relay from the web UI's chat to hosted LLM providers, which mostly reject browser (CORS)
// requests. Upstreams are a fixed list and only their model list and chat endpoints are reachable,
// so this cannot be pointed at arbitrary or internal URLs. The user's key arrives per request in
// X-Llm-Key and is never stored or logged.
type Auth = "bearer" | "anthropic";

const PROVIDERS: Record<string, { base: string; auth: Auth }> = {
  openai: { base: "https://api.openai.com/v1", auth: "bearer" },
  anthropic: { base: "https://api.anthropic.com/v1", auth: "anthropic" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", auth: "bearer" },
  deepseek: { base: "https://api.deepseek.com", auth: "bearer" },
  groq: { base: "https://api.groq.com/openai/v1", auth: "bearer" },
  mistral: { base: "https://api.mistral.ai/v1", auth: "bearer" },
  openrouter: { base: "https://openrouter.ai/api/v1", auth: "bearer" },
};

const ALLOWED: Record<string, readonly string[]> = {
  GET: ["models"],
  POST: ["chat/completions", "messages"],
};

// Tool-calling rounds on large models can be slow
const TIMEOUT_MS = 180_000;

export function llmRouter() {
  const router = express.Router();

  router.all("/:provider/*path", express.json({ limit: "5mb" }), async (req, res) => {
    const provider = PROVIDERS[String(req.params.provider)];
    const path = ([] as string[]).concat(req.params.path ?? []).join("/");
    if (!provider || !ALLOWED[req.method]?.includes(path)) {
      res.status(404).json({ error: "Unknown provider or endpoint" });
      return;
    }
    const key = req.get("x-llm-key");
    if (!key) {
      res.status(401).json({ error: "Enter an API key for this provider" });
      return;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (req.method === "POST") headers["Content-Type"] = "application/json";
    if (provider.auth === "anthropic") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${key}`;
    }

    // Stop the upstream call when the user presses Stop (the browser closes the request)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    res.on("close", () => controller.abort());
    try {
      const upstream = await fetch(`${provider.base}/${path}`, {
        method: req.method,
        headers,
        ...(req.method === "POST" ? { body: JSON.stringify(req.body ?? {}) } : {}),
        signal: controller.signal,
      });
      res.status(upstream.status);
      res.type(upstream.headers.get("content-type") ?? "application/json");
      res.send(await upstream.text());
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const timedOut = controller.signal.aborted;
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "The provider took too long to answer" : `Cannot reach the provider: ${(error as Error).message}`,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
}
