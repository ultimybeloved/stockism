import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setDelayedOpenAt,
  isLateOpenPending,
  isWeeklyHalt,
  isPreMarketWindow,
  isPreMarketLockout,
  getWeeklyHaltPhase,
  getMostRecentHaltWindow,
  getMarketClosedState,
  getNextMarketOpen,
} from './marketHours';

// 2026-01-01 is a Thursday. A late open two hours after the usual 21:00.
const OPEN = Date.parse('2026-01-01T23:00:00Z');
const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  setDelayedOpenAt(null);
  vi.useRealTimers();
});

describe('a late open', () => {
  it('keeps the market closed past 21:00 and moves the queue to 22:30', () => {
    setDelayedOpenAt(OPEN);
    at('2026-01-01T21:30:00Z');
    expect(isWeeklyHalt()).toBe(true);
    expect(isPreMarketWindow()).toBe(false);
    expect(getWeeklyHaltPhase()?.phase).toBe('closed');
    expect(getWeeklyHaltPhase()?.msToNext).toBe(60 * 60 * 1000);

    at('2026-01-01T22:40:00Z');
    expect(isPreMarketWindow()).toBe(true);
    expect(getWeeklyHaltPhase()?.phase).toBe('queue');
    expect(getMarketClosedState({ marketHalted: true }).preMarket).toBe(true);

    at('2026-01-01T22:57:00Z');
    expect(isPreMarketLockout()).toBe(true);

    at('2026-01-01T23:00:00Z');
    expect(isWeeklyHalt()).toBe(false);
    expect(isLateOpenPending()).toBe(false);
  });

  it('has no effect on the usual queue time before it', () => {
    setDelayedOpenAt(OPEN);
    at('2026-01-01T20:40:00Z');
    expect(isPreMarketWindow()).toBe(false);
    expect(isWeeklyHalt()).toBe(true);
  });

  it('moves the Review tab window with the open', () => {
    setDelayedOpenAt(OPEN);
    at('2026-01-03T12:00:00Z');
    const w = getMostRecentHaltWindow();
    expect(w.end).toBe(OPEN);
    expect(w.reviewEnd).toBe(OPEN - 5 * 60 * 1000);
  });

  it('says when the market opens', () => {
    setDelayedOpenAt(OPEN);
    at('2026-01-01T21:30:00Z');
    expect(getNextMarketOpen().getTime()).toBe(OPEN);
  });

  it('is ignored on other weeks', () => {
    setDelayedOpenAt(OPEN);
    at('2026-01-08T20:40:00Z');
    expect(isPreMarketWindow()).toBe(true);
    expect(getMostRecentHaltWindow().end).toBe(Date.parse('2026-01-08T21:00:00Z'));
  });
});
