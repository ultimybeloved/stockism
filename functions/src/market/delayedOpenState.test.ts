import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { delayFor, reviewWindowFor, scheduledReviewWindow, delayedPreMarket, DELAYED_STEPS } =
  require('./delayedOpenState') as typeof import('./delayedOpenState');

const OPEN = Date.parse('2026-01-01T23:00:00Z');
const MIN = 60 * 1000;

describe('late open', () => {
  it('counts only on its own day', () => {
    const market = { delayedOpen: { openAt: OPEN } };
    expect(delayFor(market, Date.parse('2026-01-01T19:00:00Z'))?.openAt).toBe(OPEN);
    expect(delayFor(market, Date.parse('2026-01-08T19:00:00Z'))).toBeNull();
    expect(delayFor({}, Date.parse('2026-01-01T19:00:00Z'))).toBeNull();
  });

  it('moves the review window and the queue with the open', () => {
    expect(reviewWindowFor(OPEN)).toEqual({
      haltStart: Date.parse('2026-01-01T13:00:00Z'),
      haltEnd: OPEN,
      reviewEnd: OPEN - 5 * MIN,
      collapseAt: OPEN - 6 * MIN,
    });
    expect(delayedPreMarket(OPEN)).toEqual({ start: OPEN - 30 * MIN, lock: OPEN - 5 * MIN });
  });

  it('matches the usual schedule with no delay', () => {
    const w = scheduledReviewWindow(Date.parse('2026-01-01T15:00:00Z'));
    expect(w.haltEnd).toBe(Date.parse('2026-01-01T21:00:00Z'));
    expect(w.reviewEnd).toBe(Date.parse('2026-01-01T20:55:00Z'));
    expect(w.collapseAt).toBe(Date.parse('2026-01-01T20:54:00Z'));
  });

  it('runs the steps in their usual order and spacing', () => {
    expect(DELAYED_STEPS.map((s) => s.at)).toEqual([-30, -30, -6, -5, -4, 0, 5, 10, 15]);
  });
});
