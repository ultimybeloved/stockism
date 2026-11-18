import { describe, expect, it } from 'vitest';
import { exitEquityAt, sideGameCommitted, sideGameLimit, sideGameRoom } from './equity';
import { getLadderChips, getLadderWithdrawable } from './ladder';
import { checkinRewardFor, streakSaverActive, liveCheckinStreak, canBuyStreakSaver } from './economy';

const user = {
  holdings: { AAA: 10 },
  costBasis: { AAA: 100 }, // $1,000 invested
  bets: {
    open: { amount: 200 },
    paid: { amount: 300, paid: true },
    resolved: { amount: 400 },
    gone: { amount: 500 },
  },
  eventPositions: { m1: { costBasis: 150 }, m2: { costBasis: 999, settled: true }, m3: { costBasis: -5 } },
};
const predictions = [{ id: 'open' }, { id: 'paid' }, { id: 'resolved', resolved: true }, { id: 'm1', type: 'event' }];

describe('side-game shared cap', () => {
  it('adds own ladder money, open weekly bets and unsettled long-term positions', () => {
    // 100 ladder + 200 open bet + 150 event; paid, resolved, deleted and settled don't count
    expect(sideGameCommitted(user, predictions, 100)).toBe(450);
  });
  it('the limit is what the stocks would sell for, not what was paid, and ignores cash', () => {
    const sell = exitEquityAt({ holdings: { AAA: 10 } }, { AAA: 300 });
    expect(sell).toBeGreaterThan(1000); // the stock tripled since it was bought at $100
    expect(sell).toBeLessThan(3000); // selling pushes the price down
    expect(sideGameLimit({ ...user, cash: 50_000 }, { AAA: 300 })).toBe(sell);
  });
  it('margin debt comes off the limit, never below zero', () => {
    const sell = sideGameLimit(user, { AAA: 300 });
    expect(sideGameLimit({ ...user, marginUsed: 500 }, { AAA: 300 })).toBeCloseTo(sell - 500, 2);
    expect(sideGameLimit({ ...user, marginUsed: 1e9 }, { AAA: 300 })).toBe(0);
  });
  it('room is the limit minus what is committed, never negative', () => {
    const limit = sideGameLimit(user, { AAA: 300 });
    expect(sideGameRoom(user, predictions, 100, { AAA: 300 })).toBeCloseTo(limit - 450, 2);
    expect(sideGameRoom(user, predictions, 1e7, { AAA: 300 })).toBe(0);
    expect(sideGameRoom(user, predictions, 0, null)).toBe(0); // no prices, no room
  });
  it('a cancelled prediction stops counting', () => {
    expect(sideGameCommitted(user, [{ id: 'open', cancelled: true }], 0)).toBe(150);
  });
});

describe('ladder house chips', () => {
  it("an old doc with no chip record has no chips: the old welcome stake is the player's", () => {
    expect(getLadderChips({ balance: 500 })).toBe(0);
    expect(getLadderWithdrawable({ balance: 500 })).toBe(500);
  });
  it('a tracked doc keeps its own chip count, zero included', () => {
    expect(getLadderWithdrawable({ balance: 500, nonWithdrawable: 0, chipsMigrated: true })).toBe(500);
    expect(getLadderWithdrawable(null)).toBe(0);
  });
});

describe('streak saver', () => {
  it('pays the climbing ladder without it and the top reward with it', () => {
    expect(checkinRewardFor(1)).toBe(300);
    expect(checkinRewardFor(3)).toBe(350);
    expect(checkinRewardFor(30)).toBe(500);
    expect(checkinRewardFor(1, true)).toBe(500);
  });
  it('is active while permanent or before it runs out', () => {
    expect(streakSaverActive({ streakSaverPermanent: true }, 10)).toBe(true);
    expect(streakSaverActive({ streakSaverUntil: 20 }, 10)).toBe(true);
    expect(streakSaverActive({ streakSaverUntil: 5 }, 10)).toBe(false);
    expect(streakSaverActive({}, 10)).toBe(false);
  });
});

describe('streak saver eligibility', () => {
  it('needs a live 7-day streak, unless a saver is already running', () => {
    expect(liveCheckinStreak(9, '2026-10-12', '2026-10-12')).toBe(9);
    expect(liveCheckinStreak(9, '2026-10-11', '2026-10-12')).toBe(9);
    expect(liveCheckinStreak(9, '2026-10-10', '2026-10-12')).toBe(0); // missed a day
    expect(liveCheckinStreak(9, '2026-09-30', '2026-10-01')).toBe(9); // across a month end
    expect(canBuyStreakSaver(6, false)).toBe(false);
    expect(canBuyStreakSaver(7, false)).toBe(true);
    expect(canBuyStreakSaver(0, true)).toBe(true);
  });
});
