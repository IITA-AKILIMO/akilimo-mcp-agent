import React, { useState, useEffect } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ActivityFeed } from './components/ActivityFeed';
import { Message, MCPEvent, Scenario } from './types/mcp';

const DEMO_SCENARIOS: Scenario[] = [
  {
    id: 'nigeria-cassava',
    name: 'Nigeria Cassava Case',
    description: 'Demonstrate regional data fetching and complex computation',
    steps: [
      { type: 'user_message', content: 'I am a farmer in Nigeria growing cassava. What should I do?', delay: 0 },
      { type: 'tool_call', content: 'Fetching regional reference data for Nigeria...', payload: { tool: 'get_reference_data', args: { category: 'fertilizers', countryCode: 'NG' } }, delay: 1000 },
      { type: 'tool_response', content: 'Found 12 available fertilizers for NG including Urea and NPK.', payload: { data: [{ key: 'urea', label: 'urea', name: 'Urea 46%' }] }, delay: 1500 },
      { type: 'assistant_message', content: 'I see you are in Nigeria. To give you the best advice, I need to know your field size and available budget.', delay: 1000 },
      { type: 'user_message', content: 'My field is 2 hectares and my budget is 500,000 NGN.', delay: 1000 },
      { type: 'tool_call', content: 'Computing optimal recommendations...', payload: { tool: 'compute_recommendations', args: { payload: { farmInformation: { countryCode: 'NG', fieldSize: 2, areaUnit: 'hectares' }, maxInvestment: 500000 } } }, delay: 2000 },
      { type: 'tool_response', content: 'Computation successful: Recommended Urea and NPK 15-15-15.', payload: { result: { recommendations: 'Apply 2 bags of Urea...' } }, delay: 2000 },
      { type: 'assistant_message', content: 'Based on your budget and location, I recommend applying 2 bags of Urea and 3 bags of NPK 15-15-15. This will maximize your cassava yield while staying within budget.', delay: 1000 },
    ]
  },
  {
    id: 'price-check',
    name: 'Market Price Check',
    description: 'Check current crop prices across regions',
    steps: [
      { type: 'user_message', content: 'What are the current maize prices?', delay: 0 },
      { type: 'tool_call', content: 'Fetching maize price data...', payload: { tool: 'get_reference_data', args: { category: 'maize-prices' } }, delay: 1000 },
      { type: 'tool_response', content: 'Retrieved maize prices for 5 regions.', payload: { data: [{ region: 'West', price: 400 }] }, delay: 1000 },
      { type: 'assistant_message', content: 'Current maize prices vary by region. In the West, it is approximately 400 NGN per unit.', delay: 1000 },
    ]
  }
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const addEvent = (type: MCPEvent['type'], message: string, payload?: any) => {
    setEvents(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      type,
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
    
    // Simulation of real MCP flow
    addEvent('thought', 'Analyzing user request...', {});
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('tool_call', 'Calling get_reference_data...', { category: 'countries' });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('tool_response', 'Received country list', { countries: ['NG', 'GH', 'KE'] });
    await new Promise(r => setTimeout(r, 1000));
    
    addEvent('synthesis', 'Formulating response...', {});
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
        addEvent('tool_call', step.content, step.payload);
      } else if (step.type === 'tool_response') {
        addEvent('tool_response', step.content, step.payload);
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
