// A player can't be long and short the same stock (Darth YG, 2026-10-31). It has
// no honest use: the price risk cancels out while dividends keep paying. Every
// path that opens a position calls this. Dividends also pay on the net long, so
// shares that arrive some other way (drops, positions from before this rule)
// can't earn while hedged. INTERNAL MODULE.
import { MIN_TRADE_SHARES } from './constants';

interface PositionFields {
  holdings?: Record<string, number> | null;
  shorts?: Record<string, { shares?: number } | null | undefined> | null;
}

/** Why this action is refused, or null. Slivers too small to sell don't count. */
export const oppositePositionError = (userData: PositionFields, ticker: string, action: string): string | null => {
  if (action === 'buy' && (userData.shorts?.[ticker]?.shares || 0) > 0) {
    return `You're short $${ticker}. Cover your short before buying.`;
  }
  if (action === 'short' && (userData.holdings?.[ticker] || 0) >= MIN_TRADE_SHARES) {
    return `You own $${ticker}. Sell your shares before shorting.`;
  }
  return null;
};
