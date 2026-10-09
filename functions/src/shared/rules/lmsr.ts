// GENERATED from src/rules/lmsr.ts by `npm run sync:chars`. Do not edit.
// LMSR event-market pricing. Shared rule module (see src/rules/ladder.ts for
// what that means): the event-market prices players see are computed by the
// same code the server charges with.
//
// Logarithmic Market Scoring Rule for long-term event share markets.
// `q` = array of shares outstanding per outcome, `b` = liquidity parameter.
// Prices always sum to 1 and stay in (0,1); the house's max loss on a market is
// b * ln(q.length).

const lse = (xs: number[]): number => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
};

export const lmsrCost = (q: number[], b: number): number => b * lse(q.map((x) => x / b));

export const lmsrPrices = (q: number[], b: number): number[] => {
  const xs = q.map((x) => x / b);
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const sum = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / sum);
};

export const lmsrBuyCost = (q: number[], b: number, idx: number, shares: number): number => {
  const after = q.slice();
  after[idx] = after[idx]! + shares;
  return lmsrCost(after, b) - lmsrCost(q, b);
};

export const lmsrSellRefund = (q: number[], b: number, idx: number, shares: number): number => {
  const after = q.slice();
  after[idx] = after[idx]! - shares;
  return lmsrCost(q, b) - lmsrCost(after, b);
};

// Seed quantities that make a new market open at the given odds (percent per
// outcome, summing to 100). Used by the admin panel, which creates markets.
// Shifted so the smallest entry is 0: player holdings of outcome i equal
// q[i] - seed[i], so q can never fall below the seed and the sell-side zero
// clamp in functions/src/predictions/eventMarket.ts stays inert.
export const lmsrSeedQ = (pcts: number[], b: number): number[] => {
  const min = Math.min(...pcts);
  return pcts.map((p) => Math.round(b * Math.log(p / min) * 100) / 100);
};

// Largest whole number of shares whose LMSR buy cost stays within `budget`.
// Powers the "Max" button on long-term event markets (cost is non-linear, so we
// can't just divide). Exponential search for a bound, then binary search.
export const maxAffordableShares = (q: number[], b: number, idx: number, budget: number): number => {
  if (!(budget > 0)) return 0;
  let hi = 1;
  while (hi < 1e7 && lmsrBuyCost(q, b, idx, hi) <= budget) hi *= 2;
  let lo = Math.floor(hi / 2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lmsrBuyCost(q, b, idx, mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
