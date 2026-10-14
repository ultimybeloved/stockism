import { describe, it, expect } from 'vitest';
import { eventPositionsValue, lmsrBuyCost, lmsrSellRefund } from './lmsr';
import { welcomeClaim, welcomeTrack, discordCreatedAtMs, WELCOME_STREAK_TOTAL } from './welcome';

const B = 1000;
const open = { id: 'm1', type: 'event', outcomes: ['Yes', 'No'], q: [100, 0], b: B };

describe('eventPositionsValue', () => {
  it('values an open position at what selling it back would pay', () => {
    const v = eventPositionsValue({ m1: { shares: { Yes: 100 }, costBasis: 60 } }, [open]);
    expect(v).toBeCloseTo(lmsrSellRefund([100, 0], B, 0, 100), 1);
    // Never more than buying it cost: no free value from the round trip.
    expect(v).toBeLessThanOrEqual(lmsrBuyCost([0, 0], B, 0, 100) + 0.01);
  });

  it('sells both sides one after the other', () => {
    const market = { ...open, q: [50, 50] };
    const v = eventPositionsValue({ m1: { shares: { Yes: 50, No: 50 } } }, [market]);
    const first = lmsrSellRefund([50, 50], B, 0, 50);
    const second = lmsrSellRefund([0, 50], B, 1, 50);
    expect(v).toBeCloseTo(first + second, 1);
  });

  it('a resolved market is worth its payout, a cancelled one its refund', () => {
    const resolved = { ...open, resolved: true, outcome: 'Yes' };
    expect(eventPositionsValue({ m1: { shares: { Yes: 30, No: 5 } } }, [resolved])).toBe(30);
    const cancelled = { ...open, cancelled: true };
    expect(eventPositionsValue({ m1: { shares: { Yes: 30 }, costBasis: 17 } }, [cancelled])).toBe(17);
  });

  it('skips settled positions and unknown markets', () => {
    expect(eventPositionsValue({ m1: { shares: { Yes: 10 }, settled: true } }, [open])).toBe(0);
    expect(eventPositionsValue({ gone: { shares: { Yes: 10 } } }, [open])).toBe(0);
  });
});

describe('welcome week', () => {
  it('pays day 1 to 7 once each, then stops', () => {
    let state: { day: number; lastClaimDay: string | null } | null = null;
    let total = 0;
    for (let d = 1; d <= 7; d++) {
      const claim = welcomeClaim(state, `2026-10-${10 + d}`);
      expect(claim.ok).toBe(true);
      if (claim.ok) {
        total += claim.reward;
        state = { day: claim.day, lastClaimDay: `2026-10-${10 + d}` };
      }
    }
    expect(total).toBe(WELCOME_STREAK_TOTAL);
    expect(welcomeClaim(state, '2026-10-30')).toEqual({ ok: false, reason: 'done' });
  });

  it('refuses a second claim the same day, and a gap only pauses', () => {
    expect(welcomeClaim({ day: 2, lastClaimDay: '2026-10-14' }, '2026-10-14')).toEqual({
      ok: false,
      reason: 'claimed_today',
    });
    const later = welcomeClaim({ day: 2, lastClaimDay: '2026-10-01' }, '2026-10-14');
    expect(later.ok && later.day).toBe(3);
  });

  it('reads a Discord account age from its ID', () => {
    // Discord's own documented example ID, created 2016-04-30.
    expect(new Date(discordCreatedAtMs('175928847299117063')).toISOString().slice(0, 10)).toBe('2016-04-30');
    expect(welcomeTrack(3)).toBe('■■■□□□□');
  });
});
