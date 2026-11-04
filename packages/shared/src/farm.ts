import { z } from 'zod/v4';

// What the forms remember about a farmer's field in one country, so it need not be typed again: where the field is, its size,
// the yield class, the risk attitude, the cassava price and where it is sold, the date windows and the fertilizers they can
// buy with their prices. Dates are not kept (they change every season), and nothing here is a key or a credential.
// Saved per account on the server, or in the browser for a guest.
export const FarmProfileSchema = z.object({
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  size: z.number().positive().max(10_000_000).optional(),
  unit: z.enum(['acre', 'ha', 'm2', 'are']).optional(),
  yieldClass: z.number().min(0).max(100).optional(),
  risk: z.number().int().min(0).max(2).optional(),
  cassavaPrice: z.number().min(0).max(1_000_000_000).optional(),
  sellUnit: z.number().positive().max(100_000).optional(), // kg of the unit the cassava price is quoted in
  factory: z.string().max(100).optional(), // starch factory key; empty or missing = the open market
  plantingWindow: z.number().int().min(0).max(12).optional(),
  harvestWindow: z.number().int().min(0).max(12).optional(),
  fertilizers: z.record(z.string().max(80), z.object({ selected: z.boolean(), price: z.number().min(0).max(1_000_000_000).optional() })).optional(),
}).strict();

export type FarmProfile = z.infer<typeof FarmProfileSchema>;
