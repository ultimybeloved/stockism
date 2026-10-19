// Missions: the week clock and the maths every mission check shares. Shared rule
// module (see src/rules/ladder.ts for what that means): the missions screen and
// the server's claim checks read this one copy, so a progress bar can't say
// "done" while the server says no.

import { cohortLots, DIVIDEND_HOLD_MS, type HoldingCohort } from '../characters';
import { WEEKLY_CALL } from '../crews';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// ── The mission week ─────────────────────────────────────────────────────────
// A week runs from the Thursday reopen (21:00 UTC, the end of the chapter halt)
// to the next one. Until 2026-10-22 it ran Monday 00:00 to Monday 00:00. The
// halt hours belong to the week that is ending, so Thursday morning is the last
// chance to claim that week's weeklies.
export const MISSION_WEEK_WEEKDAY = 4; // Thursday (Date#getUTCDay)
export const MISSION_WEEK_START_MINUTE = 21 * 60; // 21:00 UTC

type When = number | Date;
const ms = (when: When) => (typeof when === 'number' ? when : when.getTime());

/** When the mission week containing `now` began (epoch ms). */
export const missionWeekStartMs = (now: When = Date.now()) => {
  const t = ms(now);
  const d = new Date(t);
  const todayAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + MISSION_WEEK_START_MINUTE * 60000;
  let start = todayAt - ((d.getUTCDay() - MISSION_WEEK_WEEKDAY + 7) % 7) * DAY_MS;
  if (start > t) start -= WEEK_MS;
  return start;
};

/** The week's id: the UTC date (YYYY-MM-DD) of the Thursday it started on. */
export const missionWeekId = (now: When = Date.now()) => new Date(missionWeekStartMs(now)).toISOString().slice(0, 10);

/** When a week id began. */
export const weekStartOfId = (weekId: string) => Date.parse(`${weekId}T21:00:00Z`);

/** When the week containing `now` ends (the next Thursday reopen). */
export const missionWeekEndMs = (now: When = Date.now()) => missionWeekStartMs(now) + WEEK_MS;

// The first week on this clock. The days before the 2026-10-22 reopen ran on
// Monday weeks, so the week id they get here ('2026-10-15') holds none of that
// week's claims: without this, a player could claim their weekly a second time
// between the deploy and the reopen.
export const FIRST_MISSION_WEEK_ID = '2026-10-22';
export const weeklyMissionsOpen = (weekId: string) => weekId >= FIRST_MISSION_WEEK_ID;

// Calls are made, and Buy and Hold buys count, from the Thursday reopen to the
// end of Saturday (Sunday 00:00 UTC).
export const CALL_PICK_WINDOW_MS = 2 * DAY_MS + 3 * 60 * 60 * 1000;
export const callPicksOpen = (now: When = Date.now()) => ms(now) < missionWeekStartMs(now) + CALL_PICK_WINDOW_MS;
export const callPicksCloseMs = (now: When = Date.now()) => missionWeekStartMs(now) + CALL_PICK_WINDOW_MS;

// Buy and Hold can be claimed from Wednesday 00:00 UTC to the end of the week.
export const BUY_HOLD_CLAIM_OFFSET_MS = 5 * DAY_MS + 3 * 60 * 60 * 1000;
export const buyHoldClaimOpensMs = (now: When = Date.now()) => missionWeekStartMs(now) + BUY_HOLD_CLAIM_OFFSET_MS;

// ── Real trades only ─────────────────────────────────────────────────────────
// A trade counts toward a mission only if it is worth at least 1% of the
// player's net worth, never less than $50 and never more than $500. Throwaway
// $3 trades used to complete most missions.
export const MISSION_MIN_TRADE_PCT = 0.01;
export const MISSION_MIN_TRADE_FLOOR = 50;
export const MISSION_MIN_TRADE_CAP = 500;
export const missionMinTrade = (netWorth: number) =>
  Math.min(
    MISSION_MIN_TRADE_CAP,
    Math.max(MISSION_MIN_TRADE_FLOOR, Math.round((Number.isFinite(netWorth) ? netWorth : 0) * MISSION_MIN_TRADE_PCT)),
  );

// Sells count only on shares held at least this long.
export const MISSION_HELD_SELL_MS = DAY_MS;

/**
 * Shares of a position held at least `minAgeMs`. A position with no lot ledger
 * predates it and is all old.
 */
export const sharesHeldAtLeast = (
  cohort: HoldingCohort | null | undefined,
  holding: number,
  now: number,
  minAgeMs = MISSION_HELD_SELL_MS,
) => {
  if (!cohort) return Math.max(0, holding);
  const old = cohortLots(cohort, now)
    .filter((l) => l.ageMs >= minAgeMs)
    .reduce((s, l) => s + l.shares, 0);
  return Math.min(Math.max(0, holding), old);
};

/**
 * Shares bought between `from` and `to` that are still held (lots are sold
 * oldest first). Free lots (the daily drop) were never bought.
 */
export const sharesBoughtBetweenStillHeld = (cohort: HoldingCohort | null | undefined, from: number, to: number) =>
  (cohort?.pending || [])
    .filter((l) => {
      const acquiredAt = (l.availableAt || 0) - DIVIDEND_HOLD_MS;
      return !l.free && (l.shares || 0) > 0 && acquiredAt >= from && acquiredAt < to;
    })
    .reduce((s, l) => s + (l.shares || 0), 0);

// ── Portfolio shape ──────────────────────────────────────────────────────────

/**
 * Share of the portfolio's stock value held in the crew, 0-100. By value, not
 * share count: counting shares let a pile of cheap crew stock pass for "most of
 * your portfolio" (Crew Majority until 2026-10-14).
 */
export const crewValuePercent = (
  holdings: Record<string, number> | null | undefined,
  prices: Record<string, number> | null | undefined,
  crewMembers: readonly string[],
) => {
  let total = 0;
  let crew = 0;
  for (const [t, s] of Object.entries(holdings || {})) {
    if (!(s > 0)) continue;
    const v = s * ((prices || {})[t] || 0);
    total += v;
    if (crewMembers.includes(t)) crew += v;
  }
  return total > 0 ? (crew / total) * 100 : 0;
};

export const DIVERSIFIED_MIN_STOCKS = 5;
export const DIVERSIFIED_MAX_SHARE = 40; // percent of stock value in any one stock

/** Positions worth at least `minValue`, and the biggest position's share of stock value (0-100). */
export const diversification = (
  holdings: Record<string, number> | null | undefined,
  prices: Record<string, number> | null | undefined,
  minValue: number,
) => {
  const values = Object.entries(holdings || {})
    .filter(([, s]) => s > 0)
    .map(([t, s]) => s * ((prices || {})[t] || 0));
  const total = values.reduce((a, b) => a + b, 0);
  return {
    positions: values.filter((v) => v >= minValue).length,
    biggestPct: total > 0 ? (Math.max(...values) / total) * 100 : 0,
  };
};

export interface GrowthWeek {
  startPortfolioValue?: number;
  startGrantedValue?: number;
  startMarginUsed?: number;
}

/**
 * This week's growth in percent, net of free money (grantedValue) and margin
 * debt at both ends, so check-ins, drops and borrowing aren't growth.
 * -Infinity when the week has no starting value yet.
 */
export const earnedGrowthPct = (
  wp: GrowthWeek,
  {
    portfolioValue = 0,
    grantedValue = 0,
    marginUsed = 0,
  }: { portfolioValue?: number; grantedValue?: number; marginUsed?: number },
) => {
  const startValue = (wp.startPortfolioValue || 0) - (wp.startMarginUsed || 0);
  if (startValue <= 0) return -Infinity;
  const grantedThisWeek = grantedValue - (wp.startGrantedValue ?? grantedValue);
  return ((portfolioValue - marginUsed - grantedThisWeek - startValue) / startValue) * 100;
};

// ── Calls ────────────────────────────────────────────────────────────────────
// A Call is scored on the chapter halt that ends its week: the price when the
// halt began against the price at the 20:55 lock, before the opening auction.
// Nobody can trade in that window, so no player can move their own Call.
export type CallDirection = 'up' | 'down';
export type CallResult = 'big' | 'win' | 'push' | 'loss' | 'break';

export const scoreCall = (direction: CallDirection, before: number, after: number): CallResult => {
  if (!(before > 0) || !(after > 0)) return 'push';
  const move = (after / before - 1) * (direction === 'up' ? 1 : -1);
  if (move >= WEEKLY_CALL.bigMove) return 'big';
  if (move >= WEEKLY_CALL.minMove) return 'win';
  if (move <= -WEEKLY_CALL.minMove) return 'loss';
  return 'push';
};

export const callReward = (result: CallResult | null | undefined) =>
  result === 'big'
    ? WEEKLY_CALL.bigReward
    : result === 'win'
      ? WEEKLY_CALL.reward
      : result === 'break'
        ? WEEKLY_CALL.breakReward
        : 0;

/** A chapter break: not one stock moved 1% between the halt lock and the result. */
export const isCallBreakWeek = (before: Record<string, number>, after: Record<string, number>) =>
  !Object.keys(before).some((t) => {
    const p0 = before[t] || 0;
    const p1 = after[t] || 0;
    return p0 > 0 && p1 > 0 && Math.abs(p1 / p0 - 1) >= WEEKLY_CALL.minMove;
  });
