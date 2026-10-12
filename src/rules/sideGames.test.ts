import { describe, expect, it } from 'vitest';
import { sideGameCommitted, sideGameRoom } from './equity';
import { checkinRewardFor, streakSaverActive } from './economy';

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
  it('room is what is invested minus what is committed, never negative', () => {
    expect(sideGameRoom(user, predictions, 100)).toBe(550);
    expect(sideGameRoom(user, predictions, 5000)).toBe(0);
  });
  it('a cancelled prediction stops counting', () => {
    expect(sideGameCommitted(user, [{ id: 'open', cancelled: true }], 0)).toBe(150);
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
