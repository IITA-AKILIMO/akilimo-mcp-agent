// Turns the fertilizer rates of a recommendation into what a farmer buys: bags and money.
// The compute service answers in kilograms for the whole field (its own report rounds bags to the
// nearest half bag, `round_bags` in akilimo-recommendations R/markdown.R), so the same rounding is
// used here. Shared by the server's fertilizer_plan tool and the web UI, which plans from the request
// it just sent and so also works on a saved session.

export interface FertilizerRate { type: string; rate: number }

export interface PlanFertilizer {
  type: string; // e.g. UREA, NPK_15_15_15 (the compute service's fertilizer type)
  name?: string;
  key?: string;
  bagWeightKg: number;
  pricePerBag: number | null;
}

export interface PlanLine {
  type: string;
  name: string | null;
  key: string | null;
  rate_kg: number; // kilograms for the whole field, as the compute service returns it
  bag_weight_kg: number;
  bags_exact: number;
  bags: number; // rounded to the nearest half bag
  price_per_bag: number | null;
  cost: number | null; // exact kilograms at the price per bag
}

export interface FertilizerPlan {
  lines: PlanLine[];
  total_cost: number | null; // null when a price is missing for any line
  unmatched: string[]; // rate types with no fertilizer of that type (so no bag weight)
}

// Nearest whole or half bag: under a quarter rounds down, over three quarters up, else a half bag
export const roundBags = (raw: number) => {
  const frac = raw - Math.floor(raw);
  return Math.trunc(raw) + (frac >= 0.25 && frac <= 0.75 ? 0.5 : frac < 0.25 ? 0 : 1);
};

export function planBags(rates: FertilizerRate[], fertilizers: PlanFertilizer[]): FertilizerPlan {
  const lines: PlanLine[] = [];
  const unmatched: string[] = [];

  for (const { type, rate } of rates) {
    const fertilizer = fertilizers.find(f => f.type.toLowerCase() === type.toLowerCase());
    if (!fertilizer || !(fertilizer.bagWeightKg > 0)) {
      unmatched.push(type);
      continue;
    }
    const exact = rate / fertilizer.bagWeightKg;
    const price = fertilizer.pricePerBag;
    lines.push({
      type,
      name: fertilizer.name ?? null,
      key: fertilizer.key ?? null,
      rate_kg: Math.round(rate),
      bag_weight_kg: fertilizer.bagWeightKg,
      bags_exact: Math.round(exact * 100) / 100,
      bags: roundBags(exact),
      price_per_bag: price,
      cost: price === null ? null : Math.round(exact * price),
    });
  }

  const total = lines.length > 0 && lines.every(l => l.cost !== null) ? lines.reduce((sum, l) => sum + (l.cost ?? 0), 0) : null;
  return { lines, total_cost: total, unmatched };
}
