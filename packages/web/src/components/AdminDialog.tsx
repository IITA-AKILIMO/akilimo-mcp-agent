import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plug, Plus, Server, Shield, Trash2, Users, X, XCircle } from 'lucide-react';
import { listUsers, setUserRole, type AdminUser, type Role, type User } from '../account/api';
import { loadKeys } from '../mcp/keys';
import {
  addServer, describeAuth, listServers, needsKey, removeServer, testServer, updateServer,
  type ConnectionTest, type McpServerConfig, type ServerAuth,
} from '../mcp/servers';

interface Props {
  currentUser: User;
  onClose: () => void;
  onChanged: () => void; // registry changed; reload connections
}

const EMPTY: McpServerConfig = { id: '', label: '', description: '', url: '', auth: { type: 'none' }, enabled: true };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type TestState = { running: true } | { running: false; result: ConnectionTest } | null;

const runTest = async (server: Pick<McpServerConfig, 'url' | 'auth'>, key: string | undefined, setState: (s: TestState) => void) => {
  setState({ running: true });
  try {
    setState({ running: false, result: await testServer(server, key) });
  } catch (e) {
    setState({ running: false, result: { ok: false, ms: 0, error: message(e) } });
  }
};

const TestResult: React.FC<{ state: TestState }> = ({ state }) => {
  if (!state) return null;
  if (state.running) return <div className="small text-body-secondary d-flex align-items-center gap-1 mt-2"><Loader2 size={14} className="spin" /> Connecting…</div>;
  const { result } = state;
  if (!result.ok) {
    return (
      <div className="small text-danger d-flex align-items-start gap-1 mt-2" style={{ whiteSpace: 'pre-wrap' }}>
        <XCircle size={14} className="flex-shrink-0 mt-1" /> <span>Connection failed: {result.error}</span>
      </div>
    );
  }
  const tools = result.tools ?? [];
  return (
    <div className="small text-success-emphasis d-flex align-items-start gap-1 mt-2">
      <CheckCircle2 size={14} className="flex-shrink-0 mt-1 text-success" />
      <span>
        Connected{result.server ? ` to ${result.server.name} ${result.server.version}` : ''} in {result.ms} ms, {tools.length} tool{tools.length === 1 ? '' : 's'}
        {tools.length > 0 && <span className="text-body-secondary">: {tools.slice(0, 12).join(', ')}{tools.length > 12 ? `, +${tools.length - 12} more` : ''}</span>}
      </span>
    </div>
  );
};

const ServerForm: React.FC<{
  initial: McpServerConfig;
  isNew: boolean;
  onSave: (server: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}> = ({ initial, isNew, onSave, onCancel }) => {
  const [form, setForm] = useState<McpServerConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only for the test; prefilled with the key this browser remembers for the server, never saved
  const [testKey, setTestKey] = useState(() => loadKeys()[initial.id] ?? '');
  const [test, setTest] = useState<TestState>(null);
  const set = <K extends keyof McpServerConfig>(key: K, value: McpServerConfig[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setTest(null);
  };
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
      setError(message(err));
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
        {form.auth.type !== 'none' && (
          <div className="col-12">
            <label className="form-label small mb-1" htmlFor="srv-test-key">Key for testing (optional)</label>
            <input id="srv-test-key" type="password" className="form-control form-control-sm" autoComplete="off" value={testKey}
              onChange={e => { setTestKey(e.target.value.trim()); setTest(null); }} />
            <div className="form-text mt-0">Used only for “Test connection”; not saved</div>
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
      <TestResult state={test} />
      {error && <div className="alert alert-danger small mt-2 mb-0" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-sm btn-akilimo" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
          onClick={() => runTest(form, form.auth.type === 'none' ? undefined : testKey, setTest)} disabled={saving || !form.url.trim() || test?.running}>
          <Plug size={14} /> Test connection
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
};

const ServersTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ server: McpServerConfig; isNew: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  // Registered servers are tested with the key this browser remembers for them, if any
  const testRow = (s: McpServerConfig) =>
    runTest(s, needsKey(s) ? loadKeys()[s.id] : undefined, state => setTests(prev => ({ ...prev, [s.id]: state })));

  const refresh = async () => {
    try {
      setTests({});
      setServers((await listServers()).servers);
      setError(null);
    } catch (e) {
      setError(`Cannot load servers: ${message(e)}`);
    }
  };
  useEffect(() => { refresh(); }, []);

  const save = async (server: McpServerConfig) => {
    if (editing?.isNew) await addServer(server);
    else await updateServer(editing!.server.id, server);
    setEditing(null);
    await refresh();
    onChanged();
  };

  const remove = async (id: string) => {
    try {
      await removeServer(id);
      setConfirmRemove(null);
      await refresh();
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3">
        <p className="small text-body-secondary mb-0">Shared by everyone using this interface and reached through its gateway.</p>
        <button type="button" className="btn btn-sm btn-outline-success ms-auto d-inline-flex align-items-center gap-1 flex-shrink-0"
          onClick={() => { setEditing({ server: EMPTY, isNew: true }); setConfirmRemove(null); }} disabled={!!editing}>
          <Plus size={14} /> Add server
        </button>
      </div>

      {editing && (
        <div className="mb-3">
          <ServerForm key={editing.isNew ? 'new' : editing.server.id} initial={editing.server} isNew={editing.isNew}
            onSave={save} onCancel={() => setEditing(null)} />
        </div>
      )}
      {error && <div className="alert alert-danger small">{error}</div>}

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
              {confirmRemove !== s.id ? (
                <div className="d-flex gap-1 flex-shrink-0">
                  <button type="button" className="btn btn-sm btn-outline-primary" aria-label={`Test ${s.label}`} title="Test connection"
                    onClick={() => testRow(s)} disabled={tests[s.id]?.running}>
                    <Plug size={14} />
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" aria-label={`Edit ${s.label}`}
                    onClick={() => { setEditing({ server: s, isNew: false }); setConfirmRemove(null); }} disabled={!!editing}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Remove ${s.label}`}
                    onClick={() => setConfirmRemove(s.id)} disabled={!!editing}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <div className="d-flex gap-1 align-items-center flex-shrink-0">
                  <span className="small">Remove for everyone?</span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(s.id)}>Remove</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Cancel" onClick={() => setConfirmRemove(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            <TestResult state={tests[s.id] ?? null} />
          </li>
        ))}
      </ul>
    </>
  );
};

const UsersTab: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDemote, setConfirmDemote] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setUsers((await listUsers()).users);
      setError(null);
    } catch (e) {
      setError(`Cannot load users: ${message(e)}`);
    }
  };
  useEffect(() => { refresh(); }, []);

  const changeRole = async (id: string, role: Role) => {
    try {
      await setUserRole(id, role);
      setConfirmDemote(null);
      await refresh();
    } catch (e) {
      setError(message(e));
      setConfirmDemote(null);
    }
  };

  return (
    <>
      <p className="small text-body-secondary">Admins manage MCP servers and other people's roles. New accounts start as users.</p>
      {error && <div className="alert alert-danger small">{error}</div>}
      <ul className="list-group">
        {users.map(u => (
          <li key={u.id} className="list-group-item d-flex align-items-center gap-2">
            <div className="flex-grow-1 min-w-0">
              <div className="fw-semibold text-truncate">
                {u.name}
                {u.id === currentUser.id && <span className="text-body-secondary fw-normal ms-1">(you)</span>}
              </div>
              <div className="small text-body-secondary text-truncate">@{u.username} · {u.email} · joined {new Date(u.created_at).toLocaleDateString()}</div>
            </div>
            <span className={`badge ${u.role === 'admin' ? 'text-bg-success' : 'text-bg-secondary'}`}>{u.role}</span>
            {u.role === 'user' && (
              <button type="button" className="btn btn-sm btn-outline-success flex-shrink-0" onClick={() => changeRole(u.id, 'admin')}>
                Make admin
              </button>
            )}
            {u.role === 'admin' && confirmDemote !== u.id && (
              <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" onClick={() => setConfirmDemote(u.id)}>
                Remove admin
              </button>
            )}
            {confirmDemote === u.id && (
              <span className="d-flex gap-1 align-items-center flex-shrink-0">
                <span className="small">{u.id === currentUser.id ? 'Remove your own admin rights?' : 'Remove admin rights?'}</span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => changeRole(u.id, 'user')}>Confirm</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Cancel" onClick={() => setConfirmDemote(null)}>
                  <X size={14} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
};

// Admin-only dialog: shared MCP servers and user roles
export const AdminDialog: React.FC<Props> = ({ currentUser, onClose, onChanged }) => {
  const [tab, setTab] = useState<'servers' | 'users'>('servers');

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h2 id="admin-dialog-title" className="modal-title h5 d-flex align-items-center gap-2">
              <Shield size={18} className="text-akilimo" /> Admin
            </h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <ul className="nav nav-tabs mb-3" role="tablist">
              <li className="nav-item" role="presentation">
                <button type="button" role="tab" aria-selected={tab === 'servers'}
                  className={`nav-link d-inline-flex align-items-center gap-1 ${tab === 'servers' ? 'active' : ''}`} onClick={() => setTab('servers')}>
                  <Server size={14} /> MCP servers
                </button>
              </li>
              <li className="nav-item" role="presentation">
                <button type="button" role="tab" aria-selected={tab === 'users'}
                  className={`nav-link d-inline-flex align-items-center gap-1 ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
                  <Users size={14} /> Users
                </button>
              </li>
            </ul>
            {tab === 'servers' ? <ServersTab onChanged={onChanged} /> : <UsersTab currentUser={currentUser} />}
          </div>
        </div>
      </div>
    </div>
  );
};
