/**
 * Marketplace-balancing model (MECHANICS.md §1). We identify the two largest
 * gender groups in a market as the two sides, then size slates so inbound
 * interest on the scarce side is capped while the abundant side gets fewer
 * options. Slate sizes float with the real local ratio, not a fixed multiplier.
 */
export interface MarketBalance {
  countsByGender: Record<string, number>;
  scarceGender: string | null;
  abundantGender: string | null;
  scarceCount: number;
  abundantCount: number;
  /** abundant / scarce, ≥ 1. */
  ratio: number;
}

export function computeBalance(genders: string[]): MarketBalance {
  const counts: Record<string, number> = {};
  for (const g of genders) counts[g] = (counts[g] ?? 0) + 1;

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const abundant = sorted[0];
  const scarce = sorted[1];

  if (!abundant || !scarce) {
    return {
      countsByGender: counts,
      scarceGender: null,
      abundantGender: null,
      scarceCount: abundant?.[1] ?? 0,
      abundantCount: abundant?.[1] ?? 0,
      ratio: 1,
    };
  }

  const ratio = scarce[1] === 0 ? 1 : abundant[1] / scarce[1];
  return {
    countsByGender: counts,
    abundantGender: abundant[0],
    scarceGender: scarce[0],
    abundantCount: abundant[1],
    scarceCount: scarce[1],
    ratio,
  };
}

/**
 * Target slate size for a user of `gender`, before capping by how many
 * candidates actually passed the filters (and by MAX_SLATE_SIZE in the engine). Scarce side
 * (and anyone outside the two main groups) gets up to `L`; the abundant side gets about `L / r`.
 */
export function targetSlateSize(gender: string, balance: MarketBalance, load: number): number {
  if (balance.abundantGender && gender === balance.abundantGender) {
    return Math.max(1, Math.round(load / balance.ratio));
  }
  return load;
}
