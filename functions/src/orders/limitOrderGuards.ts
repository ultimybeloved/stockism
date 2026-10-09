// Screening for the limit-order sweep. INTERNAL MODULE — not exported through
// functions/src/index.js, same pattern as tradeGuards.
//
// Two rounds of checks, and the split between them is deliberate:
//   - the screen* functions run BEFORE the transaction, on the cheap snapshot
//     read, and decide whether an order is even worth attempting
//   - the assert*/resolve* functions run INSIDE the transaction on fresh data
//     and throw, because anything they catch changed between the two reads
//
// A thrown message is matched against CANCEL_ON in limitOrderMatching to decide
// cancel-vs-defer, so the wording of these throws is load-bearing.

import { CHARACTER_MAP } from '../shared/characters';
import { lockedShares, floorExitShares } from '../shared/cohorts';
import { pruneAndSumTradeHistory, isTickerPaused, washRuleRemainingMs } from '../shared/impact';
import type { ActionHistory } from '../shared/impact';
import type { LimitOrder, UserData } from '../shared/types';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

/** What a screen decides to write instead of filling. */
type Screened = { status: string; reason?: string; log?: string } | null;
import {
  MAX_TRADES_PER_TICKER_24H,
  MIN_TRADE_SHARES,
  MIN_EXIT_SHARES,
  TRADE_SHARE_DECIMALS,
} from '../shared/constants';

const ENTRY_SHARE_STEP = 10 ** TRADE_SHARE_DECIMALS;

// ============================================
// BEFORE THE TRANSACTION
// ============================================

/**
 * Order-level screening that needs no user or price data.
 * Returns { status, reason, log } to write, or null to keep going.
 */
export const screenOrder = (
  order: LimitOrder,
  { now, launchedTickers }: { now: number; launchedTickers: string[] },
): Screened => {
  if (order.type === 'SHORT' || order.type === 'COVER') {
    return { status: 'CANCELED', reason: 'SHORT/COVER limit orders not supported' };
  }
  // Orders on unlaunched IPO tickers would bypass the IPO's per-user and
  // supply limits entirely.
  if (CHARACTER_MAP[order.ticker]?.ipoRequired && !launchedTickers.includes(order.ticker)) {
    return { status: 'CANCELED', reason: 'Stock is still in IPO phase' };
  }
  if (order.expiresAt && now > order.expiresAt) {
    return { status: 'EXPIRED' };
  }
  return null;
};

/**
 * User-level screening. These states can all be entered AFTER an order was
 * placed, and until 2026 an order already on the book kept filling through
 * them — a ban left the queued lane open.
 * Returns { status, reason, log } to write, or null to keep going.
 */
export const screenUser = (userData: UserData): Screened => {
  if (userData.isBanned) {
    return { status: 'CANCELED', reason: 'Account is banned', log: 'account banned' };
  }
  if (userData.isBankrupt || (userData.cash || 0) < 0) {
    return { status: 'CANCELED', reason: 'User bankrupt or in debt', log: 'user bankrupt/in debt' };
  }
  if (userData.requiresDiscordLink && !userData.discordId) {
    return { status: 'CANCELED', reason: 'Discord verification required', log: 'Discord verification required' };
  }
  return null;
};

/** Circuit breaker: a ticker halt suspends fills until resumeAt. */
export const isTickerHalted = (
  haltedTickersMap: Record<string, { resumeAt?: number } | undefined> | null | undefined,
  ticker: string,
) => isTickerPaused(haltedTickersMap, ticker);

/**
 * Has the trigger price been crossed? This checks the MID price; execution
 * later re-checks the ask/bid the user actually gets, which is a stricter test.
 */
export const triggerMet = (order: LimitOrder, price: number) => {
  // An order with no limit price never triggers (comparing with undefined was false).
  const limit = order.limitPrice ?? NaN;
  if (order.type === 'BUY') return price <= limit;
  if (order.type === 'SELL') return price >= limit;
  if (order.type === 'STOP_LOSS') return price <= limit;
  return false;
};

// ============================================
// INSIDE THE TRANSACTION
// ============================================

/**
 * Re-read of the order itself. The client cancels by writing the doc directly,
 * so a blind FILLED write here would overwrite that cancel (or double-fill on
 * overlapping runs) and execute a trade the user no longer wants.
 * Returns the shares still to fill.
 */
export const assertOrderStillActive = (freshOrderSnap: DocumentSnapshot, totalShares: number) => {
  if (!freshOrderSnap.exists) throw new Error('Order no longer exists');
  const freshOrder = freshOrderSnap.data() as LimitOrder;
  if (!['PENDING', 'PARTIALLY_FILLED'].includes(freshOrder.status as string)) {
    throw new Error('Order no longer active');
  }
  const freshFilled = freshOrder.filledShares || 0;
  const fillShares = totalShares - freshFilled;
  if (fillShares <= 0) throw new Error('Order no longer active');
  return { freshFilled, fillShares };
};

/** The same user states screenUser covers, re-checked against fresh data. */
export const assertUserEligible = (userData: UserData) => {
  if (userData.isBanned) throw new Error('Account is banned');
  if (userData.isBankrupt || (userData.cash || 0) < 0) throw new Error('User is bankrupt or in debt');
  if (userData.requiresDiscordLink && !userData.discordId) throw new Error('Discord verification required');
};

/**
 * Wash rule, same gate executeTrade applies: a player who has pushed this
 * ticker down today cannot buy it back yet, through any lane. A limit BUY that
 * lands inside the window DEFERS rather than cancels — the order is still
 * perfectly valid, it just cannot fill yet, so the wording here must stay out
 * of CANCEL_ON in limitOrderMatching.
 */
export const assertWashRule = (userData: UserData, ticker: string, action: string, now = Date.now()) => {
  if (action !== 'buy') return;
  if (washRuleRemainingMs(userData, ticker, now) > 0) {
    throw new Error('Wash rule cooldown active on this ticker');
  }
};

/** The trigger, re-checked against the fresh price. */
export const assertLimitStillMet = (order: LimitOrder, freshPrice: number) => {
  if (!triggerMet(order, freshPrice)) {
    throw new Error('Price no longer meets limit condition');
  }
};

/** 10 fills per action per ticker per 24h, same ceiling executeTrade enforces. */
export const assertTradeLimit = (tradeCount: number, action: string, ticker: string) => {
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
    throw new Error(`Trade limit reached: ${MAX_TRADES_PER_TICKER_24H} ${action}s on ${ticker} in 24h`);
  }
};

/**
 * How many shares can actually be filled, given cash (BUY) or unlocked shares
 * (SELL). Clamps to a partial fill when the order allows one, throws otherwise.
 *
 * Locks are re-checked here rather than only at creation: shares locked AFTER
 * the order was placed (e.g. a margin buy on the same ticker) must not be
 * sellable through a fill or a partial clamp.
 */
export const resolveFillShares = ({
  effectiveType,
  order,
  userData,
  freshPrice,
  fillShares,
}: {
  effectiveType: string;
  order: LimitOrder;
  userData: UserData;
  freshPrice: number;
  fillShares: number;
}): number => {
  if (effectiveType === 'BUY') {
    const totalCost = freshPrice * fillShares;
    const cash = userData.cash as number;
    if (cash >= totalCost) return fillShares;
    if (!order.allowPartialFills) throw new Error('Insufficient cash');
    // Whole-cent share counts, same grid every other buy path uses. This used
    // to floor to WHOLE shares, so $15 of cash against a $10 stock filled 1
    // share and left $5 of buying power on the table.
    const affordableShares = freshPrice > 0 ? Math.floor((cash / freshPrice) * ENTRY_SHARE_STEP) / ENTRY_SHARE_STEP : 0;
    if (affordableShares < MIN_TRADE_SHARES) throw new Error('Insufficient cash');
    logger.info(`Partial fill: can only afford ${affordableShares} shares`);
    return affordableShares;
  }

  if (effectiveType === 'SELL') {
    const userShares = userData.holdings?.[order.ticker] || 0;
    const lockedNow = lockedShares(userData, order.ticker).total;
    // Six decimals, not four: a dust position has to stay sellable in full.
    const sellableShares = Math.max(0, floorExitShares(userShares - lockedNow));
    if (sellableShares >= fillShares) return fillShares;
    if (order.allowPartialFills && sellableShares >= MIN_EXIT_SHARES) {
      logger.info(`Partial fill: only ${sellableShares} sellable shares (${lockedNow} locked)`);
      return sellableShares;
    }
    if (userShares >= fillShares) {
      // Enough shares, but some are locked — defer, don't cancel; locks expire
      // well within the order's 30-day lifetime.
      throw new Error('Shares locked (IPO or margin hold)');
    }
    throw new Error('Insufficient shares');
  }

  return fillShares;
};

/** 24h cumulative volume and fill count for one action on one ticker. */
export const readActionHistory = (
  tickerTradeHistory: Record<string, ActionHistory | undefined>,
  ticker: string,
  action: string,
  now: number,
) => pruneAndSumTradeHistory(tickerTradeHistory[ticker]?.[action] || [], now);
