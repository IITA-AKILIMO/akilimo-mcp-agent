// Per-browser storage for upstream server keys. Keys are remembered in localStorage by the
// user's choice; they are never sent to the gateway's registry, only forwarded per request.
// Storage can be unavailable (private mode), so every access is guarded.
const KEYS = 'mcp-server-keys';

const read = <T,>(name: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (name: string, value: unknown) => {
  try {
    if (value === undefined || value === '') localStorage.removeItem(name);
    else localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Not persisted; still works for this visit
  }
};

export const loadKeys = (): Record<string, string> => read(KEYS, {});
export const saveKey = (id: string, key: string) => {
  const keys = loadKeys();
  if (key) keys[id] = key;
  else delete keys[id];
  write(KEYS, keys);
};

// Admin tokens were stored here before roles replaced them; remove any leftover
try { localStorage.removeItem('mcp-gateway-admin-token'); } catch { /* storage unavailable */ }
