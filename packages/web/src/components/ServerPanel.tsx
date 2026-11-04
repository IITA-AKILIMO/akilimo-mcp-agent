import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Server, Settings2 } from 'lucide-react';
import { loadKeys, read, saveKey, write } from '../mcp/keys';
import { describeAuth, needsKey, type McpServerConfig } from '../mcp/servers';
import type { ConnectionStatus, ServerState } from '../mcp/useMcpServers';

interface Props {
  configs: McpServerConfig[];
  servers: Record<string, ServerState>;
  registryError: string | null;
  // Servers with a key an admin saved for signed-in users, and whether this user is an admin (no limit for them)
  sharedKeys: string[];
  isAdmin: boolean;
  // The keys the signed-in user saved in their account (last characters), and how to save or remove one; without an account
  // (accountSaves false) the key is only remembered in this browser
  ownKeys: Record<string, string>;
  accountSaves: boolean;
  onSaveOwnKey: (id: string, key: string) => Promise<void>;
  onRemoveOwnKey: (id: string) => Promise<void>;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  // Only admins see Manage; registry changes are checked server-side as well
  canManage: boolean;
  onManage: () => void;
}

const StatusBadge: Record<ConnectionStatus, string> = {
  disconnected: 'text-bg-secondary',
  connecting: 'text-bg-warning',
  connected: 'text-bg-success',
  error: 'text-bg-danger',
};

// The key of one server. A signed-in user saves it in their ACCOUNT (encrypted in the database, so it survives signing out
// and follows them to other devices; only its last characters are ever shown). Without an account (guests, or a server
// with no database) it is only remembered in this browser. A key an admin already provided means nothing has to be entered.
const KeyBlock: React.FC<{
  server: McpServerConfig;
  shared: boolean; // an admin saved a key for everyone
  isAdmin: boolean;
  connected: boolean;
  savedHint: string | undefined; // the key saved in the user's account (last characters)
  localKey: string; // the key remembered in this browser, if any
  accountSaves: boolean;
  onLocalKey: (key: string) => void;
  onSave: (key: string) => Promise<void>;
  onRemove: () => Promise<void>;
}> = ({ server, shared, isAdmin, connected, savedHint, localKey, accountSaves, onLocalKey, onSave, onRemove }) => {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false); // the key box, when a key is not needed
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, done?: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      done?.();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const save = (key: string, then?: () => void) => run(() => onSave(key.trim()), () => { setDraft(''); setOpen(false); then?.(); });

  // Without an account: the old behaviour, a box that remembers the key in this browser
  if (!accountSaves) {
    return (
      <div className="mt-2">
        <input type="password" className="form-control form-control-sm" autoComplete="off" placeholder="Key" aria-label={`${server.label} key`}
          value={localKey} disabled={connected} onChange={e => onLocalKey(e.target.value)} />
        <div className="form-text mt-0">{describeAuth(server.auth)}; remembered in this browser</div>
      </div>
    );
  }

  const note = shared && !savedHint
    ? `Connects with the key your admin set${isAdmin ? ' (no limit for admins)' : ', with a limited number of calls'}.`
    : null;

  return (
    <div className="mt-2 small">
      {savedHint && !open && (
        <div className="text-body-secondary">
          Your key is saved in your account ({savedHint}), with no limit.{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setOpen(true)} disabled={busy}>Replace</button>
          {' · '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline text-danger" onClick={() => run(onRemove)} disabled={busy}>Remove</button>
        </div>
      )}
      {note && !open && (
        <div className="text-body-secondary">
          {note}{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setOpen(true)}>Use my own key</button>
        </div>
      )}
      {(open || (!savedHint && !shared)) && (
        <>
          <div className="input-group input-group-sm">
            <input type="password" className="form-control" autoComplete="off" aria-label={`${server.label} key`} value={draft}
              placeholder={savedHint ? `Saved (${savedHint}) · type to replace` : shared ? 'Your own key (optional)' : 'Key'}
              onChange={e => setDraft(e.target.value)} />
            <button type="button" className="btn btn-outline-success" disabled={busy || draft.trim() === ''} onClick={() => save(draft)}>
              {busy ? 'Saving…' : 'Save to my account'}
            </button>
            {open && <button type="button" className="btn btn-outline-secondary" onClick={() => { setOpen(false); setDraft(''); }} disabled={busy}>Cancel</button>}
          </div>
          <div className="form-text mt-0">{describeAuth(server.auth)}; saved encrypted in your account, never shown again{shared ? '. Leave it empty to use the key your admin set.' : '.'}</div>
        </>
      )}
      {localKey && !savedHint && (
        <div className="mt-1 text-body-secondary">
          A key is stored only in this browser.{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" disabled={busy}
            onClick={() => save(localKey, () => onLocalKey(''))}>Move it to my account</button>
        </div>
      )}
      {problem && <div className="text-danger mt-1 text-break">{problem}</div>}
    </div>
  );
};

export const ServerPanel: React.FC<Props> = ({ configs, servers, registryError, sharedKeys, isAdmin, ownKeys, accountSaves, onSaveOwnKey, onRemoveOwnKey, onConnect, onDisconnect, canManage, onManage }) => {
  // Remembered in this browser (see mcp/keys.ts) when there is no account to save to; sent only with requests to that server
  const [keys, setKeys] = useState<Record<string, string>>(loadKeys);

  // The panel can be folded away to give the chat more room; the choice is remembered in this browser
  const [collapsed, setCollapsed] = useState<boolean>(() => read('panel-servers-collapsed', false));
  const toggle = () => setCollapsed(c => { write('panel-servers-collapsed', !c); return !c; });
  const on = configs.filter(s => servers[s.id]?.status === 'connected').length;

  const setKey = (id: string, key: string) => {
    setKeys(prev => ({ ...prev, [id]: key }));
    saveKey(id, key);
  };

  return (
    <div className="card shadow-sm flex-shrink-0">
      <div className="card-header d-flex align-items-center gap-2">
        <button type="button" className="btn btn-sm p-0 border-0 d-inline-flex align-items-center gap-2 text-start" aria-expanded={!collapsed} onClick={toggle}
          title={collapsed ? 'Show the MCP servers' : 'Hide the MCP servers'}>
          {collapsed ? <ChevronRight size={16} className="text-body-secondary" /> : <ChevronDown size={16} className="text-body-secondary" />}
          <Server size={16} className="text-body-secondary" />
          <h2 className="h6 mb-0 text-uppercase small fw-semibold text-body-secondary">MCP servers</h2>
          {collapsed && configs.length > 0 && <span className="badge text-bg-secondary">{on}/{configs.length} on</span>}
        </button>
        {canManage && (
          <button type="button" className="btn btn-sm btn-outline-secondary ms-auto d-inline-flex align-items-center gap-1" onClick={onManage} title="Manage MCP servers, AI providers and users">
            <Settings2 size={14} /> Manage
          </button>
        )}
      </div>
      {!collapsed && registryError && <div className="alert alert-danger small m-2 mb-0">Cannot load the server list: {registryError}</div>}
      {!collapsed && !registryError && configs.length === 0 && (
        <div className="small text-body-secondary p-3">
          No servers configured.{canManage ? ' Use Manage to add one.' : ' An admin can add them.'}
        </div>
      )}
      <ul className={`list-group list-group-flush ${collapsed ? 'd-none' : ''}`}>
        {configs.map(s => {
          const state = servers[s.id] ?? { status: 'disconnected', tools: [] };
          const on = state.status === 'connected' || state.status === 'connecting';
          return (
            <li key={s.id} className="list-group-item">
              <div className="d-flex align-items-center gap-2">
                <div className="form-check form-switch mb-0">
                  <input className="form-check-input" type="checkbox" role="switch" id={`server-${s.id}`}
                    checked={on} disabled={state.status === 'connecting'}
                    onChange={e => (e.target.checked ? onConnect(s.id) : onDisconnect(s.id))} />
                  <label className="form-check-label fw-semibold" htmlFor={`server-${s.id}`}>{s.label}</label>
                </div>
                <span className={`badge ${StatusBadge[state.status]} ms-auto`}>
                  {state.status === 'connected' ? `${state.tools.length} tools` : state.status}
                </span>
              </div>
              {s.description && <div className="small text-body-secondary">{s.description}</div>}
              {needsKey(s) && (
                <KeyBlock server={s} shared={sharedKeys.includes(s.id)} isAdmin={isAdmin} connected={on}
                  savedHint={ownKeys[s.id]} localKey={keys[s.id] ?? ''} accountSaves={accountSaves}
                  onLocalKey={key => setKey(s.id, key)} onSave={key => onSaveOwnKey(s.id, key)} onRemove={() => onRemoveOwnKey(s.id)} />
              )}
              {state.status === 'error' && state.error && (
                <div className="small text-danger mt-1 text-break">{state.error}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
