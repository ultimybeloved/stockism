// Missions 2.0: the week clock, the real-trade rules, and every mission check.
import { describe, it, expect } from 'vitest';
import { CREWS, DAILY_MISSIONS, WEEKLY_MISSIONS, getDailyMissions, getWeeklyMissions, CALL_MISSION } from '../crews';
import { DIVIDEND_HOLD_MS } from '../characters';
import {
  missionWeekId,
  missionWeekStartMs,
  callPicksOpen,
  missionMinTrade,
  sharesHeldAtLeast,
  scoreCall,
  callReward,
  isCallBreakWeek,
} from './missions';
import {
  dailyMissionProgress,
  weeklyMissionProgress,
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

  it('takes Calls until the end of Saturday', () => {
    expect(callPicksOpen(REOPEN + 1000)).toBe(true);
    expect(callPicksOpen(Date.UTC(2026, 9, 24, 23, 59))).toBe(true);
    expect(callPicksOpen(Date.UTC(2026, 9, 25, 0, 0))).toBe(false);
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
});

describe('weekly missions', () => {
  it('every week is the Call plus one more', () => {
    const list = getWeeklyMissions(null, '2026-10-22');
    expect(list[0]).toBe(CALL_MISSION);
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

describe('Calls', () => {
  it('scores the halt move', () => {
    expect(scoreCall('up', 100, 105)).toBe('win');
    expect(scoreCall('up', 100, 111)).toBe('big');
    expect(scoreCall('down', 100, 89)).toBe('big');
    expect(scoreCall('down', 100, 105)).toBe('loss');
    expect(scoreCall('up', 100, 100.5)).toBe('push');
    expect(scoreCall('up', 0, 100)).toBe('push');
    expect([callReward('big'), callReward('win'), callReward('push'), callReward(null)]).toEqual([1000, 500, 0, 0]);
    expect(callReward('break')).toBe(250);
  });

  it('calls it a chapter break only when no stock moved 1%', () => {
    expect(isCallBreakWeek({ A: 100, B: 50 }, { A: 100.5, B: 50 })).toBe(true);
    expect(isCallBreakWeek({ A: 100, B: 50 }, { A: 100, B: 49 })).toBe(false);
    expect(isCallBreakWeek({ A: 100 }, {})).toBe(true);
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
