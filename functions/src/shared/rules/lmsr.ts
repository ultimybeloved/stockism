// GENERATED from src/rules/lmsr.ts by `npm run sync:chars`. Do not edit.
// LMSR event-market pricing. Shared rule module (see src/rules/ladder.ts for
// what that means): the event-market prices players see are computed by the
// same code the server charges with.
//
// Logarithmic Market Scoring Rule for long-term event share markets.
// `q` = array of shares outstanding per outcome, `b` = liquidity parameter.
// Prices always sum to 1 and stay in (0,1); the house's max loss on a market is
// b * ln(q.length).

import { EVENT_AMM_LIQUIDITY } from './economy';

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

/** A long-term market as stored in predictions/current.list, the fields read here. */
export interface EventMarketRef {
  id: string;
  type?: string;
  outcomes?: string[];
  q?: number[];
  b?: number;
  resolved?: boolean;
  cancelled?: boolean;
  outcome?: string | null;
}

/** users/{uid}.eventPositions[marketId], the fields read here. */
export interface EventPositionRef {
  shares?: Record<string, number>;
  costBasis?: number;
  settled?: boolean;
}

/**
 * What a player's open long-term positions are worth right now: what selling
 * every share back to the market maker would pay, outcome after outcome, so a
 * big position is valued at what it would really fetch rather than the quoted
 * price. A resolved but not yet settled market is worth its payout ($1 a
 * winning share), a cancelled one its refund (what was put in).
 *
 * Counted in net worth since 2026-10-14. Before, money in a long-term market
 * vanished from the player's rank until the market resolved, which could be
 * never. The sell-back price can't be pumped by buying more of your own side:
 * buying raises the price, but selling it all back walks it straight down again.
 */
export const eventPositionsValue = (
  positions: Record<string, EventPositionRef | null | undefined> | null | undefined,
  markets: readonly EventMarketRef[] | null | undefined,
): number => {
  const byId = new Map((markets || []).filter((m) => m.type === 'event').map((m) => [m.id, m]));
  let total = 0;
  for (const [id, pos] of Object.entries(positions || {})) {
    if (!pos || pos.settled) continue;
    const market = byId.get(id);
    if (!market) continue;
    const shares = pos.shares || {};
    if (market.cancelled) {
      total += Math.max(0, pos.costBasis || 0);
      continue;
    }
    if (market.resolved) {
      total += market.outcome ? Math.max(0, shares[market.outcome] || 0) : 0;
      continue;
    }
    const outcomes = market.outcomes || [];
    if (!Array.isArray(market.q) || market.q.length !== outcomes.length) continue;
    const b = market.b || EVENT_AMM_LIQUIDITY;
    const q = market.q.slice();
    outcomes.forEach((o, i) => {
      const held = Math.min(shares[o] || 0, q[i]!);
      if (held <= 0) return;
      total += lmsrSellRefund(q, b, i, held);
      q[i] = q[i]! - held;
    });
  }
  // Down to the cent, like a real sell-back refund.
  return Math.floor((total + 1e-9) * 100) / 100;
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
