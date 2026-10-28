// One finished step of guided mode, as it is saved in the conversation history and shown again when
// a saved session is opened. The request and result are exactly what the AKILIMO tool received and
// returned, so the step can be displayed later without calling anything.
// price, fertilizers and recommend (fertilizer advice) as before; practices = planting practices (PP),
// schedule = scheduled planting and harvest (SP), intercrop = intercropping (IC)
// market = where to sell (open market or starch factories)
export type GuidedAction = 'price' | 'fertilizers' | 'recommend' | 'practices' | 'schedule' | 'intercrop' | 'market';
const ACTIONS: readonly string[] = ['price', 'fertilizers', 'recommend', 'practices', 'schedule', 'intercrop', 'market'];

export interface GuidedEntry {
  action: GuidedAction;
  country: string; // ISO 2-letter code
  title: string; // one line for the history list, e.g. "Cassava price in Rwanda"
  tool: string; // the MCP tool that produced the result
  request: unknown;
  result: unknown;
}

export const isGuidedEntry = (value: unknown): value is GuidedEntry => {
  const v = value as Partial<GuidedEntry> | null;
  return !!v && typeof v === 'object'
    && typeof v.action === 'string' && ACTIONS.includes(v.action)
    && typeof v.country === 'string' && typeof v.title === 'string' && typeof v.tool === 'string';
};
