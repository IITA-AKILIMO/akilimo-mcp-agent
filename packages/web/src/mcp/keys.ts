// Per-browser storage for upstream server keys and the gateway admin token. Keys are remembered
// in localStorage by the user's choice; they are never sent to the gateway's registry, only
// forwarded per request. Storage can be unavailable (private mode), so every access is guarded.
const KEYS = 'mcp-server-keys';
const ADMIN = 'mcp-gateway-admin-token';

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

export const loadAdminToken = (): string => read(ADMIN, '');
export const saveAdminToken = (token: string) => write(ADMIN, token);
