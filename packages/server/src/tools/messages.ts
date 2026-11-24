import { jsonResult, ToolError, type ToolDefinition } from "./types.js";

// ── get_announcements ───────────────────────────────────────────────────────

export const announcementsTool: ToolDefinition = {
  name: "get_announcements",
  description: "The messages AKILIMO sent to farmers' phones (advice, reminders and announcements, for example a new price list), from the Akilimo API's message inbox. Optionally limit to a country (ISO 2-letter code), a language (2 or 3 letters, e.g. en, sw, rw) and a start time. Each message has a type, title, body, country and language (empty means everyone) and created_at; expired messages are not returned. Use it when the user asks what is new or what AKILIMO has announced.",
  inputSchema: {
    type: "object" as const,
    properties: {
      countryCode: { type: "string", description: "Optional ISO 2-letter code of a supported country (see get_countries)" },
      language: { type: "string", description: "Optional language code, 2 or 3 letters, e.g. en, sw, rw" },
      since: { type: "string", description: "Optional ISO 8601 time; only messages created after it" },
      limit: { type: "number", description: "Optional, 1 to 200 (default 20)" },
    },
    required: [],
  },

  async handler(args, api) {
    const params: Record<string, string | number> = {};
    if (args?.countryCode !== undefined) {
      const code = String(args.countryCode).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) throw new ToolError("countryCode must be an ISO 2-letter code, e.g. NG or TZ");
      params.country = code;
    }
    if (args?.language !== undefined) {
      const lang = String(args.language).trim().toLowerCase();
      if (!/^[a-z]{2,3}$/.test(lang)) throw new ToolError("language must be 2 or 3 letters, e.g. en, sw or rw");
      params.language = lang;
    }
    if (args?.since !== undefined) {
      const since = String(args.since);
      if (Number.isNaN(Date.parse(since))) throw new ToolError("since must be an ISO 8601 time, e.g. 2026-11-01T00:00:00Z");
      params.since = since;
    }
    const limit = Number(args?.limit);
    params.limit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.round(limit))) : 20;

    const { data } = await api.get<{ data: Record<string, unknown>[] }>("/v1/messages", params);
    return jsonResult({
      messages: data,
      count: data.length,
      usage: "Quote the title and body as written; do not invent messages. An empty country or language means the message is for everyone.",
    });
  },
};
