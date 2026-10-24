// Missions 2.0: the week clock, the real-trade rules, and every mission check.
import { describe, it, expect } from 'vitest';
import { CREWS, DAILY_MISSIONS, WEEKLY_MISSIONS, getDailyMissions, getWeeklyMissions, OPENING_BELL } from '../crews';
import { CHARACTERS, DIVIDEND_HOLD_MS, computeRarityTiers } from '../characters';
import {
  missionWeekId,
  missionWeekStartMs,
  inOpeningDay,
  auctionWeekId,
  indexMovePct,
  missionMinTrade,
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

describe('real trades', () => {
  it('a trade must be 1% of net worth, $50 to $500', () => {
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

  it('a buy counts while the shares are kept', () => {
    const dp = { buys: { [MINE]: { shares: 4, value: 200, low: 50 } } };
    expect(
      dailyMissionProgress(crewSupport, dp, ctxOf({ crew: crew.id, holdings: { [MINE]: 4 } }, prices)).complete,
    ).toBe(true);
    // Bought and sold back.
    expect(dailyMissionProgress(crewSupport, dp, ctxOf({ crew: crew.id, holdings: {} }, prices)).complete).toBe(false);
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

  it('Spread Out needs 3 different kept buys', () => {
    const buy = { shares: 10, value: 150, low: 15 };
    const dp = { buys: { A: buy, B: buy, C: buy } };
    const m = DAILY_MISSIONS.SPREAD_OUT!;
    expect(dailyMissionProgress(m, dp, ctxOf({ holdings: { A: 10, B: 10, C: 10 } }, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, dp, ctxOf({ holdings: { A: 10, B: 10 } }, {})).progress).toBe(2);
  });

  it('sells count on value sold out of day-old shares', () => {
    const ctx = ctxOf({ holdings: {} }, {});
    expect(dailyMissionProgress(DAILY_MISSIONS.PROFIT_TAKER!, { heldSoldValue: 150 }, ctx).complete).toBe(true);
    expect(dailyMissionProgress(DAILY_MISSIONS.PROFIT_TAKER!, { heldSoldValue: 40 }, ctx).complete).toBe(false);
    expect(dailyMissionProgress(DAILY_MISSIONS.CUT_LOSSES!, { heldSoldValue: 150 }, ctx).complete).toBe(false);
    expect(dailyMissionProgress(DAILY_MISSIONS.CUT_LOSSES!, { heldLossValue: 150 }, ctx).complete).toBe(true);
  });

  it('Order Filled takes a kept limit buy or a limit sell of old shares', () => {
    const m = DAILY_MISSIONS.ORDER_FILLED!;
    const kept = { limitBuys: { A: { shares: 5, value: 200 } } };
    expect(dailyMissionProgress(m, kept, ctxOf({ holdings: { A: 5 } }, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, kept, ctxOf({ holdings: {} }, {})).complete).toBe(false);
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

  it('from the pool change, Crew Majority is gone and Covered goes only to short holders', () => {
    const ids = (holdsShort: boolean) => {
      const seen = new Set<string>();
      for (let d = 1; d <= 28; d++)
        for (let seed = 0; seed < 20; seed++)
          getDailyMissions(`2026-11-${String(d).padStart(2, '0')}`, crew.id, seed, holdsShort).forEach((m) =>
            seen.add(m.id),
          );
      return seen;
    };
    expect(ids(true).has('CREW_MAJORITY')).toBe(false);
    expect(ids(true).has('COVERED')).toBe(true);
    expect(ids(false).has('COVERED')).toBe(false);
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
    expect(weeklyMissionProgress(m, {}, ctxOf({ holdings: { ...even, E: 0.1 } }, p)).complete).toBe(false);
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
  it('Short Seller: a real short, still open', () => {
    const m = DAILY_MISSIONS.SHORT_SELLER!;
    const dp = { shorts: { [S1]: { shares: 5, value: 200 } } };
    expect(dailyMissionProgress(m, dp, ctxOf({ shorts: { [S1]: { shares: 5 } } }, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, dp, ctxOf({ shorts: {} }, {})).complete).toBe(false);
    const tiny = { shorts: { [S1]: { shares: 5, value: 20 } } };
    expect(dailyMissionProgress(m, tiny, ctxOf({ shorts: { [S1]: { shares: 5 } } }, {})).complete).toBe(false);
  });

  it('Covered: profitable cover value of at least the minimum trade', () => {
    const m = DAILY_MISSIONS.COVERED!;
    expect(dailyMissionProgress(m, { coverProfitValue: 100 }, ctxOf({}, {})).complete).toBe(true);
    expect(dailyMissionProgress(m, { coverProfitValue: 99 }, ctxOf({}, {})).complete).toBe(false);
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

  it('Ride the Wave: paid 5%+ over the week open', () => {
    const m = DAILY_MISSIONS.RIDE_THE_WAVE!;
    const open = { weekOpenPrices: { [S1]: 100 } };
    const up = { buys: { [S1]: buy(200, { low: 104, high: 105 }) } };
    const flat = { buys: { [S1]: buy(200, { low: 101, high: 104 }) } };
    expect(dailyMissionProgress(m, up, ctxOf(held(S1), {}, undefined, open)).complete).toBe(true);
    expect(dailyMissionProgress(m, flat, ctxOf(held(S1), {}, undefined, open)).complete).toBe(false);
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

  it('Opening Bell: a kept auction buy or a held-shares auction sell', () => {
    const wpBuy = { auctionBuys: { [S1]: buy(200) } };
    expect(weeklyMissionProgress(OPENING_BELL, wpBuy, ctxOf(held(S1), {})).complete).toBe(true);
    const sold = weeklyMissionProgress(OPENING_BELL, wpBuy, ctxOf({ holdings: {} }, {}));
    expect(sold.complete).toBe(false);
    expect(sold.note).toBeTruthy();
    expect(weeklyMissionProgress(OPENING_BELL, { auctionSoldValue: 150 }, ctxOf({}, {})).complete).toBe(true);
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

  it('Shopping Spree: 5 stocks bought this week and still held', () => {
    const m = WEEKLY_MISSIONS.SHOPPING_SPREE!;
    const { prices, ...player } = many([S1, S2, S3, S4, S5], 20);
    expect(weeklyMissionProgress(m, {}, ctxOf(player, prices)).complete).toBe(true);
    const old = { ...player, holdingCohorts: { ...player.holdingCohorts, [S5]: lot(10, REOPEN + DAY, 3 * DAY) } };
    expect(weeklyMissionProgress(m, {}, ctxOf(old, prices))).toMatchObject({ complete: false, progress: 4 });
  });

  it('Mission Machine counts daily claims', () => {
    const m = WEEKLY_MISSIONS.MISSION_MACHINE!;
    expect(weeklyMissionProgress(m, { dailyClaims: 10 }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, { dailyClaims: 9 }, ctxOf({}, {})).complete).toBe(false);
  });

  it('Fortune Teller: a real bet, or Futures still held', () => {
    const m = WEEKLY_MISSIONS.FORTUNE_TELLER!;
    expect(weeklyMissionProgress(m, { betValue: 100 }, ctxOf({}, {})).complete).toBe(true);
    expect(weeklyMissionProgress(m, { betValue: 20 }, ctxOf({}, {})).complete).toBe(false);
    const wp = { futuresBuys: { mk: 150 } };
    const holding = { eventPositions: { mk: { shares: { yes: 3 } } } };
    expect(weeklyMissionProgress(m, wp, ctxOf(holding, {})).complete).toBe(true);
    const sold = { eventPositions: { mk: { shares: { yes: 0 } } } };
    expect(weeklyMissionProgress(m, wp, ctxOf(sold, {})).complete).toBe(false);
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
    expect(weeklyMissionProgress(m, shallow, ctx)).toMatchObject({ complete: false, progress: 2 });
  });
});
