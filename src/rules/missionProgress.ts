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
  /** Stocks that would count if bought right now. `change` is the move from `picksFrom`. */
  picks?: { ticker: string; change?: number; price?: number }[];
  /** What the picks' change is measured from. Absent when the picks show a price instead. */
  picksFrom?: string;
}

const HALT_LOCK_LABEL = "Thursday's 13:00 UTC price";

/** Stocks whose price right now passes `pass(price, base)`, biggest move first. */
const picksNow = (
  base: Record<string, number>,
  ctx: MissionContext,
  pass: (price: number, base: number) => boolean,
  skip: string[] = [],
) =>
  CHARACTERS.filter((c) => {
    const b = base[c.ticker] || 0;
    const p = ctx.prices[c.ticker] || 0;
    return !c.ipoRequired && b > 0 && p > 0 && !skip.includes(c.ticker) && pass(p, b);
  })
    .map((c) => ({ ticker: c.ticker, change: (ctx.prices[c.ticker]! / base[c.ticker]! - 1) * 100 }))
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));

/** Stocks that pass `pass` at today's price, shown with that price, highest first. */
const pricedNow = (ctx: MissionContext, pass: (c: (typeof CHARACTERS)[number], price: number) => boolean) =>
  CHARACTERS.filter((c) => !c.ipoRequired && (ctx.prices[c.ticker] || 0) > 0 && pass(c, ctx.prices[c.ticker]!))
    .map((c) => ({ ticker: c.ticker, price: ctx.prices[c.ticker]! }))
    .sort((x, y) => y.price - x.price);

const CREW_ROSTERS: Record<string, string[]> = Object.fromEntries(Object.values(CREWS).map((c) => [c.id, c.members]));
const ALL_CREW_TICKERS = new Set(Object.values(CREW_ROSTERS).flat());
const BARGAIN_DROP_PCT = 5;
const DIP_COLLECTOR_DROP_PCT = 10;
const BLUE_CHIP_TIERS = new Set(['legendary', 'epic']);

export const playerNetWorth = (p: MissionPlayer) => (p.portfolioValue || 0) - (p.marginUsed || 0);
export const playerMinTrade = (p: MissionPlayer) => missionMinTrade(playerNetWorth(p));

const flag = (done: boolean): MissionProgress => ({ complete: done, progress: done ? 1 : 0, target: 1 });
const count = (n: number, target: number): MissionProgress => ({ complete: n >= target, progress: n, target });

type KeptBuy = { ticker: string; low: number; high: number };
const asKept = ([t, b]: [string, DailyBuy]): KeptBuy => ({ ticker: t, low: b.low ?? Infinity, high: b.high ?? 0 });

/** Why one of today's buys doesn't count, or undefined if it does. */
const buyDropped = ([t, b]: [string, DailyBuy], ctx: MissionContext) => {
  const min = playerMinTrade(ctx.player);
  if ((b.value || 0) < min) return `Your ${t} buy ($${Math.floor(b.value || 0)}) is under the $${min} minimum.`;
  if ((ctx.player.holdings?.[t] || 0) < (b.shares || 0) - 1e-6)
    return `You sold some of today's ${t} shares, so it no longer counts.`;
  return undefined;
};

/** Tickers bought today, big enough to count, and still held. */
export const keptBuys = (buys: Record<string, DailyBuy> | undefined, ctx: MissionContext) =>
  Object.entries(buys || {})
    .filter((e) => !buyDropped(e, ctx))
    .map(asKept);

/**
 * A "buy X and keep it" mission. Until it's done: why a buy that fit didn't
 * count, otherwise `more` (a standing note, or what would count if bought now).
 */
const buyFlag = (
  buys: Record<string, DailyBuy> | undefined,
  ctx: MissionContext,
  fits: (b: KeptBuy) => boolean,
  more: () => Pick<MissionProgress, 'note' | 'picks' | 'picksFrom'> = () => ({}),
): MissionProgress => {
  const fitting = Object.entries(buys || {}).filter((e) => fits(asKept(e)));
  const why = fitting.map((e) => buyDropped(e, ctx));
  if (why.some((w) => !w)) return flag(true);
  const extra = more();
  return { ...flag(false), ...extra, note: why[0] ?? extra.note };
};

/** A counting mission's note: what has counted, then why a buy didn't. */
const countedNote = (counted: string[], dropped?: string) =>
  [counted.length ? `Counted so far: ${counted.join(', ')}.` : '', dropped ?? ''].filter(Boolean).join(' ') ||
  undefined;

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
      return crew ? buyFlag(dp.buys, ctx, (b) => roster.includes(b.ticker)) : flag(false);
    case 'BUY_RIVAL':
      return crew
        ? buyFlag(
            dp.buys,
            ctx,
            (b) => ALL_CREW_TICKERS.has(b.ticker) && !roster.includes(b.ticker),
            () => ({ note: "Any stock in another crew counts. Stocks with no crew don't." }),
          )
        : flag(false);
    case 'BUY_UNDERDOG':
      return buyFlag(
        dp.buys,
        ctx,
        (b) => b.low < UNDERDOG_PRICE_THRESHOLD,
        () => ({ picks: pricedNow(ctx, (_, p) => p < UNDERDOG_PRICE_THRESHOLD) }),
      );
    case 'BUY_BARGAIN': {
      const open = weekMovePrices(ctx);
      const drop = 1 - BARGAIN_DROP_PCT / 100;
      return buyFlag(
        dp.buys,
        ctx,
        (b) => (open[b.ticker] || 0) > 0 && b.low <= open[b.ticker]! * drop,
        () => ({ picks: picksNow(open, ctx, (p, b) => p <= b * drop), picksFrom: HALT_LOCK_LABEL }),
      );
    }
    case 'BUY_SPREAD': {
      const done = count(kept().length, mission.requirement ?? 3);
      if (done.complete) return done;
      const dropped = Object.entries(dp.buys || {})
        .map((e) => buyDropped(e, ctx))
        .find(Boolean);
      return {
        ...done,
        note: countedNote(
          kept().map((b) => b.ticker),
          dropped,
        ),
      };
    }
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
      return buyFlag(
        dp.buys,
        ctx,
        (b) => !!CHARACTER_MAP[b.ticker]?.isETF,
        () => ({ picks: pricedNow(ctx, (c) => !!c.isETF) }),
      );
    case 'BUY_DIP': {
      const close = ctx.dayClosePrices || {};
      return buyFlag(
        dp.buys,
        ctx,
        (b) => (close[b.ticker] || 0) > 0 && b.low < close[b.ticker]!,
        () => ({ picks: picksNow(close, ctx, (p, b) => p < b), picksFrom: "yesterday's 21:00 UTC close" }),
      );
    }
    case 'BUY_MOMENTUM': {
      const open = weekMovePrices(ctx);
      const rise = 1 + (mission.requirement ?? 5) / 100;
      return buyFlag(
        dp.buys,
        ctx,
        (b) => (open[b.ticker] || 0) > 0 && b.high >= open[b.ticker]! * rise,
        () => ({ picks: picksNow(open, ctx, (p, b) => p >= b * rise), picksFrom: HALT_LOCK_LABEL }),
      );
    }
    case 'BUY_BLUE_CHIP': {
      const tiers = computeRarityTiers(CHARACTERS, ctx.prices);
      const blue = (t: string) => BLUE_CHIP_TIERS.has(tiers[t] || '');
      return buyFlag(
        dp.buys,
        ctx,
        (b) => blue(b.ticker),
        () => ({ picks: pricedNow(ctx, (c) => blue(c.ticker)) }),
      );
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
      const buyWindowOpen = ctx.now < start + BUY_HOLD_WINDOW_MS;
      const waiting = buyWindowOpen
        ? `Buy $${min}+ of any stock by Saturday 23:59 UTC and keep it until Wednesday`
        : "The buy window closed at the end of Saturday. Next week's opens Thursday.";
      return {
        complete: held && open,
        progress: held ? 1 : 0,
        target: 1,
        note: held ? (open ? undefined : 'Claim opens Wednesday 00:00 UTC') : waiting,
      };
    }
    case 'WEEKLY_DIVERSIFIED': {
      const { positions, biggestPct } = diversification(ctx.player.holdings, ctx.prices, playerMinTrade(ctx.player));
      const tooBig = biggestPct > DIVERSIFIED_MAX_SHARE;
      return {
        complete: positions >= target && !tooBig,
        progress: Math.min(positions, target),
        target,
        note: tooBig
          ? `Your biggest stock is ${Math.round(biggestPct)}% of your stock value`
          : positions < target
            ? `Only stocks you hold $${playerMinTrade(ctx.player)}+ of count`
            : undefined,
      };
    }
    case 'WEEKLY_CREW_PERCENT': {
      const crew = ctx.player.crew || '';
      const pct = crew ? crewValuePercent(ctx.player.holdings, ctx.prices, CREW_ROSTERS[crew] || []) : 0;
      return { complete: pct >= target, progress: Math.floor(pct), target };
    }
    case 'WEEKLY_PORTFOLIO_GROWTH': {
      const g = earnedGrowthPct(wp, ctx.player);
      return {
        complete: g >= target,
        progress: Number.isFinite(g) ? Math.max(0, Math.floor(g)) : 0,
        target,
        note: g >= target ? undefined : "Free money (check-ins, rewards, drops) and borrowing don't count as growth",
      };
    }
    case 'WEEKLY_BEAT_MARKET': {
      // Losing less than the market isn't a win: the portfolio has to be up too.
      const g = earnedGrowthPct(wp, ctx.player);
      if (!Number.isFinite(g)) return flag(false);
      const m = indexMovePct(ctx.weekOpenPrices, ctx.prices);
      const done = g > 0 && g > m;
      return { ...flag(done), note: done ? undefined : `You're ${pct(g)} and the market is ${pct(m)}` };
    }
    case 'WEEKLY_BUY_SPREAD': {
      const counted = weekBuysStillHeld(ctx);
      const done = count(counted.length, target);
      return done.complete ? done : { ...done, note: countedNote(counted) };
    }
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
      const done = count(dips.length, target);
      if (done.complete) return done;
      return {
        ...done,
        note: countedNote(dips),
        picks: picksNow(open, ctx, (p, b) => p <= b * drop, dips),
        picksFrom: HALT_LOCK_LABEL,
      };
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
