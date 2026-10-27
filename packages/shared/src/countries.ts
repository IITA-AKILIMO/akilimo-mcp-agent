// The countries AKILIMO gives recommendations for (GET /v1/countries). The chat asks for one first
// and uses it for the example questions and the assistant's instructions.
export interface Country {
  code: string; // ISO 2-letter
  name: string;
  city: string; // a well-known place, for weather and soil examples
  region: string; // a farming area, for the field example
  neighbours: [string, string]; // for the comparison examples
}

export const COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', city: 'Ibadan', region: 'near Ibadan', neighbours: ['Ghana', 'Tanzania'] },
  { code: 'TZ', name: 'Tanzania', city: 'Dar es Salaam', region: 'near Morogoro', neighbours: ['Rwanda', 'Nigeria'] },
  { code: 'RW', name: 'Rwanda', city: 'Kigali', region: 'in the Eastern Province', neighbours: ['Burundi', 'Tanzania'] },
  { code: 'GH', name: 'Ghana', city: 'Kumasi', region: 'near Kumasi', neighbours: ['Nigeria', 'Tanzania'] },
  { code: 'BI', name: 'Burundi', city: 'Bujumbura', region: 'near Bujumbura', neighbours: ['Rwanda', 'Tanzania'] },
];

export const findCountry = (code: string | null | undefined) => COUNTRIES.find(c => c.code === code);

export interface ExampleGroup { title: string; prompts: string[] }

// Questions that work with the AKILIMO tools alone
export const akilimoExamples = (c: Country): ExampleGroup[] => [
  {
    title: 'Fertilizer advice',
    prompts: [
      `I grow cassava in ${c.name}. Which fertilizer should I use?`,
      `I have a 2 acre cassava field ${c.region}. I plan to plant next month. What do you recommend?`,
      `Which fertilizer would give me the best profit on 1 acre of cassava in ${c.name}?`,
    ],
  },
  {
    title: 'Fertilizers and prices',
    prompts: [
      `Which fertilizers are available in ${c.name} and what do they cost?`,
      `What is the typical cassava price in ${c.name}?`,
      `How do cassava prices in ${c.name} compare with ${c.neighbours[0]}?`,
    ],
  },
];

// Only offered when a connected server has weather, soil or statistics tools
export const contextExamples = (c: Country): ExampleGroup => ({
  title: 'Weather, soil and country data',
  prompts: [
    `What is the rain forecast for the next week in ${c.city}?`,
    `How wet is the soil near ${c.city} right now?`,
    `What is the typical monthly rainfall in ${c.city}?`,
    `Compare cereal yields in ${c.name}, ${c.neighbours[0]} and ${c.neighbours[1]}.`,
  ],
});
