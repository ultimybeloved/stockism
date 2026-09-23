import { describe, it, expect, afterEach } from 'vitest';
import { marketTimes, formatDateTime, localWeeklyRange } from './localTime';

// Node reads process.env.TZ on each Date operation, so each test can be a
// player somewhere else. en-US output is what the test machine renders.
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

describe('market times in the viewer\'s zone', () => {
  it('Chicago: the Thursday halt is a daytime window', () => {
    process.env.TZ = 'America/Chicago';
    const t = marketTimes();
    expect(t.halt).toMatch(/^Thu 8:00\sAM–4:00\sPM C[DS]T$/);
    expect(t.reopenTime).toMatch(/^4:00\sPM C[DS]T$/);
    expect(t.preMarket).toMatch(/^Thu 3:30\sPM–3:55\sPM C[DS]T$/);
  });

  it('Tokyo: the halt crosses midnight, so both days are named', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(marketTimes().halt).toMatch(/^Thu 10:00\sPM – Fri 6:00\sAM GMT\+9$/);
    expect(marketTimes().reopen).toMatch(/^Fri 6:00\sAM GMT\+9$/);
  });

  it('UTC viewers see the game\'s own clock', () => {
    process.env.TZ = 'UTC';
    expect(marketTimes().halt).toMatch(/^Thu 1:00\sPM–9:00\sPM UTC$/);
  });

  it('any timestamp: the $GUN shorts were Sunday evening in Chicago, Monday in UTC', () => {
    const shorts = Date.UTC(2026, 8, 21, 3, 19);
    process.env.TZ = 'America/Chicago';
    expect(formatDateTime(shorts)).toMatch(/Sep 20, 10:19\sPM CDT/);
    process.env.TZ = 'UTC';
    expect(formatDateTime(shorts)).toMatch(/Sep 21, 3:19\sAM UTC/);
    expect(formatDateTime(NaN)).toBe('');
  });

  it('ranges follow daylight saving from the real upcoming date', () => {
    process.env.TZ = 'America/New_York';
    expect(localWeeklyRange(780, 1260)).toMatch(/^Thu (9|8):00\sAM–(5|4):00\sPM E[DS]T$/);
  });
});
