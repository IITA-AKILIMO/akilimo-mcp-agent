import { Sprout } from 'lucide-react';
import { ActivityFeed } from './components/ActivityFeed';
import { ServerPanel } from './components/ServerPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { ToolRunner } from './components/ToolRunner';
import { useMcpServers } from './mcp/useMcpServers';

export default function App() {
  const { servers, events, connect, disconnect, callTool, clearEvents } = useMcpServers();

  return (
    <div className="d-flex flex-column vh-100">
      <nav className="navbar border-bottom bg-body-tertiary px-3 flex-shrink-0">
        <div className="d-flex align-items-center gap-2">
          <Sprout className="text-akilimo" size={28} />
          <div>
            <span className="navbar-brand mb-0 h1 fs-5">
              Akilimo <span className="text-akilimo">Intelligence</span>
            </span>
            <div className="small text-body-secondary">Run Akilimo MCP tools against the real servers</div>
          </div>
        </div>
        <ThemeToggle />
      </nav>

      <main className="container-fluid flex-grow-1 min-h-0 overflow-auto py-3">
        <div className="row g-3 panel-row">
          <div className="col-12 col-lg-8 col-xxl-9 panel-col">
            <ToolRunner servers={servers} callTool={callTool} />
          </div>
          <div className="col-12 col-lg-4 col-xxl-3 panel-col d-flex flex-column gap-3">
            <ServerPanel servers={servers} onConnect={connect} onDisconnect={disconnect} />
            <ActivityFeed events={events} onClear={clearEvents} />
          </div>
        </div>
      </main>
    </div>
  );
}
