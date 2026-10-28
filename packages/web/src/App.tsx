import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, SlidersHorizontal, Sprout } from 'lucide-react';
import type { MCPEvent } from '@akilimo/shared';
import { clearActivity, loadActivity, saveActivity } from './account/api';
import { useAccount } from './account/useAccount';
import { AccountMenu } from './components/AccountMenu';
import { ActivityFeed } from './components/ActivityFeed';
import { ChatView } from './components/ChatView';
import { AdminDialog } from './components/AdminDialog';
import { ServerPanel } from './components/ServerPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { ToolRunner } from './components/ToolRunner';
import { useMcpServers } from './mcp/useMcpServers';

type Mode = 'chat' | 'advanced';

// Chat is the default; the choice is remembered per browser when storage is available
const savedMode = (): Mode => {
  try {
    return localStorage.getItem('mode') === 'advanced' ? 'advanced' : 'chat';
  } catch {
    return 'chat';
  }
};

export default function App() {
  const account = useAccount();
  const userRef = useRef(account.user);
  userRef.current = account.user;

  // Activity of a signed-in user is saved in small batches; guests' activity stays in this tab
  const pending = useRef<MCPEvent[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);
  const onLog = useCallback((event: MCPEvent) => {
    if (!userRef.current) return;
    pending.current.push(event);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const batch = pending.current.splice(0, 100);
      if (batch.length) saveActivity(batch).catch(() => undefined);
    }, 1500);
  }, []);

  // The hook loads the server registry and auto-connects servers that need no key or have one saved
  const { configs, registryError, servers, events, connect, disconnect, reload, callTool, clearEvents, replaceEvents } = useMcpServers({ onLog });

  // Signing in shows the saved activity; signing out clears the feed on this screen
  const signedInAs = account.user?.id;
  useEffect(() => {
    if (!account.ready) return;
    if (signedInAs) {
      loadActivity().then(replaceEvents).catch(() => undefined);
    } else {
      pending.current = [];
      clearEvents();
      setManaging(false);
    }
  }, [signedInAs, account.ready, replaceEvents, clearEvents]);

  const clearAll = () => {
    clearEvents();
    if (account.user) clearActivity().catch(() => undefined);
  };
  const [mode, setMode] = useState<Mode>(savedMode);
  const [managing, setManaging] = useState(false);
  const isAdmin = account.user?.role === 'admin';

  const changeMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem('mode', next);
    } catch {
      // Storage unavailable; the choice lasts for this visit
    }
  };

  return (
    <div className="d-flex flex-column vh-100">
      <nav className="navbar border-bottom bg-body-tertiary px-3 flex-shrink-0 gap-2">
        <div className="d-flex align-items-center gap-2">
          <Sprout className="text-akilimo" size={28} />
          <div>
            <span className="navbar-brand mb-0 h1 fs-5">
              AKILIMO <span className="text-akilimo">Intelligence</span>
            </span>
            <div className="small text-body-secondary">
              {mode === 'chat' ? 'Ask for fertilizer advice in plain language' : 'Run AKILIMO MCP tools against the real servers'}
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <div className="btn-group btn-group-sm" role="group" aria-label="Mode">
            <button type="button" className={`btn d-inline-flex align-items-center gap-1 ${mode === 'chat' ? 'btn-akilimo' : 'btn-outline-secondary'}`}
              aria-pressed={mode === 'chat'} onClick={() => changeMode('chat')}>
              <MessagesSquare size={14} /> Chat
            </button>
            <button type="button" className={`btn d-inline-flex align-items-center gap-1 ${mode === 'advanced' ? 'btn-akilimo' : 'btn-outline-secondary'}`}
              aria-pressed={mode === 'advanced'} onClick={() => changeMode('advanced')}>
              <SlidersHorizontal size={14} /> Advanced
            </button>
          </div>
          <AccountMenu enabled={account.enabled} user={account.user}
            onLogin={account.login} onRegister={account.register} onLogout={account.logout} onWebSearchChange={account.setWebSearch} />
          <ThemeToggle />
        </div>
      </nav>

      <main className="container-fluid flex-grow-1 min-h-0 overflow-auto py-3">
        <div className="row g-3 panel-row">
          <div className="col-12 col-lg-8 col-xxl-9 panel-col">
            {mode === 'chat'
              ? <ChatView configs={configs} servers={servers} callTool={callTool} accountsEnabled={account.enabled} user={account.user} onWebSearchChange={account.setWebSearch} />
              : <ToolRunner configs={configs} servers={servers} callTool={callTool} />}
          </div>
          <div className="col-12 col-lg-4 col-xxl-3 panel-col d-flex flex-column gap-3">
            <ServerPanel configs={configs} servers={servers} registryError={registryError}
              onConnect={connect} onDisconnect={disconnect} canManage={isAdmin} onManage={() => setManaging(true)} />
            <ActivityFeed events={events} onClear={clearAll} />
          </div>
        </div>
      </main>

      {managing && isAdmin && account.user && (
        <AdminDialog currentUser={account.user} onClose={() => setManaging(false)} onChanged={reload} />
      )}
    </div>
  );
}
