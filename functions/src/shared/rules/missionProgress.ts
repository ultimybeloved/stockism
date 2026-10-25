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

import { CHARACTERS, CHARACTER_MAP, computeRarityTiers, type HoldingCohort } from '../characters';
import { CREWS, RIVALRY, type Mission } from '../crews';
import {
  missionMinTrade,
  sharesBoughtBetweenStillHeld,
  crewValuePercent,
  diversification,
  earnedGrowthPct,
  indexMovePct,
  missionWeekStartMs,
  missionWeekId,
  weeklyMissionsOpen,
  inOpeningDay,
  buyHoldClaimOpensMs,
  BUY_HOLD_WINDOW_MS,
  DIVERSIFIED_MAX_SHARE,
  type GrowthWeek,
} from './missions';

// Buys below this price count for Underdog Investor.
export const UNDERDOG_PRICE_THRESHOLD = 20;

/** What a player bought of one stock today. `low` and `high` are the lowest and highest market price paid. */
export interface DailyBuy {
  shares?: number;
  value?: number;
  low?: number;
  high?: number;
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
  /** Shorts opened today, by stock. */
  shorts?: Record<string, { shares?: number; value?: number }>;
  /** Value covered today, at a profit, out of shorts opened a day or more ago. */
  coverProfitValue?: number;
  /** Covered (at any price) a short opened before today, so Covered stays on today's list. */
  oldShortCovered?: boolean;
  checkedIn?: boolean;
  claimed?: Record<string, boolean>;
}

/** users/{uid}.weeklyMissions[weekId]. */
export interface WeeklyProgress extends GrowthWeek {
  tradeCount?: number;
  /** UTC dates with a trade big enough to count. */
  tradingDays?: Record<string, boolean>;
  checkinDays?: Record<string, boolean>;
  /** Lowest market price paid this week, by stock (Dip Collector). */
  buys?: Record<string, { low?: number }>;
  /** Opening-auction fills credited to this week (rules/missions auctionWeekId). */
  auctionBuys?: Record<string, DailyBuy>;
  auctionSoldValue?: number;
  /** Daily missions claimed this week. */
  dailyClaims?: number;
  /** Prediction bets placed this week, in dollars. */
  betValue?: number;
  /** Futures bought this week, dollars by market id. */
  futuresBuys?: Record<string, number>;
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
  shorts?: Record<string, { shares?: number; openedAt?: unknown } | null | undefined>;
  eventPositions?: Record<string, { shares?: Record<string, number>; settled?: boolean } | null | undefined>;
}

export interface MissionContext {
  player: MissionPlayer;
  prices: Record<string, number>;
  /** Prices at the Thursday reopen (market/current.weekOpenPrices). */
  weekOpenPrices?: Record<string, number> | null;
  /** Prices at the last daily close, 21:00 UTC (market/current.dayClosePrices). */
  dayClosePrices?: Record<string, number> | null;
  /** Prices when the chapter halt began (market/callBaseline). */
  haltPrices?: { prices?: Record<string, number>; savedAt?: number } | null;
  now: number;
}

// "Down / up X% this week" counts from before the chapter review, so the
// review's price changes count as part of the week they open. The halt lock
// is taken at 13:00 UTC, eight hours before the week starts; an older lock
// belongs to an earlier week and the reopen prices are used instead.
const HALT_LOCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const weekMovePrices = (ctx: MissionContext): Record<string, number> => {
  const open = ctx.weekOpenPrices || {};
  const lock = ctx.haltPrices;
  const start = missionWeekStartMs(ctx.now);
  if (!lock?.prices || !lock.savedAt || lock.savedAt > start || start - lock.savedAt > HALT_LOCK_MAX_AGE_MS)
    return open;
  return { ...open, ...lock.prices };
};

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
const DIP_COLLECTOR_DROP_PCT = 10;
const BLUE_CHIP_TIERS = new Set(['legendary', 'epic']);

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
    .map(([t, b]) => ({ ticker: t, low: b.low ?? Infinity, high: b.high ?? 0 }));
};

/** Stocks bought this week, still held, and worth at least the minimum trade now. */
const weekBuysStillHeld = (ctx: MissionContext) => {
  const start = missionWeekStartMs(ctx.now);
  const min = playerMinTrade(ctx.player);
  return Object.entries(ctx.player.holdings || {})
    .filter(
      ([t, s]) =>
        s > 0 &&
        sharesBoughtBetweenStillHeld(ctx.player.holdingCohorts?.[t], start, ctx.now + 1) * (ctx.prices[t] || 0) >= min,
    )
    .map(([t]) => t);
};

/** A Futures position still open, or one that has paid out. */
const holdsFutures = (p: MissionPlayer, marketId: string) => {
  const pos = p.eventPositions?.[marketId];
  return !!pos && (!!pos.settled || Object.values(pos.shares || {}).some((s) => s > 0));
};

const stampToMs = (v: unknown): number =>
  typeof v === 'number' ? v : ((v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0);

/**
 * Whether Covered can be in today's daily missions: a short opened before
 * today (UTC), or one covered today. Stays true after the cover, at a profit or
 * not, because the answer picks the whole list: flipping it reshuffled all
 * three of the day's missions.
 */
export const holdsShortForMissions = (player: MissionPlayer, dp: DailyProgress | null | undefined, now: number) => {
  const dayStart = new Date(now).setUTCHours(0, 0, 0, 0);
  if ((dp?.coverProfitValue || 0) > 0 || dp?.oldShortCovered) return true;
  return Object.values(player.shorts || {}).some((s) => {
    const opened = stampToMs(s?.openedAt);
    return (s?.shares || 0) > 0 && opened > 0 && opened < dayStart;
  });
};

const pct = (n: number) => `${n >= 0 ? 'up' : 'down'} ${Math.abs(n).toFixed(1)}%`;

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
      const open = weekMovePrices(ctx);
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
      const share = crew ? crewValuePercent(ctx.player.holdings, ctx.prices, roster) : 0;
      const target = mission.requirement ?? 50;
      return { complete: share >= target, progress: Math.floor(share), target };
    }
    case 'SHORT_OPEN':
      return flag(
        Object.entries(dp.shorts || {}).some(
          ([t, s]) => (s.value || 0) >= min && (ctx.player.shorts?.[t]?.shares || 0) >= (s.shares || 0) - 1e-6,
        ),
      );
    case 'COVER_PROFIT':
      return {
        complete: (dp.coverProfitValue || 0) >= min,
        progress: Math.floor(dp.coverProfitValue || 0),
        target: min,
      };
    case 'BUY_ETF':
      return flag(kept().some((b) => !!CHARACTER_MAP[b.ticker]?.isETF));
    case 'BUY_DIP': {
      const close = ctx.dayClosePrices || {};
      return flag(kept().some((b) => (close[b.ticker] || 0) > 0 && b.low < close[b.ticker]!));
    }
    case 'BUY_MOMENTUM': {
      const open = weekMovePrices(ctx);
      const rise = 1 + (mission.requirement ?? 5) / 100;
      return flag(kept().some((b) => (open[b.ticker] || 0) > 0 && b.high >= open[b.ticker]! * rise));
    }
    case 'BUY_BLUE_CHIP': {
      const tiers = computeRarityTiers(CHARACTERS, ctx.prices);
      return flag(kept().some((b) => BLUE_CHIP_TIERS.has(tiers[b.ticker] || '')));
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
    case 'WEEKLY_AUCTION': {
      const min = playerMinTrade(ctx.player);
      const done = keptBuys(wp.auctionBuys, ctx).length > 0 || (wp.auctionSoldValue || 0) >= min;
      return {
        ...flag(done),
        note: done
          ? undefined
          : inOpeningDay(ctx.now)
            ? 'Buy or sell by Friday 21:00 UTC'
            : "Missed this week's window. Next Thursday's opening auction counts for next week.",
      };
    }
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
          sharesBoughtBetweenStillHeld(ctx.player.holdingCohorts?.[t], start, start + BUY_HOLD_WINDOW_MS) *
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
    case 'WEEKLY_BEAT_MARKET': {
      // Losing less than the market isn't a win: the portfolio has to be up too.
      const g = earnedGrowthPct(wp, ctx.player);
      if (!Number.isFinite(g)) return flag(false);
      const m = indexMovePct(ctx.weekOpenPrices, ctx.prices);
      const done = g > 0 && g > m;
      return { ...flag(done), note: done ? undefined : `You're ${pct(g)} and the market is ${pct(m)}` };
    }
    case 'WEEKLY_BUY_SPREAD':
      return count(weekBuysStillHeld(ctx).length, target);
    case 'WEEKLY_DAILY_CLAIMS':
      return count(wp.dailyClaims || 0, target);
    case 'WEEKLY_PREDICTION': {
      const min = playerMinTrade(ctx.player);
      return flag(
        (wp.betValue || 0) >= min ||
          Object.entries(wp.futuresBuys || {}).some(([m, v]) => v >= min && holdsFutures(ctx.player, m)),
      );
    }
    case 'WEEKLY_BUY_DIPS': {
      const open = weekMovePrices(ctx);
      const drop = 1 - DIP_COLLECTOR_DROP_PCT / 100;
      const dips = weekBuysStillHeld(ctx).filter(
        (t) => (open[t] || 0) > 0 && (wp.buys?.[t]?.low ?? Infinity) <= open[t]! * drop,
      );
      return count(dips.length, target);
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
