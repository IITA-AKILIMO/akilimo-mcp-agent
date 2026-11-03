import React, { useEffect, useState } from 'react';
import { Ban, Check, Copy, KeyRound, Loader2, Pencil, Plus, X } from 'lucide-react';
import { createMcpKey, listMcpKeys, revokeMcpKey, updateMcpKey, type McpClientKey } from '../account/api';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');
const limitText = (key: McpClientKey) =>
  `${key.per_minute ?? 'default'} a minute · ${key.per_day ?? 'default'} a day`;

const STATUS: Record<McpClientKey['status'], string> = { active: 'text-bg-success', expired: 'text-bg-warning', revoked: 'text-bg-secondary' };

// A blank box means the server default, otherwise a whole number of requests
const parseLimit = (value: string): number | null | 'invalid' => {
  const text = value.trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 ? n : 'invalid';
};

// Admins issue the keys MCP clients (partner apps, Open WebUI, desktop clients) send to this server's /mcp.
// A key is shown once; only a hint is kept. Users' own ak_ keys from the Akilimo API playground and the
// operator keys of MCP_API_KEYS keep working next to these.
export const McpKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<McpClientKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [perMinute, setPerMinute] = useState('');
  const [perDay, setPerDay] = useState('');
  const [days, setDays] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<{ id: string; perMinute: string; perDay: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setKeys((await listMcpKeys()).keys);
      setError(null);
    } catch (e) {
      setError(`Cannot load the keys: ${message(e)}`);
    }
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const minute = parseLimit(perMinute);
    const day = parseLimit(perDay);
    const expires = days.trim() === '' ? null : Number(days);
    if (minute === 'invalid' || day === 'invalid') { setError('Limits must be whole numbers of at least 1, or blank for the server default'); return; }
    if (expires !== null && (!Number.isInteger(expires) || expires < 1)) { setError('Days must be a whole number of at least 1, or blank for no expiry'); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await createMcpKey({ name: name.trim(), per_minute: minute, per_day: day, expires_in_days: expires });
      setCreated({ name: made.record.name, key: made.key });
      setCopied(false);
      setName(''); setPerMinute(''); setPerDay(''); setDays('');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setError('Copy failed: select the key and copy it by hand');
    }
  };

  const saveLimits = async () => {
    if (!editing) return;
    const minute = parseLimit(editing.perMinute);
    const day = parseLimit(editing.perDay);
    if (minute === 'invalid' || day === 'invalid') { setError('Limits must be whole numbers of at least 1, or blank for the server default'); return; }
    setBusy(true);
    try {
      setKeys((await updateMcpKey(editing.id, { per_minute: minute, per_day: day })).keys);
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      setKeys((await revokeMcpKey(id)).keys);
      setConfirmRevoke(null);
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="small text-body-secondary">
        Keys that apps and tools send to this server's MCP address (<code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key</code>).
        A key is shown once when you create it and cannot be read back; revoke it to stop it at once. Each key has its own request limits
        (blank = the server's default). MCP keys that users create in the Akilimo API playground and the keys in <code>MCP_API_KEYS</code> keep working too.
      </p>
      {error && <div className="alert alert-danger small">{error}</div>}

      {created && (
        <div className="alert alert-success small">
          <div className="fw-semibold mb-1">Key for “{created.name}” — copy it now, it will not be shown again</div>
          <div className="input-group input-group-sm">
            <input className="form-control font-monospace" readOnly value={created.key} aria-label="New key" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn btn-outline-success d-inline-flex align-items-center gap-1" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn btn-outline-secondary" aria-label="Done" onClick={() => setCreated(null)}><X size={14} /></button>
          </div>
        </div>
      )}

      <div className="card shadow-sm mb-3">
        <div className="card-body">
          <h3 className="h6 d-flex align-items-center gap-1"><KeyRound size={14} /> New key</h3>
          <div className="row g-2">
            <div className="col-12 col-md-6">
              <input className="form-control form-control-sm" placeholder="Name, e.g. the app that will use it" aria-label="Key name" maxLength={80}
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="col-4 col-md-2">
              <input className="form-control form-control-sm" inputMode="numeric" placeholder="per min" aria-label="Requests per minute" value={perMinute} onChange={e => setPerMinute(e.target.value)} />
            </div>
            <div className="col-4 col-md-2">
              <input className="form-control form-control-sm" inputMode="numeric" placeholder="per day" aria-label="Requests per day" value={perDay} onChange={e => setPerDay(e.target.value)} />
            </div>
            <div className="col-4 col-md-2">
              <input className="form-control form-control-sm" inputMode="numeric" placeholder="expires (days)" aria-label="Days until it expires" value={days} onChange={e => setDays(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-success mt-2 d-inline-flex align-items-center gap-1" disabled={busy || !name.trim()} onClick={create}>
            {busy ? <Loader2 size={14} className="spinner-border-sm" /> : <Plus size={14} />} Create key
          </button>
        </div>
      </div>

      {keys.length === 0 && !error && <div className="small text-body-secondary">No keys issued yet.</div>}
      <ul className="list-group">
        {keys.map(k => (
          <li key={k.id} className="list-group-item">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <div className="flex-grow-1 min-w-0">
                <div className="fw-semibold text-truncate">{k.name} <code className="fw-normal small">{k.key_hint}</code></div>
                <div className="small text-body-secondary">
                  {limitText(k)} · last used {when(k.last_used_at)}{k.expires_at ? ` · expires ${new Date(k.expires_at).toLocaleDateString()}` : ''}
                </div>
              </div>
              <span className={`badge ${STATUS[k.status]}`}>{k.status}</span>
              {k.status !== 'revoked' && editing?.id !== k.id && confirmRevoke !== k.id && (
                <>
                  <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                    onClick={() => setEditing({ id: k.id, perMinute: k.per_minute?.toString() ?? '', perDay: k.per_day?.toString() ?? '' })}>
                    <Pencil size={13} /> Limits
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => setConfirmRevoke(k.id)}>
                    <Ban size={13} /> Revoke
                  </button>
                </>
              )}
              {confirmRevoke === k.id && (
                <span className="d-flex gap-1 align-items-center">
                  <span className="small">Stop this key now?</span>
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => revoke(k.id)}>Revoke</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Cancel" onClick={() => setConfirmRevoke(null)}><X size={14} /></button>
                </span>
              )}
            </div>
            {editing?.id === k.id && (
              <div className="d-flex gap-2 align-items-center mt-2 flex-wrap">
                <input className="form-control form-control-sm w-auto" style={{ maxWidth: '8rem' }} inputMode="numeric" placeholder="per min" aria-label="Requests per minute"
                  value={editing.perMinute} onChange={e => setEditing({ ...editing, perMinute: e.target.value })} />
                <input className="form-control form-control-sm w-auto" style={{ maxWidth: '8rem' }} inputMode="numeric" placeholder="per day" aria-label="Requests per day"
                  value={editing.perDay} onChange={e => setEditing({ ...editing, perDay: e.target.value })} />
                <span className="small text-body-secondary">blank = default</span>
                <button type="button" className="btn btn-sm btn-success" disabled={busy} onClick={saveLimits}>Save</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
};
