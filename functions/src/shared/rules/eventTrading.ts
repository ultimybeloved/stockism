// GENERATED from src/rules/eventTrading.ts by `npm run sync:chars`. Do not edit.
// When a long-term market can trade. Shared rule module (see src/rules/ladder.ts
// for what that means): the market card and the server read the same answer.
//
// These markets have no end date, and a new chapter can answer one. So every
// market stops trading when the weekly halt begins and stays shut until the admin
// reopens it, otherwise a forgotten market sells its known winner at the reopen.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// A Thursday at 13:00 UTC, when the weekly halt begins.
const HALT_EPOCH = Date.UTC(2023, 11, 28, 13, 0);
// Markets from before this rule count as reopened today, so they trade until the
// first halt after it instead of all closing the moment it ships.
const RULE_START = Date.UTC(2026, 9, 31);

export interface EventTradingFields {
  /** The admin closed this one by hand. */
  tradingClosed?: boolean;
  /** Last time the admin reopened it. */
  reopenedAt?: number;
  opensAt?: number;
}

/** When the most recent weekly halt began. */
export const lastHaltStart = (now: number = Date.now()): number =>
  HALT_EPOCH + Math.floor((now - HALT_EPOCH) / WEEK_MS) * WEEK_MS;

/** True when this market can't trade: closed by hand, or not reopened since the last halt began. */
export const eventTradingClosed = (market: EventTradingFields, now: number = Date.now()): boolean =>
  !!market.tradingClosed || Math.max(market.reopenedAt || 0, market.opensAt || 0, RULE_START) < lastHaltStart(now);
