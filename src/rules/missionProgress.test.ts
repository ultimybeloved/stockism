// Missions: the week clock, what counts as a trade, and every mission check.
import { describe, it, expect } from 'vitest';
import { CREWS, DAILY_MISSIONS, WEEKLY_MISSIONS, getDailyMissions, getWeeklyMissions, OPENING_BELL } from '../crews';
import { FLAIR_CREWS } from './flairCrews';
import { CHARACTERS, DIVIDEND_HOLD_MS, computeRarityTiers } from '../characters';
import {
  missionWeekId,
  missionWeekStartMs,
  inOpeningDay,
  auctionWeekId,
  indexMovePct,
  missionMinTrade,
  missionTradeCounts,
  sharesHeldAtLeast,
} from './missions';
import {
  dailyMissionProgress,
  holdsShortForMissions,
  weeklyMissionProgress,
  weekMovePrices,
  rivalryCount,
  nextRivalry,
  type MissionContext,
  type MissionPlayer,
} from './missionProgress';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const REOPEN = Date.UTC(2026, 9, 22, 21, 0); // Thursday 22 Oct 2026, 21:00 UTC

const crew = Object.values(CREWS)[0]!;
const rival = Object.values(CREWS)[1]!;
const MINE = crew.members[0]!;
const THEIRS = rival.members[0]!;

/** A lot bought `ageMs` before `now`. */
const lot = (shares: number, now: number, ageMs: number) => ({
  eligible: 0,
  pending: [{ shares, availableAt: now - ageMs + DIVIDEND_HOLD_MS }],
});

const ctxOf = (player: MissionPlayer, prices: Record<string, number>, now = REOPEN + DAY, extra = {}) =>
  ({ player: { portfolioValue: 10000, ...player }, prices, now, ...extra }) as MissionContext;

describe('the mission week', () => {
  it('starts at the Thursday reopen', () => {
    expect(missionWeekId(REOPEN - 60000)).toBe('2026-10-15');
    expect(missionWeekId(REOPEN)).toBe('2026-10-22');
    expect(missionWeekId(REOPEN + 6 * DAY + 23 * HOUR)).toBe('2026-10-22');
    expect(missionWeekStartMs(REOPEN + 3 * DAY)).toBe(REOPEN);
  });

  it('credits the 20:56 opening auction to the week the reopen starts', () => {
    expect(auctionWeekId(REOPEN - 4 * 60000)).toBe('2026-10-22');
    expect(auctionWeekId(REOPEN + 3 * 60000)).toBe('2026-10-22');
    expect(auctionWeekId(REOPEN + 3 * DAY)).toBe('2026-10-22');
  });
});

describe('what counts as a trade', () => {
  it('1 whole share, or $50 worth', () => {
    expect(missionTradeCounts(1, 5)).toBe(true);
    expect(missionTradeCounts(0.5, 60)).toBe(true);
    expect(missionTradeCounts(0.5, 20)).toBe(false);
    expect(missionTradeCounts(undefined, undefined)).toBe(false);
  });

  it('the old minimum (still read by old sell records) was 1% of net worth, $50 to $500', () => {
    expect(missionMinTrade(1000)).toBe(50);
    expect(missionMinTrade(10000)).toBe(100);
    expect(missionMinTrade(1e7)).toBe(500);
    expect(missionMinTrade(NaN)).toBe(50);
  });

  it('only shares held a day count as old', () => {
    const now = REOPEN;
    const cohort = { eligible: 0, pending: [lot(5, now, 2 * DAY).pending[0]!, lot(5, now, HOUR).pending[0]!] };
    expect(sharesHeldAtLeast(cohort, 10, now)).toBe(5);
    expect(sharesHeldAtLeast(undefined, 10, now)).toBe(10); // predates the lot ledger
  });
});

describe('daily missions', () => {
  const prices = { [MINE]: 50, [THEIRS]: 10 };
  const crewSupport = DAILY_MISSIONS.BUY_CREW_MEMBER!;

  it('a buy counts even if it was sold again', () => {
    const dp = { buys: { [MINE]: { shares: 4, value: 200, low: 50 } } };
    expect(
      dailyMissionProgress(crewSupport, dp, ctxOf({ crew: crew.id, holdings: { [MINE]: 4 } }, prices)).complete,
    ).toBe(true);
    expect(dailyMissionProgress(crewSupport, dp, ctxOf({ crew: crew.id, holdings: {} }, prices)).complete).toBe(true);
  });

  it('a throwaway buy does not count', () => {
    const dp = { buys: { [MINE]: { shares: 0.1, value: 5, low: 50 } } };
    expect(
      dailyMissionProgress(crewSupport, dp, ctxOf({ crew: crew.id, holdings: { [MINE]: 1 } }, prices)).complete,
    ).toBe(false);
  });

  it('rival, underdog and bargain buys', () => {
    const dp = { buys: { [THEIRS]: { shares: 20, value: 200, low: 9 } } };
    const ctx = ctxOf({ crew: crew.id, holdings: { [THEIRS]: 20 } }, prices, REOPEN + DAY, {
      weekOpenPrices: { [THEIRS]: 10 },
    });
    expect(dailyMissionProgress(DAILY_MISSIONS.RIVAL_TRADER!, dp, ctx).complete).toBe(true);
    expect(dailyMissionProgress(DAILY_MISSIONS.UNDERDOG_INVESTOR!, dp, ctx).complete).toBe(true);
    expect(dailyMissionProgress(DAILY_MISSIONS.BARGAIN_HUNTER!, dp, ctx).complete).toBe(true); // 10% off the open
    expect(
      dailyMissionProgress(DAILY_MISSIONS.BARGAIN_HUNTER!, dp, { ...ctx, weekOpenPrices: { [THEIRS]: 9.2 } }).complete,
    ).toBe(false);
  });

  it('Spread Out needs 3 different buys', () => {
    const buy = { shares: 10, value: 150, low: 15 };
    const m = DAILY_MISSIONS.SPREAD_OUT!;
    expect(dailyMissionProgress(m, { buys: { A: buy, B: buy, C: buy } }, ctxOf({}, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { buys: { A: buy, B: buy } }, ctxOf({}, {})).progress).toBe(2);
  });

  it('says why a buy that fit did not count', () => {
    const small = { buys: { [MINE]: { shares: 0.1, value: 5, low: 50 } } };
    const player = { crew: crew.id, holdings: { [MINE]: 1 } };
    expect(dailyMissionProgress(crewSupport, small, ctxOf(player, prices)).note).toBe(
      `Your ${MINE} buy is under 1 share and under $50, so it doesn't count.`,
    );
    const spread = dailyMissionProgress(
      DAILY_MISSIONS.SPREAD_OUT!,
      { buys: { A: { shares: 10, value: 150 }, B: { shares: 0.5, value: 20 } } },
      ctxOf({}, {}),
    );
    expect(spread.note).toBe("Counted so far: A. Your B buy is under 1 share and under $50, so it doesn't count.");
  });

  it('lists stocks that would count now for Underdog, Basket Buyer and Blue Chip', () => {
    const cheap = CHARACTERS.find((c) => !c.ipoRequired && !c.isETF)!.ticker;
    const etf = CHARACTERS.find((c) => !c.ipoRequired && c.isETF)!.ticker;
    const ctx = ctxOf({ holdings: {} }, { [cheap]: 12, [etf]: 40 });
    const under = dailyMissionProgress(DAILY_MISSIONS.UNDERDOG_INVESTOR!, {}, ctx);
    expect(under.picks).toEqual([{ ticker: cheap, price: 12 }]);
    expect(under.picksFrom).toBeUndefined();
    expect(dailyMissionProgress(DAILY_MISSIONS.BASKET_BUYER!, {}, ctx).picks?.map((p) => p.ticker)).toEqual([etf]);
    expect(dailyMissionProgress(DAILY_MISSIONS.BLUE_CHIP!, {}, ctx).picks).toBeDefined();
  });

  it('lists rival crew stocks for Rival Trader', () => {
    const ctx = ctxOf({ crew: crew.id }, { [MINE]: 30, [THEIRS]: 40 });
    const picks = dailyMissionProgress(DAILY_MISSIONS.RIVAL_TRADER!, {}, ctx).picks!.map((p) => p.ticker);
    expect(picks).toEqual([THEIRS]);
  });

  it('lists held stocks above what you paid for Profit Taker', () => {
    const player = {
      holdings: { [MINE]: 2, [THEIRS]: 2 },
      costBasis: { [MINE]: 20, [THEIRS]: 50 },
    };
    const p = dailyMissionProgress(DAILY_MISSIONS.PROFIT_TAKER!, {}, ctxOf(player, { [MINE]: 30, [THEIRS]: 40 }));
    expect(p.picksAction).toBe('sell');
    expect(p.picks?.map((x) => x.ticker)).toEqual([MINE]);
    expect(p.picks?.[0]?.change).toBeCloseTo(49.85);
    // Under 1 share and under $50 doesn't count, so it isn't listed.
    const tiny = { holdings: { [MINE]: 0.5 }, costBasis: { [MINE]: 20 } };
    expect(dailyMissionProgress(DAILY_MISSIONS.PROFIT_TAKER!, {}, ctxOf(tiny, { [MINE]: 30 })).picks).toEqual([]);
  });

  it('lists held stocks below what you paid for Cut Your Losses', () => {
    const player = { holdings: { [MINE]: 2, [THEIRS]: 2 }, costBasis: { [MINE]: 20, [THEIRS]: 50 } };
    const p = dailyMissionProgress(DAILY_MISSIONS.CUT_LOSSES!, {}, ctxOf(player, { [MINE]: 30, [THEIRS]: 40 }));
    expect(p.picks?.map((x) => x.ticker)).toEqual([THEIRS]);
    expect(p.picks?.[0]?.change).toBeLessThan(0);
  });

  it('lists own crew stocks for Crew Support and open shorts for Covered', () => {
    const prices = { [MINE]: 30, [THEIRS]: 40 };
    const crewPicks = dailyMissionProgress(crewSupport, {}, ctxOf({ crew: crew.id }, prices)).picks!;
    expect(crewPicks.map((p) => p.ticker)).toContain(MINE);
    expect(crewPicks.map((p) => p.ticker)).not.toContain(THEIRS);
    const shorts = { shorts: { [MINE]: { shares: 2 }, [THEIRS]: { shares: 0.5 } } };
    const cover = dailyMissionProgress(DAILY_MISSIONS.COVERED!, {}, ctxOf(shorts, prices));
    expect(cover.picksAction).toBe('cover');
    expect(cover.picks).toEqual([{ ticker: MINE, price: 30 }]);
  });

  it('sells count above or below what you paid', () => {
    const ctx = ctxOf({ holdings: {} }, {});
    const profit = DAILY_MISSIONS.PROFIT_TAKER!;
    const loss = DAILY_MISSIONS.CUT_LOSSES!;
    expect(dailyMissionProgress(profit, { profitSold: { shares: 1, value: 5 } }, ctx).complete).toBe(true);
    expect(dailyMissionProgress(profit, { profitSold: { shares: 0.2, value: 5 } }, ctx).complete).toBe(false);
    expect(dailyMissionProgress(profit, { lossSold: { shares: 3, value: 30 } }, ctx).complete).toBe(false);
    expect(dailyMissionProgress(loss, { lossSold: { shares: 3, value: 30 } }, ctx).complete).toBe(true);
    // Records from before 2026-10-27.
    expect(dailyMissionProgress(profit, { heldSoldValue: 150 }, ctx).complete).toBe(true);
    expect(dailyMissionProgress(loss, { heldLossValue: 150 }, ctx).complete).toBe(true);
  });

  it('Order Filled takes a limit buy or a limit sell of old shares', () => {
    const m = DAILY_MISSIONS.ORDER_FILLED!;
    const kept = { limitBuys: { A: { shares: 5, value: 200 } } };
    expect(dailyMissionProgress(m, kept, ctxOf({ holdings: { A: 5 } }, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { limitSoldValue: 200 }, ctxOf({}, {})).complete).toBe(true);
  });

  it('Crew Majority weighs by value, not share count', () => {
    const m = DAILY_MISSIONS.CREW_MAJORITY!;
    const pile = ctxOf({ crew: crew.id, holdings: { [MINE]: 100, [THEIRS]: 1 } }, { [MINE]: 1, [THEIRS]: 500 });
    expect(dailyMissionProgress(m, {}, pile).complete).toBe(false);
    const real = ctxOf({ crew: crew.id, holdings: { [MINE]: 10, [THEIRS]: 1 } }, { [MINE]: 100, [THEIRS]: 500 });
    expect(dailyMissionProgress(m, {}, real).complete).toBe(true);
  });

  it('players without a crew get no crew missions', () => {
    for (let d = 1; d <= 28; d++) {
      const list = getDailyMissions(`2026-11-${String(d).padStart(2, '0')}`, null);
      expect(list).toHaveLength(3);
      expect(list.some((x) => x.crewOnly)).toBe(false);
    }
  });

  it('from the pool change, Crew Majority is gone and Covered goes only to short holders until 2026-10-29', () => {
    const ids = (days: string[], holdsShort: boolean) => {
      const seen = new Set<string>();
      for (const day of days)
        for (let seed = 0; seed < 200; seed++)
          getDailyMissions(day, crew.id, seed, holdsShort).forEach((m) => seen.add(m.id));
      return seen;
    };
    const oldDays = ['2026-10-26', '2026-10-27', '2026-10-28'];
    expect(ids(oldDays, true).has('CREW_MAJORITY')).toBe(false);
    expect(ids(oldDays, true).has('COVERED')).toBe(true);
    expect(ids(oldDays, false).has('COVERED')).toBe(false);
    expect(ids(['2026-11-02'], false).has('COVERED')).toBe(true);
    // Days before the change keep the old pool.
    const before = new Set<string>();
    for (let seed = 0; seed < 200; seed++)
      getDailyMissions('2026-10-23', crew.id, seed).forEach((m) => before.add(m.id));
    expect(before.has('CREW_MAJORITY') && before.has('COVERED')).toBe(true);
  });

  it('Order Filled leaves the pool on 2026-10-25', () => {
    const ids = (day: string) => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 200; seed++) getDailyMissions(day, crew.id, seed, true).forEach((m) => seen.add(m.id));
      return seen;
    };
    expect(ids('2026-10-24').has('ORDER_FILLED')).toBe(true);
    expect(ids('2026-10-25').has('ORDER_FILLED')).toBe(false);
  });

  it('a short counts for Covered if opened before today, or covered at a profit today', () => {
    const now = Date.UTC(2026, 10, 3, 15);
    const yesterday = Date.UTC(2026, 10, 2, 20);
    const thisMorning = Date.UTC(2026, 10, 3, 9);
    expect(holdsShortForMissions({ shorts: { A: { shares: 5, openedAt: yesterday } } }, {}, now)).toBe(true);
    expect(holdsShortForMissions({ shorts: { A: { shares: 5, openedAt: thisMorning } } }, {}, now)).toBe(false);
    expect(holdsShortForMissions({ shorts: { A: { shares: 0, openedAt: yesterday } } }, {}, now)).toBe(false);
    expect(holdsShortForMissions({}, { coverProfitValue: 200 }, now)).toBe(true);
    // Covered at a loss today: the list must not reshuffle.
    expect(holdsShortForMissions({}, { oldShortCovered: true }, now)).toBe(true);
    expect(holdsShortForMissions({}, {}, now)).toBe(false);
  });
});

describe('weekly missions', () => {
  it('every week is Opening Bell plus one more', () => {
    const list = getWeeklyMissions(null, '2026-10-22');
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(OPENING_BELL);
    expect(list[1]!.crewOnly).toBeFalsy();
  });

  it('Buy and Hold: bought Thursday to Saturday, claimable from Wednesday', () => {
    const m = WEEKLY_MISSIONS.BUY_AND_HOLD!;
    const wed = REOPEN + 5 * DAY + 4 * HOUR;
    const boughtFri = { shares: 10, availableAt: REOPEN + DAY + DIVIDEND_HOLD_MS };
    const player = { holdings: { A: 10 }, holdingCohorts: { A: { eligible: 0, pending: [boughtFri] } } };
    expect(weeklyMissionProgress(m, {}, ctxOf(player, { A: 20 }, wed)).complete).toBe(true);
    const early = weeklyMissionProgress(m, {}, ctxOf(player, { A: 20 }, REOPEN + 3 * DAY));
    expect(early.complete).toBe(false);
    expect(early.note).toBeTruthy();
    const boughtMon = { shares: 10, availableAt: REOPEN + 4 * DAY + DIVIDEND_HOLD_MS };
    const late = { holdings: { A: 10 }, holdingCohorts: { A: { eligible: 0, pending: [boughtMon] } } };
    expect(weeklyMissionProgress(m, {}, ctxOf(late, { A: 20 }, wed)).complete).toBe(false);
    expect(weeklyMissionProgress(m, {}, ctxOf({ holdings: {} }, {}, REOPEN + DAY)).note).toMatch(/by Saturday/);
    expect(weeklyMissionProgress(m, {}, ctxOf(late, { A: 20 }, wed)).note).toMatch(/window closed/);
  });

  it('Buy and Hold: a daily drop is not a buy', () => {
    const m = WEEKLY_MISSIONS.BUY_AND_HOLD!;
    const wed = REOPEN + 5 * DAY + 4 * HOUR;
    const dropFri = { shares: 10, availableAt: REOPEN + DAY + DIVIDEND_HOLD_MS, free: true };
    const player = { holdings: { A: 10 }, holdingCohorts: { A: { eligible: 0, pending: [dropFri] } } };
    expect(weeklyMissionProgress(m, {}, ctxOf(player, { A: 20 }, wed)).complete).toBe(false);
  });

  it('nothing is claimable before the first Thursday week', () => {
    const m = WEEKLY_MISSIONS.DIVERSIFIED!;
    const even = { A: 10, B: 10, C: 10, D: 10, E: 10 };
    const p = { A: 20, B: 20, C: 20, D: 20, E: 20 };
    const stub = weeklyMissionProgress(m, {}, ctxOf({ holdings: even }, p, REOPEN - HOUR));
    expect(stub.complete).toBe(false);
    expect(stub.note).toBeTruthy();
    expect(weeklyMissionProgress(m, {}, ctxOf({ holdings: even }, p, REOPEN)).complete).toBe(true);
  });

  it('Diversified: 5 real positions, none over 40%', () => {
    const m = WEEKLY_MISSIONS.DIVERSIFIED!;
    const even = { A: 10, B: 10, C: 10, D: 10, E: 10 };
    const p = { A: 20, B: 20, C: 20, D: 20, E: 20 };
    expect(weeklyMissionProgress(m, {}, ctxOf({ holdings: even }, p)).complete).toBe(true);
    expect(weeklyMissionProgress(m, {}, ctxOf({ holdings: { ...even, A: 100 } }, p)).complete).toBe(false);
    const small = weeklyMissionProgress(m, {}, ctxOf({ holdings: { ...even, E: 0.1 } }, p));
    expect(small.complete).toBe(false);
    expect(small.note).toBe('Only stocks you hold $100+ of count');
  });

  it('growth takes free money and margin out', () => {
    const m = WEEKLY_MISSIONS.PORTFOLIO_BUILDER!;
    const wp = { startPortfolioValue: 3000, startGrantedValue: 500 };
    expect(weeklyMissionProgress(m, wp, ctxOf({ portfolioValue: 5600, grantedValue: 3100 }, {})).complete).toBe(false);
    expect(weeklyMissionProgress(m, wp, ctxOf({ portfolioValue: 6200, grantedValue: 3100 }, {}))).toMatchObject({
      complete: true,
      progress: 20,
    });
    expect(weeklyMissionProgress(m, {}, ctxOf({ portfolioValue: 1e9 }, {})).complete).toBe(false);
  });

  it('trading days and check-ins', () => {
    const days = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((d) => [d, true]));
    expect(weeklyMissionProgress(WEEKLY_MISSIONS.TRADING_STREAK!, { tradingDays: days }, ctxOf({}, {})).complete).toBe(
      true,
    );
    expect(weeklyMissionProgress(WEEKLY_MISSIONS.DAILY_GRINDER!, { checkinDays: days }, ctxOf({}, {})).complete).toBe(
      true,
    );
    const four = Object.fromEntries(['a', 'b', 'c', 'd'].map((d) => [d, true]));
    expect(weeklyMissionProgress(WEEKLY_MISSIONS.DAILY_GRINDER!, { checkinDays: four }, ctxOf({}, {})).complete).toBe(
      false,
    );
  });
});

describe('Rivalry count', () => {
  it('counts only missions finished in the current crew', () => {
    expect(rivalryCount({ rivalry: { crew: 'A', count: 4 } }, 'A')).toBe(4);
    expect(rivalryCount({ rivalry: { crew: 'A', count: 4 } }, 'B')).toBe(0);
    expect(nextRivalry({ rivalry: { crew: 'A', count: 4 } }, 'B')).toEqual({ crew: 'B', count: 1 });
    expect(nextRivalry(undefined, 'A')).toEqual({ crew: 'A', count: 1 });
  });
});

const STOCKS = CHARACTERS.filter((c) => !c.isETF && c.basePrice > 0);
const ETF = CHARACTERS.find((c) => c.isETF)!.ticker;
const [S1, S2, S3, S4, S5] = STOCKS.map((c) => c.ticker) as [string, string, string, string, string];
const buy = (value: number, extra = {}) => ({ shares: 10, value, ...extra });
const held = (t: string) => ({ holdings: { [t]: 10 } });

describe('new daily missions', () => {
  it('Short Seller: any short of 1 share or $50, closed or not', () => {
    const m = DAILY_MISSIONS.SHORT_SELLER!;
    expect(dailyMissionProgress(m, { shorts: { [S1]: { shares: 5, value: 20 } } }, ctxOf({}, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { shorts: { [S1]: { shares: 0.5, value: 20 } } }, ctxOf({}, {})).complete).toBe(
      false,
    );
  });

  it('Covered: any close, or an old profitable cover record', () => {
    const m = DAILY_MISSIONS.COVERED!;
    expect(dailyMissionProgress(m, { covered: { shares: 2, value: 10 } }, ctxOf({}, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { covered: { shares: 0.1, value: 10 } }, ctxOf({}, {})).complete).toBe(false);
    expect(dailyMissionProgress(m, { coverProfitValue: 100 }, ctxOf({}, {})).complete).toBe(true);
  });

  it('Flair Support: a stock from the flair crew you picked', () => {
    const m = DAILY_MISSIONS.FLAIR_SUPPORT!;
    const flair = FLAIR_CREWS.CHEONLIANG!;
    const outsider = flair.members.find((t) => !CREWS[flair.crew]!.members.includes(t))!;
    const dp = { buys: { [outsider]: buy(200) } };
    const player = { crew: flair.crew, flairCrew: flair.id };
    expect(dailyMissionProgress(m, dp, ctxOf(player, {})).complete).toBe(true);
    const none = dailyMissionProgress(m, dp, ctxOf({ crew: flair.crew }, {}));
    expect(none.complete).toBe(false);
    expect(none.note).toMatch(/Pick a flair crew/);
    // A flair from another crew doesn't count.
    expect(dailyMissionProgress(m, dp, ctxOf({ crew: 'HOSTEL', flairCrew: flair.id }, {})).complete).toBe(false);
  });

  it('Crew Fund: your own crew ETF', () => {
    const m = DAILY_MISSIONS.CREW_FUND!;
    const etf = crew.etf!;
    expect(dailyMissionProgress(m, { buys: { [etf]: buy(200) } }, ctxOf({ crew: crew.id }, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { buys: { [rival.etf!]: buy(200) } }, ctxOf({ crew: crew.id }, {})).complete).toBe(
      false,
    );
  });

  it('flair missions go to crews with flair crews, from 2026-10-29', () => {
    const ids = (crewId: string, day: string) => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 300; seed++) getDailyMissions(day, crewId, seed).forEach((m) => seen.add(m.id));
      return seen;
    };
    expect(ids('ALLIED', '2026-11-02').has('FLAIR_SUPPORT')).toBe(true);
    expect(ids('GOD_DOG', '2026-11-02').has('FLAIR_SUPPORT')).toBe(false);
    expect(ids('ALLIED', '2026-10-28').has('FLAIR_SUPPORT')).toBe(false);
    expect(ids('ALLIED', '2026-10-28').has('BARGAIN_HUNTER')).toBe(true);
    expect(ids('ALLIED', '2026-11-02').has('BARGAIN_HUNTER')).toBe(false);
  });

  it('Basket Buyer: an ETF, kept', () => {
    const m = DAILY_MISSIONS.BASKET_BUYER!;
    expect(dailyMissionProgress(m, { buys: { [ETF]: buy(200) } }, ctxOf(held(ETF), {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { buys: { [S1]: buy(200) } }, ctxOf(held(S1), {})).complete).toBe(false);
  });

  it('Buy the Dip: paid under the last daily close', () => {
    const m = DAILY_MISSIONS.BUY_THE_DIP!;
    const dp = { buys: { [S1]: buy(200, { low: 9.5 }) } };
    const at = (close?: number) =>
      dailyMissionProgress(m, dp, ctxOf(held(S1), {}, undefined, close ? { dayClosePrices: { [S1]: close } } : {}));
    expect(at(10).complete).toBe(true);
    expect(at(9).complete).toBe(false);
    expect(at().complete).toBe(false);
  });

  it('Ride the Wave: paid over the last daily close', () => {
    const m = DAILY_MISSIONS.RIDE_THE_WAVE!;
    const close = { dayClosePrices: { [S1]: 100 } };
    const up = { buys: { [S1]: buy(200, { low: 100, high: 101 }) } };
    const flat = { buys: { [S1]: buy(200, { low: 99, high: 100 }) } };
    expect(dailyMissionProgress(m, up, ctxOf({}, {}, undefined, close)).complete).toBe(true);
    expect(dailyMissionProgress(m, flat, ctxOf({}, {}, undefined, close)).complete).toBe(false);
  });

  it('Blue Chip: a Legendary or Epic stock at current prices', () => {
    const m = DAILY_MISSIONS.BLUE_CHIP!;
    const prices = Object.fromEntries(STOCKS.map((c) => [c.ticker, c.basePrice]));
    const tiers = computeRarityTiers(CHARACTERS, prices);
    const top = STOCKS.find((c) => tiers[c.ticker] === 'legendary')!.ticker;
    const bottom = STOCKS.find((c) => tiers[c.ticker] === 'common')!.ticker;
    const dp = (t: string) => ({ buys: { [t]: buy(200) } });
    expect(dailyMissionProgress(m, dp(top), ctxOf(held(top), prices)).complete).toBe(true);
    expect(dailyMissionProgress(m, dp(bottom), ctxOf(held(bottom), prices)).complete).toBe(false);
  });
});

describe('new weekly missions', () => {
  const thisWeek = (shares: number) => ({
    eligible: 0,
    pending: [{ shares, availableAt: REOPEN + HOUR + DIVIDEND_HOLD_MS }],
  });
  const many = (tickers: string[], price: number) => ({
    prices: Object.fromEntries(tickers.map((t) => [t, price])),
    holdings: Object.fromEntries(tickers.map((t) => [t, 10])),
    holdingCohorts: Object.fromEntries(tickers.map((t) => [t, thisWeek(10)])),
  });

  it('Opening Bell: a buy or a sell in the opening window', () => {
    expect(weeklyMissionProgress(OPENING_BELL, { auctionBuys: { [S1]: buy(200) } }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(OPENING_BELL, { auctionSold: { shares: 2, value: 10 } }, ctxOf({}, {})).complete).toBe(
      true,
    );
    expect(weeklyMissionProgress(OPENING_BELL, { auctionSoldValue: 150 }, ctxOf({}, {})).complete).toBe(true);
    const none = weeklyMissionProgress(OPENING_BELL, {}, ctxOf({}, {}));
    expect(none.complete).toBe(false);
    expect(none.note).toBeTruthy();
  });

  it('Opening Bell: the first 24 hours after the reopen count too', () => {
    const start = missionWeekStartMs(Date.parse('2026-10-29T22:00:00Z'));
    expect(inOpeningDay(start + 60 * 1000)).toBe(true);
    expect(inOpeningDay(start + 23.9 * 3600 * 1000)).toBe(true);
    expect(inOpeningDay(start + 24 * 3600 * 1000)).toBe(false);
    expect(inOpeningDay(start - 60 * 1000)).toBe(false);
  });

  it('week moves count from before the chapter review', () => {
    const now = Date.parse('2026-10-22T22:00:00Z');
    const start = missionWeekStartMs(now);
    const base = { player: {}, prices: {}, weekOpenPrices: { GWON: 13.25, HANT: 13.19 }, now };
    const lock = { prices: { GWON: 15.69 }, savedAt: start - 8 * 3600 * 1000 };
    expect(weekMovePrices({ ...base, haltPrices: lock })).toEqual({ GWON: 15.69, HANT: 13.19 });
    // Last week's lock, or none, falls back to the reopen prices.
    expect(weekMovePrices({ ...base, haltPrices: { ...lock, savedAt: start - 7 * DAY } })).toEqual(base.weekOpenPrices);
    expect(weekMovePrices(base)).toEqual(base.weekOpenPrices);
  });

  it('Beat the Market: up, and by more than the index', () => {
    const m = WEEKLY_MISSIONS.BEAT_THE_MARKET!;
    const open = Object.fromEntries(STOCKS.map((c) => [c.ticker, c.basePrice]));
    const up2 = Object.fromEntries(STOCKS.map((c) => [c.ticker, c.basePrice * 1.02]));
    const down5 = Object.fromEntries(STOCKS.map((c) => [c.ticker, c.basePrice * 0.95]));
    expect(indexMovePct(open, up2)).toBeCloseTo(2);
    const wp = { startPortfolioValue: 10000 };
    const at = (value: number, prices: Record<string, number>) =>
      weeklyMissionProgress(m, wp, ctxOf({ portfolioValue: value }, prices, undefined, { weekOpenPrices: open }));
    expect(at(10300, up2).complete).toBe(true);
    expect(at(10100, up2).complete).toBe(false);
    expect(at(10100, up2).note).toContain('market is up 2.0%');
    // Losing less than the market is still losing.
    expect(at(9800, down5).complete).toBe(false);
  });

  it('Shopping Spree: 5 stocks bought this week', () => {
    const m = WEEKLY_MISSIONS.SHOPPING_SPREE!;
    const bought = (ts: string[]) => ({
      buys: Object.fromEntries(ts.map((t) => [t, { low: 10, shares: 1, value: 10 }])),
    });
    expect(weeklyMissionProgress(m, bought([S1, S2, S3, S4, S5]), ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, bought([S1, S2, S3, S4]), ctxOf({}, {}))).toMatchObject({
      complete: false,
      progress: 4,
    });
    // Before 2026-10-27 the week's buys only show in the lot ledger.
    const { prices, ...player } = many([S1, S2, S3, S4, S5], 20);
    expect(weeklyMissionProgress(m, {}, ctxOf(player, prices)).complete).toBe(true);
  });

  it('Crew Tour: stocks from 3 different crews', () => {
    const m = WEEKLY_MISSIONS.CREW_TOUR!;
    const [a, b, c] = Object.values(CREWS).map((x) => x.members[0]!);
    const wp = (ts: string[]) => ({ buys: Object.fromEntries(ts.map((t) => [t, { shares: 1, value: 10 }])) });
    expect(weeklyMissionProgress(m, wp([a!, b!, c!]), ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, wp([a!, b!]), ctxOf({}, {})).progress).toBe(2);
    // One pick per crew not yet counted.
    const picks = weeklyMissionProgress(m, wp([a!]), ctxOf({}, { [a!]: 10, [b!]: 20, [c!]: 30 })).picks!;
    expect(picks.map((p) => p.ticker).sort()).toEqual([b!, c!].sort());
  });

  it('Flair Tour: 3 from the flair crew, or all of a smaller one', () => {
    const m = WEEKLY_MISSIONS.FLAIR_TOUR!;
    const wp = (ts: string[]) => ({ buys: Object.fromEntries(ts.map((t) => [t, { shares: 1, value: 10 }])) });
    const big = FLAIR_CREWS.J_HIGH!;
    const player = { crew: big.crew, flairCrew: big.id };
    expect(weeklyMissionProgress(m, wp(big.members.slice(0, 3)), ctxOf(player, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, wp(big.members.slice(0, 2)), ctxOf(player, {})).complete).toBe(false);
    const small = FLAIR_CREWS.BLACK_WORKERS!;
    const solo = { crew: small.crew, flairCrew: small.id };
    expect(weeklyMissionProgress(m, wp(small.members), ctxOf(solo, {})).complete).toBe(true);
    const empty = FLAIR_CREWS.RUNAWAY_FAM!;
    const none = weeklyMissionProgress(m, {}, ctxOf({ crew: empty.crew, flairCrew: empty.id }, {}));
    expect(none.complete).toBe(false);
    expect(none.note).toMatch(/no characters/);
  });

  it('Mission Machine counts daily claims', () => {
    const m = WEEKLY_MISSIONS.MISSION_MACHINE!;
    expect(weeklyMissionProgress(m, { dailyClaims: 10 }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, { dailyClaims: 9 }, ctxOf({}, {})).complete).toBe(false);
  });

  it('Fortune Teller: any bet, or any Futures buy', () => {
    const m = WEEKLY_MISSIONS.FORTUNE_TELLER!;
    expect(weeklyMissionProgress(m, { betValue: 20 }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, { futuresBuys: { mk: 15 } }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, {}, ctxOf({}, {})).complete).toBe(false);
  });

  it('Dip Collector: 3 stocks bought 10%+ under the week open, still held', () => {
    const m = WEEKLY_MISSIONS.DIP_COLLECTOR!;
    const tickers = [S1, S2, S3];
    const { prices, ...player } = many(tickers, 20);
    const open = { weekOpenPrices: Object.fromEntries(tickers.map((t) => [t, 25])) };
    const dips = { buys: Object.fromEntries(tickers.map((t) => [t, { low: 22 }])) };
    const ctx = ctxOf(player, prices, undefined, open);
    expect(weeklyMissionProgress(m, dips, ctx).complete).toBe(true);
    const shallow = { buys: { ...dips.buys, [S3]: { low: 23 } } };
    const p = weeklyMissionProgress(m, shallow, ctx);
    expect(p).toMatchObject({ complete: false, progress: 2 });
    expect(p.note).toBe(`Counted so far: ${S1}, ${S2}.`);
    // All three trade 20% under the open now; the two already counted aren't listed again.
    expect(p.picks?.map((x) => x.ticker)).toEqual([S3]);
    expect(p.picks?.[0]?.change).toBeCloseTo(-20);
  });
});
