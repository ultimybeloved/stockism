import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let decayTarget;
let neglectFloorFraction;
let neglectFloorPrice;
let C;

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'decay-test' });
  ({ decayTarget } = require('./services/neglectDecayRules'));
  ({ neglectFloorFraction, neglectFloorPrice } = require('./helpers'));
  C = require('./constants');
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const char = (over = {}) => ({
  ticker: 'TSTA', name: 'Test', basePrice: 100,
  dateAdded: new Date(NOW - 365 * DAY).toISOString(), ...over,
});

// Neglected by default: last traded well outside the window, nobody short,
// price comfortably above any floor in the band.
const args = (over = {}) => ({
  character: char(),
  price: 100,
  stats: { lastTradedAt: NOW - 30 * DAY, trades: 12 },
  shortInterest: {},
  priceHistory: {},
  now: NOW,
  trackingStartedAt: NOW - 200 * DAY,
  ...over,
});

describe('decays a neglected stock', () => {
  it('steps the price down by the daily rate', () => {
    expect(decayTarget(args())).toBeCloseTo(100 * (1 - C.NEGLECT_DECAY_DAILY_RATE), 2);
  });

  it('always moves down, never up', () => {
    const out = decayTarget(args());
    expect(out).toBeLessThan(100);
  });

  it('treats a stock that has never traded as neglected', () => {
    // A stock that launched and was ignored is exactly the case this exists for.
    expect(decayTarget(args({ stats: undefined }))).toBeLessThan(100);
  });
});

describe('leaves a stock alone when', () => {
  it('it was traded inside the neglect window', () => {
    expect(decayTarget(args({ stats: { lastTradedAt: NOW - 2 * DAY } }))).toBeNull();
  });

  it('it was traded right on the edge of the window', () => {
    expect(decayTarget(args({ stats: { lastTradedAt: NOW - C.NEGLECT_WINDOW_MS + 1000 } }))).toBeNull();
  });

  it('it is brand new and has never traded', () => {
    // dateAdded stands in for a missing lastTradedAt, so a character added
    // yesterday is not decayed on day one.
    expect(decayTarget(args({
      character: char({ dateAdded: new Date(NOW - DAY).toISOString() }),
      stats: undefined,
    }))).toBeNull();
  });

  it('somebody is short it', () => {
    // The exploit fix: a stock somebody is short is not a neglected stock, so
    // the farm switches off the very thing it was set up to harvest.
    expect(decayTarget(args({
      shortInterest: { TSTA: C.NEGLECT_SHORT_INTEREST_THRESHOLD },
    }))).toBeNull();
  });

  it('short interest sits just under the threshold', () => {
    // A single token share must not be able to freeze a stock's decay.
    expect(decayTarget(args({
      shortInterest: { TSTA: C.NEGLECT_SHORT_INTEREST_THRESHOLD - 1 },
    }))).toBeLessThan(100);
  });

  it('an admin adjusted its price recently', () => {
    // Automated movers never quietly undo a manual decision.
    expect(decayTarget(args({
      priceHistory: { TSTA: [{ timestamp: NOW - DAY, price: 100, source: 'admin_adjust' }] },
    }))).toBeNull();
  });

  it('it is a fund', () => {
    // Funds are priced by their members; decaying one directly double-counts.
    expect(decayTarget(args({ character: char({ isETF: true }) }))).toBeNull();
  });

  it('it has no price', () => {
    expect(decayTarget(args({ price: undefined }))).toBeNull();
    expect(decayTarget(args({ price: 0 }))).toBeNull();
  });
});

describe('the tracking-start floor', () => {
  // Per-ticker trade times only began recording the day this shipped. Without
  // this floor, every stock that had not traded since would be judged on
  // dateAdded and decayed on day one, including ones that traded last week.
  it('does not decay a long-standing stock we have only just started watching', () => {
    expect(decayTarget(args({
      stats: undefined,
      trackingStartedAt: NOW - 2 * DAY,
    }))).toBeNull();
  });

  it('starts decaying once we have watched it for the full window', () => {
    expect(decayTarget(args({
      stats: undefined,
      trackingStartedAt: NOW - (C.NEGLECT_WINDOW_MS + DAY),
    }))).toBeLessThan(100);
  });

  it('still respects a real recorded trade over the tracking floor', () => {
    expect(decayTarget(args({
      stats: { lastTradedAt: NOW - DAY },
      trackingStartedAt: NOW - 500 * DAY,
    }))).toBeNull();
  });

  it('uses the later of dateAdded and tracking start', () => {
    // A character added after tracking began is judged from when it was added.
    expect(decayTarget(args({
      character: char({ dateAdded: new Date(NOW - DAY).toISOString() }),
      stats: undefined,
      trackingStartedAt: NOW - 500 * DAY,
    }))).toBeNull();
  });
});

describe('the floor', () => {
  const floorOf = (ticker, trades) => neglectFloorPrice(char({ ticker }), trades);

  it('stops the decay once reached', () => {
    const floor = floorOf('TSTA', 12);
    expect(decayTarget(args({ price: floor }))).toBeNull();
  });

  it('never overshoots below the floor in one step', () => {
    const floor = floorOf('TSTA', 12);
    const out = decayTarget(args({ price: floor * 1.001 }));
    expect(out === null || out >= floor).toBe(true);
  });

  it('does not raise a price that is already under the floor', () => {
    // A recomputed floor landing above the current price must stop the decay,
    // not hand holders a free gain.
    const floor = floorOf('TSTA', 12);
    expect(decayTarget(args({ price: floor * 0.5 }))).toBeNull();
  });

  it('sits inside the configured band', () => {
    for (const t of ['AAA', 'ZZ9', 'GUN', 'YOKO', 'DG']) {
      const f = neglectFloorFraction(t, 3);
      expect(f).toBeGreaterThanOrEqual(C.NEGLECT_FLOOR_MIN);
      expect(f).toBeLessThanOrEqual(C.NEGLECT_FLOOR_MAX);
    }
  });

  it('is stable for the same character and trade count', () => {
    expect(neglectFloorFraction('GUN', 5)).toBe(neglectFloorFraction('GUN', 5));
  });

  it('differs between characters, so one floor does not reveal another', () => {
    const set = new Set(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((t) => neglectFloorFraction(t, 0)));
    expect(set.size).toBeGreaterThan(1);
  });

  it('re-draws when the trade count changes', () => {
    // A character who draws a burst of attention and goes quiet again lands
    // somewhere new rather than returning to the old floor.
    expect(neglectFloorFraction('GUN', 5)).not.toBe(neglectFloorFraction('GUN', 6));
  });

  it('never goes below the hard minimum price', () => {
    expect(neglectFloorPrice(char({ basePrice: 0.01 }), 1)).toBeGreaterThanOrEqual(C.MIN_PRICE);
  });
});

describe('constants are sane', () => {
  it('decays slowly rather than crashing', () => {
    expect(C.NEGLECT_DECAY_DAILY_RATE).toBeGreaterThan(0);
    expect(C.NEGLECT_DECAY_DAILY_RATE).toBeLessThanOrEqual(0.05);
  });

  it('waits at least a week before calling a stock neglected', () => {
    expect(C.NEGLECT_WINDOW_MS).toBeGreaterThanOrEqual(7 * DAY);
  });

  it('needs more than a token share to pause the decay', () => {
    expect(C.NEGLECT_SHORT_INTEREST_THRESHOLD).toBeGreaterThan(1);
  });

  it('keeps the floor band well above zero, so a dead stock can recover', () => {
    expect(C.NEGLECT_FLOOR_MIN).toBeGreaterThan(0);
    expect(C.NEGLECT_FLOOR_MAX).toBeLessThan(1);
    expect(C.NEGLECT_FLOOR_MIN).toBeLessThan(C.NEGLECT_FLOOR_MAX);
  });
});
