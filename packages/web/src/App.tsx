import { useRef, useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ActivityFeed } from './components/ActivityFeed';
import { ThemeToggle } from './components/ThemeToggle';
import type { Message, MCPEvent, Scenario } from '@akilimo/shared';
import { Sprout } from 'lucide-react';

const DEMO_SCENARIOS: Scenario[] = [
  {
    id: 'hybrid-akilimo-demo',
    name: 'Hybrid Akilimo Demo',
    description: 'Showcase Akilimo 2.0 + Akilimo 1.0 agent collaboration',
    steps: [
      { type: 'user_message', content: 'Compare the official recommendations with my local custom settings.', delay: 0 },
      { type: 'tool_call', server: 'akilimo-2.0', content: 'Fetching baseline from the Akilimo 2.0 agent...', payload: { tool: 'get_baseline', args: { country: 'NG' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-2.0', content: 'Official baseline: Standard NPK application.', payload: { baseline: 'NPK 15-15-15' }, delay: 1500 },
      { type: 'tool_call', server: 'akilimo-1.0', content: 'Applying local cost constraints via the Akilimo 1.0 agent...', payload: { tool: 'compute_recommendations', args: { compute_request: { maxInvestment: 200000 } } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-1.0', content: 'Akilimo 1.0 optimized recommendation: Reduced Urea to fit budget.', payload: { result: 'Optimized budget version' }, delay: 1500 },
      { type: 'assistant_message', content: 'The Akilimo 2.0 baseline suggests standard NPK, but based on your specific budget constraints processed by the Akilimo 1.0 agent, I recommend a slightly reduced Urea application to stay within your 200,000 NGN limit.', delay: 1000 },
    ]
  },
  {
    id: 'multi-agent-harvest',
    name: 'Maize Harvest Cycle',
    description: 'Demonstrate orchestration between Akilimo, Weather, and Market agents',
    steps: [
      { type: 'user_message', content: 'I am planning to harvest my maize. Should I do it this week?', delay: 0 },
      { type: 'tool_call', server: 'akilimo-1.0', content: 'Checking planting history and crop stage...', payload: { tool: 'get_recommendation_history', args: { userId: 'user_123' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-1.0', content: 'Crop is at maturity stage. Planting date: May 12.', payload: { status: 'mature', planted: '2026-05-12' }, delay: 1500 },
      { type: 'tool_call', server: 'weather', content: 'Fetching 7-day weather forecast for coordinates...', payload: { tool: 'get_forecast', args: { lat: '6.5', long: '3.3' } }, delay: 1000 },
      { type: 'tool_response', server: 'weather', content: 'Heavy rain expected on Thursday and Friday.', payload: { forecast: 'Rain', probability: '85%' }, delay: 1500 },
      { type: 'tool_call', server: 'market', content: 'Analyzing current maize price trends...', payload: { tool: 'get_price_trends', args: { crop: 'maize' } }, delay: 1000 },
      { type: 'tool_response', server: 'market', content: 'Prices are currently peaking and expected to drop slightly next month.', payload: { trend: 'peak', price: '450 NGN' }, delay: 1500 },
      { type: 'assistant_message', content: 'Based on the data from three different agents: Your maize is mature (Akilimo), prices are currently at a peak (Market), and there is heavy rain expected late this week (Weather). I strongly recommend harvesting by Wednesday to avoid rain damage and capture the current high market price.', delay: 1000 },
    ]
  },
  {
    id: 'nigeria-cassava',
    name: 'Nigeria Cassava Case',
    description: 'Demonstrate regional data fetching and complex computation',
    steps: [
      { type: 'user_message', content: 'I am a farmer in Nigeria growing cassava. What should I do?', delay: 0 },
      { type: 'tool_call', server: 'akilimo-1.0', content: 'Fetching regional reference data for Nigeria...', payload: { tool: 'get_reference_data', args: { category: 'fertilizers', countryCode: 'NG' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-1.0', content: 'Found 12 available fertilizers for NG including Urea and NPK.', payload: { data: [{ key: 'urea', label: 'urea', name: 'Urea 46%' }] }, delay: 1500 },
      { type: 'assistant_message', content: 'I see you are in Nigeria. To give you the best advice, I need to know your field size and available budget.', delay: 1000 },
      { type: 'user_message', content: 'My field is 2 hectares and my budget is 500,000 NGN.', delay: 1000 },
      { type: 'tool_call', server: 'akilimo-1.0', content: 'Computing optimal recommendations...', payload: { tool: 'compute_recommendations', args: { compute_request: { farmInformation: { country_code: 'NG', use_case: 'FR', field_size: 2, area_unit: 'ha' }, maxInvestment: 500000 } } }, delay: 2000 },
      { type: 'tool_response', server: 'akilimo-1.0', content: 'Computation successful: Recommended Urea and NPK 15-15-15.', payload: { result: { recommendations: 'Apply 2 bags of Urea...' } }, delay: 2000 },
      { type: 'assistant_message', content: 'Based on your budget and location, I recommend applying 2 bags of Urea and 3 bags of NPK 15-15-15. This will maximize your cassava yield while staying within budget.', delay: 1000 },
    ]
  }
];

// Every MCP server referenced by the scenarios, plus the one used for free-form chat
const MCP_SERVERS = Array.from(new Set([
  'akilimo-1.0',
  ...DEMO_SCENARIOS.flatMap(s => s.steps.map(step => step.server).filter((id): id is string => !!id)),
]));

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disabledServers, setDisabledServers] = useState<string[]>([]);
  // Mirrors disabledServers so a running scenario sees toggles made mid-run
  const disabledRef = useRef<string[]>([]);

  const toggleServer = (id: string) => {
    const next = disabledRef.current.includes(id)
      ? disabledRef.current.filter(s => s !== id)
      : [...disabledRef.current, id];
    disabledRef.current = next;
    setDisabledServers(next);
  };

  const isDisabled = (id?: string) => !!id && disabledRef.current.includes(id);

  const addEvent = (type: MCPEvent['type'], server: string, message: string, payload?: any) => {
    setEvents(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      type,
      server,
      message,
      payload
    }]);
  };

  const addMessage = (role: Message['role'], text: string) => {
    setMessages(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      role,
      text,
      timestamp: new Date()
    }]);
  };

  const handleSendMessage = async (text: string) => {
    setBusy(true);
    addMessage('user', text);
    setIsTyping(true);

    addEvent('thought', 'system', 'Analyzing user request...', {});
    await new Promise(r => setTimeout(r, 1000));

    if (isDisabled('akilimo-1.0')) {
      addEvent('thought', 'system', 'Skipped akilimo-1.0: server is disabled', {});
      await new Promise(r => setTimeout(r, 1000));
      addMessage('assistant', 'The Akilimo 1.0 MCP server is disabled, so I cannot look up agricultural data right now. Enable it in the MCP servers panel and ask again.');
      setIsTyping(false);
      setBusy(false);
      return;
    }

    addEvent('tool_call', 'akilimo-1.0', 'Calling get_reference_data...', { category: 'countries' });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('tool_response', 'akilimo-1.0', 'Received country list', { countries: ['NG', 'GH', 'KE'] });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('synthesis', 'system', 'Formulating response...', {});
    await new Promise(r => setTimeout(r, 1000));
    
    addMessage('assistant', 'I can help you with that! I have access to agricultural data for several countries including Nigeria, Ghana, and Kenya.');
    setIsTyping(false);
    setBusy(false);
  };

  const runScenario = async (scenario: Scenario) => {
    setBusy(true);
    setMessages([]);
    setEvents([]);

    for (const step of scenario.steps) {
      await new Promise(r => setTimeout(r, step.delay));
      
      if (step.type === 'user_message') {
        addMessage('user', step.content);
      } else if (step.type === 'assistant_message') {
        setIsTyping(true);
        await new Promise(r => setTimeout(r, 1000));
        addMessage('assistant', step.content);
        setIsTyping(false);
      } else if (isDisabled(step.server)) {
        // Log the skipped call once; its response never arrives
        if (step.type === 'tool_call') {
          addEvent('thought', 'system', `Skipped ${step.server}: server is disabled`, {});
        }
      } else if (step.type === 'tool_call') {
        addEvent('tool_call', step.server || 'system', step.content, step.payload);
      } else if (step.type === 'tool_response') {
        addEvent('tool_response', step.server || 'system', step.content, step.payload);
      }
    }
    setBusy(false);
  };

  return (
    <div className="d-flex flex-column vh-100">
      <nav className="navbar border-bottom bg-body-tertiary px-3 flex-shrink-0">
        <div className="d-flex align-items-center gap-2">
          <Sprout className="text-akilimo" size={28} />
          <div>
            <span className="navbar-brand mb-0 h1 fs-5">
              Akilimo <span className="text-akilimo">Intelligence</span>
            </span>
            <div className="small text-body-secondary">AI Agricultural Consultant powered by MCP</div>
          </div>
        </div>
        <ThemeToggle />
      </nav>

      <main className="container-fluid flex-grow-1 min-h-0 overflow-auto py-3">
        <div className="row g-3 panel-row">
          <div className="col-12 col-lg-8 col-xxl-9 panel-col">
            <ChatInterface
              messages={messages}
              scenarios={DEMO_SCENARIOS}
              onSendMessage={handleSendMessage}
              onRunScenario={runScenario}
              isTyping={isTyping}
              busy={busy}
            />
          </div>
          <div className="col-12 col-lg-4 col-xxl-3 panel-col">
            <ActivityFeed
              events={events}
              servers={MCP_SERVERS}
              disabledServers={disabledServers}
              onToggleServer={toggleServer}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
