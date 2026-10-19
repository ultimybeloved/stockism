// GENERATED from src/rules/missionProgress.ts by `npm run sync:chars`. Do not edit.
// Mission progress: whether each mission is done, and how far along it is.
// Shared rule module: the missions screen draws its bars from this and the
// server's claim check (functions/src/missions/missionChecks.ts) asks the same
// functions, so the two can't disagree.
//
// What the trades write (functions/src/shared/tradeRecords.ts) is raw: what was
// bought today, for how much, at what low price. Whether that still counts
// (big enough for your net worth, shares still held) is judged here, at claim
// time.

import type { HoldingCohort } from '../characters';
import { CREWS, RIVALRY, type Mission } from '../crews';
import {
  missionMinTrade,
  sharesBoughtBetweenStillHeld,
  crewValuePercent,
  diversification,
  earnedGrowthPct,
  callReward,
  missionWeekStartMs,
  missionWeekId,
  weeklyMissionsOpen,
  buyHoldClaimOpensMs,
  CALL_PICK_WINDOW_MS,
  DIVERSIFIED_MAX_SHARE,
  type GrowthWeek,
  type CallDirection,
  type CallResult,
} from './missions';

// Buys below this price count for Underdog Investor.
export const UNDERDOG_PRICE_THRESHOLD = 20;

/** What a player bought of one stock today. `low` is the lowest market price paid. */
export interface DailyBuy {
  shares?: number;
  value?: number;
  low?: number;
}

/** users/{uid}.dailyMissions[date]. */
export interface DailyProgress {
  buys?: Record<string, DailyBuy>;
  limitBuys?: Record<string, DailyBuy>;
  /** Value sold today out of shares held a day or more. */
  heldSoldValue?: number;
  /** The part of heldSoldValue sold below cost. */
  heldLossValue?: number;
  /** The part of heldSoldValue sold by a limit order. */
  limitSoldValue?: number;
  checkedIn?: boolean;
  claimed?: Record<string, boolean>;
}

export interface WeeklyCall {
  ticker: string;
  direction: CallDirection;
  at: number;
  /** Set when the halt scores it. */
  result?: CallResult;
  before?: number;
  after?: number;
  paid?: number;
}

/** users/{uid}.weeklyMissions[weekId]. */
export interface WeeklyProgress extends GrowthWeek {
  tradeCount?: number;
  /** UTC dates with a trade big enough to count. */
  tradingDays?: Record<string, boolean>;
  checkinDays?: Record<string, boolean>;
  call?: WeeklyCall;
  /** Missions finished this week while in `crew` (Rivalries). */
  rivalry?: { crew: string; count: number };
  rivalryPaid?: boolean;
  rerolled?: boolean;
  rerollSeed?: number;
  claimed?: Record<string, boolean>;
}

/** The parts of the user doc mission progress reads. */
export interface MissionPlayer {
  crew?: string | null;
  holdings?: Record<string, number>;
  holdingCohorts?: Record<string, HoldingCohort>;
  portfolioValue?: number;
  marginUsed?: number;
  grantedValue?: number;
}

export interface MissionContext {
  player: MissionPlayer;
  prices: Record<string, number>;
  /** Prices at the Thursday reopen (market/current.weekOpenPrices). */
  weekOpenPrices?: Record<string, number> | null;
  now: number;
}

export interface MissionProgress {
  complete: boolean;
  progress: number;
  target: number;
  /** Why a full bar can't be claimed yet. */
  note?: string;
}

const CREW_ROSTERS: Record<string, string[]> = Object.fromEntries(Object.values(CREWS).map((c) => [c.id, c.members]));
const ALL_CREW_TICKERS = new Set(Object.values(CREW_ROSTERS).flat());
const BARGAIN_DROP_PCT = 5;

export const playerNetWorth = (p: MissionPlayer) => (p.portfolioValue || 0) - (p.marginUsed || 0);
export const playerMinTrade = (p: MissionPlayer) => missionMinTrade(playerNetWorth(p));

const flag = (done: boolean): MissionProgress => ({ complete: done, progress: done ? 1 : 0, target: 1 });
const count = (n: number, target: number): MissionProgress => ({ complete: n >= target, progress: n, target });

/** Tickers bought today, big enough to count, and still held. */
export const keptBuys = (buys: Record<string, DailyBuy> | undefined, ctx: MissionContext) => {
  const min = playerMinTrade(ctx.player);
  const holdings = ctx.player.holdings || {};
  return Object.entries(buys || {})
    .filter(([t, b]) => (b.value || 0) >= min && (holdings[t] || 0) >= (b.shares || 0) - 1e-6)
    .map(([t, b]) => ({ ticker: t, low: b.low ?? Infinity }));
};

export const dailyMissionProgress = (mission: Mission, dp: DailyProgress, ctx: MissionContext): MissionProgress => {
  const crew = ctx.player.crew || '';
  const roster = CREW_ROSTERS[crew] || [];
  const min = playerMinTrade(ctx.player);
  const kept = () => keptBuys(dp.buys, ctx);
  switch (mission.checkType) {
    case 'BUY_CREW':
      return flag(!!crew && kept().some((b) => roster.includes(b.ticker)));
    case 'BUY_RIVAL':
      return flag(!!crew && kept().some((b) => ALL_CREW_TICKERS.has(b.ticker) && !roster.includes(b.ticker)));
    case 'BUY_UNDERDOG':
      return flag(kept().some((b) => b.low < UNDERDOG_PRICE_THRESHOLD));
    case 'BUY_BARGAIN': {
      const open = ctx.weekOpenPrices || {};
      return flag(
        kept().some((b) => (open[b.ticker] || 0) > 0 && b.low <= open[b.ticker]! * (1 - BARGAIN_DROP_PCT / 100)),
      );
    }
    case 'BUY_SPREAD':
      return count(kept().length, mission.requirement ?? 3);
    case 'SELL_HELD':
      return { complete: (dp.heldSoldValue || 0) >= min, progress: Math.floor(dp.heldSoldValue || 0), target: min };
    case 'SELL_LOSS':
      return { complete: (dp.heldLossValue || 0) >= min, progress: Math.floor(dp.heldLossValue || 0), target: min };
    case 'LIMIT_FILL':
      return flag(keptBuys(dp.limitBuys, ctx).length > 0 || (dp.limitSoldValue || 0) >= min);
    case 'CREW_MAJORITY': {
      const pct = crew ? crewValuePercent(ctx.player.holdings, ctx.prices, roster) : 0;
      const target = mission.requirement ?? 50;
      return { complete: pct >= target, progress: Math.floor(pct), target };
    }
    default:
      return flag(false);
  }
};

export const weeklyMissionProgress = (mission: Mission, wp: WeeklyProgress, ctx: MissionContext): MissionProgress => {
  const target = mission.requirement ?? 1;
  if (!weeklyMissionsOpen(missionWeekId(ctx.now))) {
    return { complete: false, progress: 0, target, note: 'Weekly missions start at the Thursday reopen' };
  }
  switch (mission.checkType) {
    case 'CALL':
      return flag(callReward(wp.call?.result) > 0);
    case 'WEEKLY_TRADING_DAYS':
      return count(Object.keys(wp.tradingDays || {}).length, target);
    case 'WEEKLY_CHECKIN_STREAK':
      return count(Object.keys(wp.checkinDays || {}).length, target);
    case 'WEEKLY_BUY_HOLD': {
      const start = missionWeekStartMs(ctx.now);
      const min = playerMinTrade(ctx.player);
      const held = Object.entries(ctx.player.holdings || {}).some(
        ([t, s]) =>
          s > 0 &&
          sharesBoughtBetweenStillHeld(ctx.player.holdingCohorts?.[t], start, start + CALL_PICK_WINDOW_MS) *
            (ctx.prices[t] || 0) >=
            min,
      );
      const open = ctx.now >= buyHoldClaimOpensMs(ctx.now);
      return {
        complete: held && open,
        progress: held ? 1 : 0,
        target: 1,
        note: held && !open ? 'Claim opens Wednesday' : undefined,
      };
    }
    case 'WEEKLY_DIVERSIFIED': {
      const { positions, biggestPct } = diversification(ctx.player.holdings, ctx.prices, playerMinTrade(ctx.player));
      const tooBig = biggestPct > DIVERSIFIED_MAX_SHARE;
      return {
        complete: positions >= target && !tooBig,
        progress: Math.min(positions, target),
        target,
        note: tooBig ? `Your biggest stock is ${Math.round(biggestPct)}% of your stock value` : undefined,
      };
    }
    case 'WEEKLY_CREW_PERCENT': {
      const crew = ctx.player.crew || '';
      const pct = crew ? crewValuePercent(ctx.player.holdings, ctx.prices, CREW_ROSTERS[crew] || []) : 0;
      return { complete: pct >= target, progress: Math.floor(pct), target };
    }
    case 'WEEKLY_PORTFOLIO_GROWTH': {
      const g = earnedGrowthPct(wp, ctx.player);
      return { complete: g >= target, progress: Number.isFinite(g) ? Math.max(0, Math.floor(g)) : 0, target };
    }
    default:
      return flag(false);
  }
};

/** Missions this week that count for the player's crew in Rivalries. */
export const rivalryCount = (wp: WeeklyProgress | undefined, crew: string | null | undefined) =>
  crew && wp?.rivalry?.crew === crew ? wp.rivalry.count || 0 : 0;

export const rivalryQualified = (wp: WeeklyProgress | undefined, crew: string | null | undefined) =>
  rivalryCount(wp, crew) >= RIVALRY.qualifyMissions;

/** The rivalry tally after one more finished mission. */
export const nextRivalry = (wp: WeeklyProgress | undefined, crew: string) => ({
  crew,
  count: rivalryCount(wp, crew) + 1,
});
