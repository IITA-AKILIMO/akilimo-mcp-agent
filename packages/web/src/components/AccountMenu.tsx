import React, { useState } from 'react';
import { Globe, LogIn, LogOut, UserCircle } from 'lucide-react';
import type { User } from '../account/api';

interface Props {
  enabled: boolean;
  user: User | null;
  onLogin: (login: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, username: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  // Saves the user's choice to let the AI chat search the internet (a setting of the account)
  onWebSearchChange: (on: boolean) => Promise<void>;
}

const AuthDialog: React.FC<Omit<Props, 'enabled' | 'user' | 'onLogout' | 'onWebSearchChange'> & { onClose: () => void }> = ({ onLogin, onRegister, onClose }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await onLogin(login, password);
      else await onRegister(name, email, username, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="auth-title"
      style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '24rem' }}>
        <form className="modal-content" onSubmit={submit}>
          <div className="modal-header">
            <h2 id="auth-title" className="modal-title h5">{mode === 'login' ? 'Sign in' : 'Create an account'}</h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>
          <div className="modal-body d-flex flex-column gap-2">
            <p className="small text-body-secondary mb-1">Your chats and activity are saved to your account so you can come back to them.</p>
            {mode === 'register' && (
              <div>
                <label className="form-label small mb-1" htmlFor="auth-name">Name</label>
                <input id="auth-name" className="form-control" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            {mode === 'register' ? (
              <>
                <div>
                  <label className="form-label small mb-1" htmlFor="auth-username">Username</label>
                  <input id="auth-username" className="form-control" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    minLength={3} maxLength={30} pattern="[A-Za-z0-9._\-]+" value={username} onChange={e => setUsername(e.target.value)} required />
                  <div className="form-text">3–30 letters, digits, dots, underscores or hyphens</div>
                </div>
                <div>
                  <label className="form-label small mb-1" htmlFor="auth-email">Email</label>
                  <input id="auth-email" type="email" className="form-control" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              </>
            ) : (
              <div>
                <label className="form-label small mb-1" htmlFor="auth-login">Email or username</label>
                <input id="auth-login" className="form-control" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={login} onChange={e => setLogin(e.target.value)} required />
              </div>
            )}
            <div>
              <label className="form-label small mb-1" htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" className="form-control" minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required />
              {mode === 'register' && <div className="form-text">At least 8 characters</div>}
            </div>
            {error && <div className="alert alert-danger small mb-0">{error}</div>}
          </div>
          <div className="modal-footer justify-content-between">
            <button type="button" className="btn btn-link btn-sm px-0" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
              {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </button>
            <button type="submit" className="btn btn-akilimo" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const AccountMenu: React.FC<Props> = ({ enabled, user, onLogin, onRegister, onLogout, onWebSearchChange }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!enabled) return null;

  if (user) {
    return (
      <div className="d-flex align-items-center gap-2">
        <span className="small d-none d-md-inline-flex align-items-center gap-1" title={`@${user.username} · ${user.email}`}>
          <UserCircle size={16} className="text-akilimo" /> {user.name}
          {user.role === 'admin' && <span className="badge text-bg-success">Admin</span>}
        </span>
        <button type="button" className={`btn btn-sm d-inline-flex align-items-center gap-1 ${user.web_search ? 'btn-success' : 'btn-outline-secondary'}`} aria-pressed={user.web_search} disabled={saving}
          title={saveError ?? (user.web_search ? 'Web search is on for your account: the AI chat can search the internet in all your conversations. Click to turn it off' : 'Web search is off for your account. Click to let the AI chat search the internet in all your conversations')}
          onClick={() => { setSaving(true); setSaveError(null); onWebSearchChange(!user.web_search).catch(e => setSaveError(e instanceof Error ? e.message : String(e))).finally(() => setSaving(false)); }}>
          <Globe size={14} /> <span className="d-none d-sm-inline">Web search {user.web_search ? 'on' : 'off'}</span>
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={onLogout} title="Sign out">
          <LogOut size={14} /> <span className="d-none d-sm-inline">Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1" onClick={() => setOpen(true)}>
        <LogIn size={14} /> Sign in
      </button>
      {open && <AuthDialog onLogin={onLogin} onRegister={onRegister} onClose={() => setOpen(false)} />}
    </>
  );
};
