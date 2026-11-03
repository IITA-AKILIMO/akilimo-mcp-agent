// Per-user and per-key call allowances: fixed windows, kept in memory (a restart resets them, and each server
// process counts for itself). Used for the calls a signed-in user makes through a shared upstream key (the
// key an admin saved for a server; admins and users who bring their own key never reach this) and for the
// requests of each admin-issued MCP client key.
export interface Limits {
  perMinute: number;
  perDay: number;
}

export type QuotaResult = { ok: true } | { ok: false; retryAfter: number; window: "minute" | "day"; limit: number };

interface Window {
  count: number;
  reset: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class CallQuota {
  private readonly minute = new Map<string, Window>();
  private readonly day = new Map<string, Window>();

  constructor(private readonly defaults: Limits) {}

  // Counts `calls` for the id, or refuses all of them without counting when a window is full; `limits`
  // overrides the defaults (a null or missing value keeps the default)
  take(id: string, calls = 1, limits?: { perMinute?: number | null; perDay?: number | null }, now = Date.now()): QuotaResult {
    if (calls <= 0) return { ok: true };
    const perMinute = limits?.perMinute ?? this.defaults.perMinute;
    const perDay = limits?.perDay ?? this.defaults.perDay;
    const minute = this.current(this.minute, id, MINUTE, now);
    const day = this.current(this.day, id, DAY, now);
    if (minute.count + calls > perMinute) return { ok: false, retryAfter: Math.max(1, Math.ceil((minute.reset - now) / 1000)), window: "minute", limit: perMinute };
    if (day.count + calls > perDay) return { ok: false, retryAfter: Math.max(1, Math.ceil((day.reset - now) / 1000)), window: "day", limit: perDay };
    minute.count += calls;
    day.count += calls;
    return { ok: true };
  }

  private current(map: Map<string, Window>, id: string, length: number, now: number): Window {
    const found = map.get(id);
    if (found && found.reset > now) return found;
    const fresh = { count: 0, reset: now + length };
    map.set(id, fresh);
    if (map.size > 10_000) for (const [k, w] of map) if (w.reset <= now) map.delete(k);
    return fresh;
  }
}

const wait = (v: { retryAfter: number }) => (v.retryAfter >= 3600 ? `${Math.ceil(v.retryAfter / 3600)} h` : `${v.retryAfter} s`);

// What a user sees when the shared key's allowance is used up
export const sharedKeyMessage = (v: Extract<QuotaResult, { ok: false }>) =>
  `Shared key limit reached (${v.limit} calls a ${v.window}): try again in ${wait(v)}, or add your own key for no limit`;

// What an MCP client sees when its key's allowance is used up
export const clientKeyMessage = (v: Extract<QuotaResult, { ok: false }>) =>
  `Rate limit of this API key reached (${v.limit} requests a ${v.window}): try again in ${wait(v)}`;

// Number of tool calls in an MCP POST body (a message or a batch); only these use the upstream key's quota,
// the handshake and tool listing do not count
export function countToolCalls(raw: unknown): number {
  let body = raw;
  if (Buffer.isBuffer(raw)) {
    if (raw.length === 0) return 0;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return 0; }
  }
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter((m) => (m as { method?: unknown } | null)?.method === "tools/call").length;
}
