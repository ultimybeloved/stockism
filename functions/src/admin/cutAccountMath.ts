// What cutting an account down to a target net worth does to its user doc.
// INTERNAL MODULE, pure (cutAccountMath.test.ts). adminEnforcement.ts runs it.
//
// Everything shrinks by one factor: every holding (with its loyalty lots and
// lockups), the margin debt and the cash. Nothing is sold, so no price moves,
// and leverage stays exactly what it was, so no margin call fires. Long-term
// market positions are left alone but count toward the target. Accounts with
// open shorts are refused: shrinking collateral and position together would
// need the short engine's own rules.

const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

interface Lot {
  shares?: number;
  [k: string]: unknown;
}
export interface CutUser {
  cash?: number;
  marginUsed?: number;
  eventPositionsValue?: number;
  holdings?: Record<string, number>;
  holdingCohorts?: Record<string, { eligible?: number; pending?: Lot[]; [k: string]: unknown } | null>;
  ipoLockup?: Record<string, Lot | null>;
  marginLockup?: Record<string, Lot | null>;
  shorts?: Record<string, { shares?: number } | null>;
}

export interface CutPlan {
  factor: number;
  updates: Record<string, unknown>;
  before: number;
  after: number;
  cash: number;
  newCash: number;
  stocks: number;
  newStocks: number;
  debt: number;
  newDebt: number;
  event: number;
  /** 0-100, one decimal. */
  dropPercent: number;
}

const stockValue = (h: Record<string, number>, prices: Record<string, number>) =>
  Object.entries(h).reduce((s, [t, n]) => s + (n > 0 ? (prices[t] || 0) * n : 0), 0);

/** The cut, or null when the account is already at or under the target. Throws on a refusal. */
export function planAccountCut(u: CutUser, prices: Record<string, number>, target: number): CutPlan | null {
  if (!(target > 0)) throw new Error('Pick a target above $0.');
  if (Object.values(u.shorts || {}).some((s) => s && (s.shares || 0) > 0)) {
    throw new Error('This player has open shorts. Close them first.');
  }
  const cash = u.cash || 0;
  const debt = u.marginUsed || 0;
  const event = Math.max(0, u.eventPositionsValue || 0);
  const stocks = stockValue(u.holdings || {}, prices);
  const trading = cash + stocks - debt;
  const before = trading + event;
  if (before <= target) return null;
  const factor = (target - event) / trading;
  if (!(factor > 0 && factor < 1)) {
    throw new Error('Their long-term market positions alone are worth more than the target.');
  }

  const updates: Record<string, unknown> = {};
  const holdings: Record<string, number> = {};
  for (const [t, n] of Object.entries(u.holdings || {})) holdings[t] = typeof n === 'number' ? r6(n * factor) : n;
  updates.holdings = holdings;
  for (const [t, c] of Object.entries(u.holdingCohorts || {})) {
    if (!c) continue;
    updates[`holdingCohorts.${t}`] = {
      ...c,
      eligible: r6((c.eligible || 0) * factor),
      pending: (c.pending || []).map((lot) => ({ ...lot, shares: r6((lot.shares || 0) * factor) })),
    };
  }
  for (const lock of ['ipoLockup', 'marginLockup'] as const) {
    for (const [t, l] of Object.entries(u[lock] || {})) {
      if (l && typeof l.shares === 'number') updates[`${lock}.${t}`] = { ...l, shares: r6(l.shares * factor) };
    }
  }
  const newCash = r2(cash * factor);
  const newStocks = stockValue(holdings, prices);
  const newDebt = debt * factor;
  updates.cash = newCash;
  updates.marginUsed = newDebt;
  updates.portfolioValue = r2(newCash + newStocks);
  const after = newCash + newStocks - newDebt + event;
  return {
    factor,
    updates,
    before: r2(before),
    after: r2(after),
    cash: r2(cash),
    newCash,
    stocks: r2(stocks),
    newStocks: r2(newStocks),
    debt: r2(debt),
    newDebt: r2(newDebt),
    event: r2(event),
    dropPercent: Math.round((1 - after / before) * 1000) / 10,
  };
}
