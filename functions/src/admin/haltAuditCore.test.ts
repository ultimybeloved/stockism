import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { auditHaltWindow, haltWindowOn } = require('./haltAuditCore') as typeof import('./haltAuditCore');

// Thursday 8 Oct 2026: halt 13:00 to 21:00 UTC.
const { start, end } = haltWindowOn(Date.UTC(2026, 9, 8, 21, 5));
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 8, h, m, s);

describe('haltWindowOn', () => {
  it('is 13:00 to 21:00 UTC on that day', () => {
    expect(start).toBe(at(13, 0));
    expect(end).toBe(at(21, 0));
  });
});

describe('auditHaltWindow', () => {
  it('passes a halt where every move is tagged', () => {
    const live = {
      MONO: [
        { timestamp: at(12, 59), price: 1 },
        { timestamp: at(15, 0), price: 2, source: 'admin_adjust' },
        { timestamp: at(20, 56, 7), price: 3, source: 'pre_market_auction' },
        { timestamp: at(20, 56, 14), price: 2.9, source: 'open_stop_loss' },
        { timestamp: at(21, 3), price: 3.1 },
      ],
    };
    const audit = auditHaltWindow(live, null, start, end);
    expect(audit.untagged).toEqual([]);
    expect(audit.bySource).toEqual({ admin_adjust: 1, pre_market_auction: 1, open_stop_loss: 1 });
  });

  it('groups untagged points by the write they came from', () => {
    const live = {
      AAA: [{ timestamp: at(16, 0), price: 1 }],
      BBB: [{ timestamp: at(16, 0), price: 1 }],
      CCC: [{ timestamp: at(18, 0), price: 1 }],
    };
    expect(auditHaltWindow(live, null, start, end).untagged).toEqual([
      { at: at(16, 0), tickers: ['AAA', 'BBB'] },
      { at: at(18, 0), tickers: ['CCC'] },
    ]);
  });

  it("stitches this halt's stashed review detail back in over the collapsed point", () => {
    const live = { AAA: [{ timestamp: at(20, 54), price: 5, source: 'review', collapsed: true }] };
    const stash = { windowEnd: end, detail: { AAA: [{ timestamp: at(14, 0), price: 4 }] } };
    const audit = auditHaltWindow(live, stash, start, end);
    expect(audit.bySource).toEqual({ UNTAGGED: 1 });
    expect(audit.untagged).toEqual([{ at: at(14, 0), tickers: ['AAA'] }]);
  });

  it("ignores a stash from another week's halt", () => {
    const stash = { windowEnd: end - 7 * 864e5, detail: { AAA: [{ timestamp: at(14, 0), price: 4 }] } };
    expect(auditHaltWindow({}, stash, start, end).total).toBe(0);
  });
});
