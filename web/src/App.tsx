import React, { useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ActivityFeed } from './components/ActivityFeed';
import { Message, MCPEvent, Scenario } from './types/mcp';

const DEMO_SCENARIOS: Scenario[] = [
  {
    id: 'hybrid-akilimo-demo',
    name: 'Hybrid Akilimo Demo',
    description: 'Showcase Official 2.0 Agent + Custom Agent collaboration',
    steps: [
      { type: 'user_message', content: 'Compare the official recommendations with my local custom settings.', delay: 0 },
      { type: 'tool_call', server: 'akilimo-official', content: 'Fetching production baseline from Official 2.0 Agent...', payload: { tool: 'get_baseline', args: { country: 'NG' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-official', content: 'Official baseline: Standard NPK application.', payload: { baseline: 'NPK 15-15-15' }, delay: 1500 },
      { type: 'tool_call', server: 'akilimo-custom', content: 'Applying local custom cost constraints via Custom Agent...', payload: { tool: 'compute_recommendations', args: { payload: { maxInvestment: 200000 } } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo-custom', content: 'Custom optimized recommendation: Reduced Urea to fit budget.', payload: { result: 'Optimized budget version' }, delay: 1500 },
      { type: 'assistant_message', content: 'The official Akilimo 2.0 baseline suggests standard NPK, but based on your specific budget constraints processed by our custom agent, I recommend a slightly reduced Urea application to stay within your 200,000 NGN limit.', delay: 1000 },
    ]
  },
  {
    id: 'multi-agent-harvest',
    name: 'Maize Harvest Cycle',
    description: 'Demonstrate orchestration between Akilimo, Weather, and Market agents',
    steps: [
      { type: 'user_message', content: 'I am planning to harvest my maize. Should I do it this week?', delay: 0 },
      { type: 'tool_call', server: 'akilimo', content: 'Checking planting history and crop stage...', payload: { tool: 'get_recommendation_history', args: { userId: 'user_123' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo', content: 'Crop is at maturity stage. Planting date: May 12.', payload: { status: 'mature', planted: '2026-05-12' }, delay: 1500 },
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
      { type: 'tool_call', server: 'akilimo', content: 'Fetching regional reference data for Nigeria...', payload: { tool: 'get_reference_data', args: { category: 'fertilizers', countryCode: 'NG' } }, delay: 1000 },
      { type: 'tool_response', server: 'akilimo', content: 'Found 12 available fertilizers for NG including Urea and NPK.', payload: { data: [{ key: 'urea', label: 'urea', name: 'Urea 46%' }] }, delay: 1500 },
      { type: 'assistant_message', content: 'I see you are in Nigeria. To give you the best advice, I need to know your field size and available budget.', delay: 1000 },
      { type: 'user_message', content: 'My field is 2 hectares and my budget is 500,000 NGN.', delay: 1000 },
      { type: 'tool_call', server: 'akilimo', content: 'Computing optimal recommendations...', payload: { tool: 'compute_recommendations', args: { payload: { farmInformation: { countryCode: 'NG', fieldSize: 2, areaUnit: 'hectares' }, maxInvestment: 500000 } } }, delay: 2000 },
      { type: 'tool_response', server: 'akilimo', content: 'Computation successful: Recommended Urea and NPK 15-15-15.', payload: { result: { recommendations: 'Apply 2 bags of Urea...' } }, delay: 2000 },
      { type: 'assistant_message', content: 'Based on your budget and location, I recommend applying 2 bags of Urea and 3 bags of NPK 15-15-15. This will maximize your cassava yield while staying within budget.', delay: 1000 },
    ]
  }
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [isTyping, setIsTyping] = useState(false);

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
    addMessage('user', text);
    setIsTyping(true);
    
    addEvent('thought', 'system', 'Analyzing user request...', {});
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('tool_call', 'akilimo', 'Calling get_reference_data...', { category: 'countries' });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('tool_response', 'akilimo', 'Received country list', { countries: ['NG', 'GH', 'KE'] });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('synthesis', 'system', 'Formulating response...', {});
    await new Promise(r => setTimeout(r, 1000));
    
    addMessage('assistant', 'I can help you with that! I have access to agricultural data for several countries including Nigeria, Ghana, and Kenya.');
    setIsTyping(false);
  };

  const runScenario = async (scenario: Scenario) => {
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
      } else if (step.type === 'tool_call') {
        addEvent('tool_call', step.server || 'system', step.content, step.payload);
      } else if (step.type === 'tool_response') {
        addEvent('tool_response', step.server || 'system', step.content, step.payload);
      }
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="flex-1 h-full">
        <ChatInterface 
          messages={messages} 
          scenarios={DEMO_SCENARIOS} 
          onSendMessage={handleSendMessage} 
          onRunScenario={runScenario}
          isTyping={isTyping}
        />
      </div>
      <div className="w-1/3 h-full">
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}
