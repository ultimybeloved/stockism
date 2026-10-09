// Price impact: how far an order moves a stock and what the trader pays for it.
// Shared rule module (see src/rules/ladder.ts for what that means). Every fill
// lane on the server and every trade preview on the site run this one copy, so
// a preview can no longer quote a different price from the one charged.
// If you change the formula, run `npm test` and `npm run test:trading`.

import { splitFactorOf } from '../characters';

export const BASE_IMPACT = 0.012; // ~1.2% price move per sqrt(liquidity) shares
export const BASE_LIQUIDITY = 100; // shares it takes to move a stock (higher = harder to move)
export const MAX_PRICE_CHANGE_PERCENT = 0.05; // one order moves the market at most 5%
// An oversized order pays its real marginal cost, bounded at this multiple of
// the market cap: at 2 a dump costs at most 10% however big it is, so the
// penalty is bounded and predictable. Below the cap the market move and the
// trader charge are the identical number.
export const OVERSIZED_IMPACT_MULTIPLE = 2;
// Hard ceiling on any single order, every action. The server rejects anything
// above it outright, so the Max button has to know about it too.
export const MAX_TRADE_SHARES = 10000; // before splitFactor
export const MIN_PRICE = 0.01; // no stock trades below a cent
export const BID_ASK_SPREAD = 0.002; // 0.2% spread
export const ETF_BID_ASK_SPREAD = 0.001; // 0.1% spread for ETFs (diversified = lower risk)

// Anti-manipulation: brand-new accounts move the market less, ramping from
// NEW_ACCOUNT_MIN_IMPACT_FACTOR at day 0 to full (1.0) at the end of the period.
export const NEW_ACCOUNT_IMPACT_PERIOD_DAYS = 3;
export const NEW_ACCOUNT_MIN_IMPACT_FACTOR = 0.1;

/**
 * The uncapped marginal cost of `newShares` on top of the shares this player
 * already moved in the rolling window (impact is a square-root curve, so the
 * thousandth share costs more than the first).
 *
 * Kept separate because the market and the trader are told two different
 * numbers. The MARKET move stays capped at MAX_PRICE_CHANGE_PERCENT so one order
 * can never crater a stock; the TRADER pays this, bounded by
 * OVERSIZED_IMPACT_MULTIPLE. Without the split the cap was a volume discount on
 * the most disruptive action in the game: dumping everything at once was
 * cheaper than easing it out in pieces.
 */
export const rawMarginalImpact = (
  currentPrice: number,
  newShares: number,
  cumulativeSharesBefore: number,
  liquidity: number = BASE_LIQUIDITY,
) =>
  currentPrice *
  BASE_IMPACT *
  (Math.sqrt((cumulativeSharesBefore + newShares) / liquidity) - Math.sqrt(cumulativeSharesBefore / liquidity));

/** What the MARKET moves, in dollars: what goes on the chart and what the daily allowance counts. */
export const calculateMarginalImpact = (
  currentPrice: number,
  newShares: number,
  cumulativeSharesBefore: number,
  liquidity: number = BASE_LIQUIDITY,
) =>
  Math.min(
    rawMarginalImpact(currentPrice, newShares, cumulativeSharesBefore, liquidity),
    currentPrice * MAX_PRICE_CHANGE_PERCENT,
  );

/** What the TRADER pays, in dollars: bounded well above the market cap. */
export const traderMarginalImpact = (
  currentPrice: number,
  newShares: number,
  cumulativeSharesBefore: number,
  liquidity: number = BASE_LIQUIDITY,
) =>
  Math.min(
    rawMarginalImpact(currentPrice, newShares, cumulativeSharesBefore, liquidity),
    currentPrice * MAX_PRICE_CHANGE_PERCENT * OVERSIZED_IMPACT_MULTIPLE,
  );

/**
 * A stock's liquidity: BASE_LIQUIDITY times its splitFactor (see
 * characters.ts), so the same dollar trade moves a split stock by the same
 * percent as before the split.
 */
export const liquidityFor = (ticker: string): number => BASE_LIQUIDITY * splitFactorOf(ticker);

/** The largest single order: MAX_TRADE_SHARES x splitFactor, so a split never changes how many orders a position takes. */
export const maxTradeSharesFor = (ticker: string | null | undefined): number =>
  MAX_TRADE_SHARES * splitFactorOf(ticker);

/** The new-account impact multiplier from account age in days. null (age unknown) means full impact. */
export const accountAgeImpactFactor = (ageDays: number | null): number => {
  if (ageDays === null) return 1;
  if (ageDays >= NEW_ACCOUNT_IMPACT_PERIOD_DAYS) return 1;
  return (
    NEW_ACCOUNT_MIN_IMPACT_FACTOR + (1 - NEW_ACCOUNT_MIN_IMPACT_FACTOR) * (ageDays / NEW_ACCOUNT_IMPACT_PERIOD_DAYS)
  );
};
