// LMSR event-market pricing.

// ── LMSR event-market pricing ────────────────────────────────────────────────
// Logarithmic Market Scoring Rule for long-term event share markets.
// `q` = array of shares outstanding per outcome, `b` = liquidity parameter.
// Prices always sum to 1 and stay in (0,1); the house's max loss on a market is
// b * ln(q.length). Mirror of src/utils/calculations.ts — keep both in sync.
const _lse = (xs: number[]): number => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
};

export const lmsrCost = (q: number[], b: number): number => b * _lse(q.map((x) => x / b));

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
