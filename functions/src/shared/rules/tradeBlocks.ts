// GENERATED from src/rules/tradeBlocks.ts by `npm run sync:chars`. Do not edit.
// Trade blocks with a clock on them: the wash rule, no shorting right after a
// dump, and the short cooldown. Shared rule module (see src/rules/ladder.ts for
// what that means): the trade window counts down the same time the server
// enforces (functions/src/trading/tradeGuards, tradeActions), so a player sees
// the block before pressing the button, not after.

import { MAX_SHORTS_BEFORE_COOLDOWN } from './economy';

const HOUR_MS = 60 * 60 * 1000;

// Why the wash rule exists, and its 4% trigger: functions/src/shared/constants/market.ts.
export const WASH_RULE_COOLDOWN_MS = 48 * HOUR_MS; // no buying it back for 48h
// The other half of the raid: sell hard, then short the crash you just caused.
// Armed only by a heavy SELL (lastHeavyExit), not a short, so someone running a
// short is never stopped adding to it by this. Same 48h.
export const SHORT_AFTER_DUMP_COOLDOWN_MS = 48 * HOUR_MS;
// After MAX_SHORTS_BEFORE_COOLDOWN shorts on one ticker inside this rolling
// window, further shorts must wait for the oldest one to age out.
export const SHORT_COOLDOWN_WINDOW_MS = 8 * HOUR_MS;

/** A stored trade time: epoch ms, or a Firestore Timestamp (server or client SDK). */
type Stamp = number | { toMillis: () => number } | null | undefined;
const stampMs = (s: Stamp) => (!s ? 0 : typeof s === 'number' ? s : s.toMillis());

/** The parts of the user doc these blocks read. */
export interface BlockState {
  lastHeavySell?: Record<string, Stamp> | null;
  lastHeavyExit?: Record<string, Stamp> | null;
  shortHistory?: Record<string, number[]> | null;
}

/**
 * Has this player's own downward pressure on this ticker armed the wash rule?
 *
 * `lastHeavySell[ticker]` is stamped by the sell or short that took their 24h
 * down-impact past WASH_RULE_IMPACT_TRIGGER (see tradeState). While it is armed
 * they cannot BUY that ticker back — covering is an exit and is never blocked.
 *
 * One definition because there are three lanes that have to agree on it:
 * executeTrade, the limit-order sweep, and the pre-market auction.
 *
 * @returns ms remaining on the cooldown, or 0 when not armed
 */
export const washRuleRemainingMs = (user: BlockState | null | undefined, ticker: string, now = Date.now()) => {
  const armedMs = stampMs(user?.lastHeavySell?.[ticker]);
  if (!armedMs) return 0;
  return Math.max(0, WASH_RULE_COOLDOWN_MS - (now - armedMs));
};

/**
 * Has this player just dumped this ticker, so they can't short it yet?
 *
 * `lastHeavyExit[ticker]` is stamped only by a SELL that took their 24h
 * down-impact past WASH_RULE_IMPACT_TRIGGER (see tradeState), or by the
 * coordination scan for everyone in a tight downward cluster. Selling hard and
 * then shorting the crash you caused was the second half of the $SHNG raid.
 * Covering is never blocked.
 *
 * @returns ms remaining, or 0 when not armed
 */
export const shortAfterDumpRemainingMs = (user: BlockState | null | undefined, ticker: string, now = Date.now()) => {
  const armedMs = stampMs(user?.lastHeavyExit?.[ticker]);
  if (!armedMs) return 0;
  return Math.max(0, SHORT_AFTER_DUMP_COOLDOWN_MS - (now - armedMs));
};

/** ms until this player can short this ticker again under the short cooldown, 0 if they can now. */
export const shortCooldownRemainingMs = (user: BlockState | null | undefined, ticker: string, now = Date.now()) => {
  const recent = (user?.shortHistory?.[ticker] || []).filter((ts) => now - ts < SHORT_COOLDOWN_WINDOW_MS);
  if (recent.length < MAX_SHORTS_BEFORE_COOLDOWN) return 0;
  return Math.max(0, Math.min(...recent) + SHORT_COOLDOWN_WINDOW_MS - now);
};

/** "5h 12m" or "40m": what's left on a block. */
export const blockTimeLeft = (ms: number) => {
  const hrs = Math.floor(ms / HOUR_MS);
  const mins = Math.ceil((ms % HOUR_MS) / 60000);
  return `${hrs > 0 ? `${hrs}h ` : ''}${mins}m`;
};
