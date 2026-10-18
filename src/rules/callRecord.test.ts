import { describe, expect, it } from 'vitest';
import { nextCallRecord, callAccuracy, compareCallRecords } from './callRecord';

const call = (result: 'big' | 'win' | 'push' | 'loss' | 'break', paid = 0) => ({
  weekId: '2026-10-22',
  ticker: 'GUN',
  direction: 'up' as const,
  result,
  paid,
});

describe('call record', () => {
  it('counts results, earnings and streaks', () => {
    let r = nextCallRecord(null, call('win', 500));
    r = nextCallRecord(r, call('big', 1000));
    r = nextCallRecord(r, call('push'));
    r = nextCallRecord(r, call('win', 500));
    expect(r).toMatchObject({ calls: 4, wins: 3, big: 1, pushes: 1, earned: 2000, streak: 3, bestStreak: 3 });
    r = nextCallRecord(r, call('loss'));
    expect(r).toMatchObject({ losses: 1, streak: 0, bestStreak: 3 });
    expect(r.last).toEqual({ weekId: '2026-10-22', ticker: 'GUN', direction: 'up', result: 'loss' });
  });

  it('accuracy leaves pushes and breaks out', () => {
    expect(callAccuracy(null)).toBeNull();
    expect(callAccuracy({ wins: 0, losses: 0, pushes: 3 })).toBeNull();
    expect(callAccuracy({ wins: 2, losses: 1, pushes: 5, breaks: 1 })).toBe(67);
  });

  it('the board ranks right Calls, then accuracy, then best streak', () => {
    const rows = [
      { id: 'a', wins: 3, losses: 3, bestStreak: 1 },
      { id: 'b', wins: 3, losses: 1, bestStreak: 1 },
      { id: 'c', wins: 4, losses: 6, bestStreak: 2 },
      { id: 'd', wins: 3, losses: 1, bestStreak: 3 },
    ];
    expect(rows.sort(compareCallRecords).map((r) => r.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
