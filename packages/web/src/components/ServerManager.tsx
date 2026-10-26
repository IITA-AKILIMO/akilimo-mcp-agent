import React, { useEffect, useState } from 'react';
import { Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { loadAdminToken, saveAdminToken } from '../mcp/keys';
import {
  addServer, checkAdmin, describeAuth, listServers, removeServer, updateServer,
  type McpServerConfig, type ServerAuth,
} from '../mcp/servers';

interface Props {
  onClose: () => void;
  onChanged: () => void; // registry changed; reload connections
}

const EMPTY: McpServerConfig = { id: '', label: '', description: '', url: '', auth: { type: 'none' }, enabled: true };

const ServerForm: React.FC<{
  initial: McpServerConfig;
  isNew: boolean;
  onSave: (server: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}> = ({ initial, isNew, onSave, onCancel }) => {
  const [form, setForm] = useState<McpServerConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof McpServerConfig>(key: K, value: McpServerConfig[K]) => setForm(f => ({ ...f, [key]: value }));
  const header = form.auth.type === 'header' ? form.auth.header : '';

  const setAuthType = (type: ServerAuth['type']) =>
    set('auth', type === 'header' ? { type, header: header || 'X-API-Key' } : { type });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="border rounded p-3 bg-body-tertiary" onSubmit={submit} noValidate>
      <div className="fw-semibold small mb-2">{isNew ? 'Add MCP server' : `Edit ${initial.label}`}</div>
      <div className="row g-2">
        <div className="col-sm-6">
          <label className="form-label small mb-1" htmlFor="srv-label">Name</label>
          <input id="srv-label" className="form-control form-control-sm" value={form.label} placeholder="e.g. Weather service"
            onChange={e => set('label', e.target.value)} />
        </div>
        <div className="col-sm-6">
          <label className="form-label small mb-1" htmlFor="srv-id">Id</label>
          <input id="srv-id" className="form-control form-control-sm font-monospace" value={form.id} placeholder="e.g. weather"
            onChange={e => set('id', e.target.value.toLowerCase())} />
          <div className="form-text mt-0">Lowercase letters, digits, dots or dashes</div>
        </div>
        <div className="col-12">
          <label className="form-label small mb-1" htmlFor="srv-url">Streamable HTTP endpoint URL</label>
          <input id="srv-url" className="form-control form-control-sm font-monospace" value={form.url} placeholder="https://example.org/mcp"
            onChange={e => set('url', e.target.value)} />
          <div className="form-text mt-0">Called by the gateway, so internal addresses such as http://akilimo-mcp:3000/mcp work too</div>
        </div>
        <div className="col-12">
          <label className="form-label small mb-1" htmlFor="srv-desc">Description</label>
          <input id="srv-desc" className="form-control form-control-sm" value={form.description}
            onChange={e => set('description', e.target.value)} />
        </div>
        <div className="col-sm-6">
          <label className="form-label small mb-1" htmlFor="srv-auth">Key</label>
          <select id="srv-auth" className="form-select form-select-sm" value={form.auth.type}
            onChange={e => setAuthType(e.target.value as ServerAuth['type'])}>
            <option value="none">No key</option>
            <option value="bearer">Authorization: Bearer</option>
            <option value="header">Custom header</option>
          </select>
          <div className="form-text mt-0">Users enter the key itself in the server panel; it is not stored here</div>
        </div>
        {form.auth.type === 'header' && (
          <div className="col-sm-6">
            <label className="form-label small mb-1" htmlFor="srv-header">Header name</label>
            <input id="srv-header" className="form-control form-control-sm font-monospace" value={header}
              onChange={e => set('auth', { type: 'header', header: e.target.value })} />
          </div>
        )}
        <div className="col-12">
          <div className="form-check form-switch">
            <input id="srv-enabled" className="form-check-input" type="checkbox" role="switch" checked={form.enabled}
              onChange={e => set('enabled', e.target.checked)} />
            <label className="form-check-label small" htmlFor="srv-enabled">Enabled (shown to users)</label>
          </div>
        </div>
      </div>
      {error && <div className="alert alert-danger small mt-2 mb-0" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-sm btn-akilimo" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
};

export const ServerManager: React.FC<Props> = ({ onClose, onChanged }) => {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [editable, setEditable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState(loadAdminToken);
  const [unlocked, setUnlocked] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ server: McpServerConfig; isNew: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await listServers();
      setServers(res.servers);
      setEditable(res.editable);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const unlock = async (candidate: string) => {
    setTokenError(null);
    try {
      await checkAdmin(candidate);
      saveAdminToken(candidate);
      setUnlocked(true);
    } catch (e) {
      setUnlocked(false);
      setTokenError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    // A remembered token unlocks editing straight away
    const remembered = loadAdminToken();
    if (remembered) unlock(remembered);
  }, []);

  const save = async (server: McpServerConfig) => {
    if (editing?.isNew) await addServer(token, server);
    else await updateServer(token, editing!.server.id, server);
    setEditing(null);
    await refresh();
    onChanged();
  };

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await removeServer(token, id);
      setConfirmRemove(null);
      await refresh();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const lock = () => {
    saveAdminToken('');
    setToken('');
    setUnlocked(false);
    setEditing(null);
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="server-manager-title"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h2 id="server-manager-title" className="modal-title h5">Manage MCP servers</h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <p className="small text-body-secondary">
              Servers are shared by everyone using this AKILIMO interface and are reached through its gateway.
              Changes need the gateway admin token.
            </p>

            {!editable && (
              <div className="alert alert-info small">
                Editing is turned off on this gateway. Set <code>GATEWAY_ADMIN_TOKEN</code> for the MCP server and restart it to enable it.
              </div>
            )}

            {editable && !unlocked && (
              <form className="d-flex flex-wrap gap-2 align-items-start mb-3" onSubmit={e => { e.preventDefault(); unlock(token); }}>
                <div className="flex-grow-1">
                  <input type="password" className="form-control form-control-sm" placeholder="Admin token" autoComplete="off"
                    aria-label="Admin token" value={token} onChange={e => setToken(e.target.value)} />
                  {tokenError && <div className="small text-danger mt-1">{tokenError}</div>}
                </div>
                <button type="submit" className="btn btn-sm btn-akilimo d-inline-flex align-items-center gap-1" disabled={!token}>
                  <Lock size={14} /> Unlock editing
                </button>
              </form>
            )}

            {unlocked && (
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="badge text-bg-success">Editing unlocked</span>
                <button type="button" className="btn btn-sm btn-link p-0" onClick={lock}>Forget token</button>
                <button type="button" className="btn btn-sm btn-outline-success ms-auto d-inline-flex align-items-center gap-1"
                  onClick={() => { setEditing({ server: EMPTY, isNew: true }); setConfirmRemove(null); }} disabled={!!editing}>
                  <Plus size={14} /> Add server
                </button>
              </div>
            )}

            {editing && (
              <div className="mb-3">
                <ServerForm key={editing.isNew ? 'new' : editing.server.id} initial={editing.server} isNew={editing.isNew}
                  onSave={save} onCancel={() => setEditing(null)} />
              </div>
            )}

            {loadError && <div className="alert alert-danger small">Cannot load servers: {loadError}</div>}
            {actionError && <div className="alert alert-danger small">{actionError}</div>}

            <ul className="list-group">
              {servers.map(s => (
                <li key={s.id} className="list-group-item">
                  <div className="d-flex align-items-start gap-2">
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold">
                        {s.label} <span className="font-monospace small text-body-secondary">{s.id}</span>
                        {!s.enabled && <span className="badge text-bg-secondary ms-2">disabled</span>}
                      </div>
                      <div className="small font-monospace text-break">{s.url}</div>
                      <div className="small text-body-secondary">{describeAuth(s.auth)}{s.description ? ` · ${s.description}` : ''}</div>
                    </div>
                    {unlocked && confirmRemove !== s.id && (
                      <div className="d-flex gap-1 flex-shrink-0">
                        <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Edit ${s.label}`}
                          onClick={() => { setEditing({ server: s, isNew: false }); setConfirmRemove(null); }} disabled={!!editing}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Remove ${s.label}`}
                          onClick={() => setConfirmRemove(s.id)} disabled={!!editing}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    {confirmRemove === s.id && (
                      <div className="d-flex gap-1 align-items-center flex-shrink-0">
                        <span className="small">Remove for everyone?</span>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(s.id)}>Remove</button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Cancel" onClick={() => setConfirmRemove(null)}>
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
