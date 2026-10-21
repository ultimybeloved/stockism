import { describe, it, expect } from 'vitest';
import { bidProblem, endAfterBid, isOpen, minimumBid, pickBidderNumber } from './auctions';

const live = { status: 'live' as const, startsAt: 0, endsAt: 1_000_000, topBid: null, startingBid: 50_000 };

describe('minimumBid', () => {
  it('starts at the starting bid, then 5% over the top bid', () => {
    expect(minimumBid(live)).toBe(50_000);
    expect(minimumBid({ ...live, topBid: 182_000 })).toBe(191_100);
    expect(minimumBid({ ...live, topBid: 101 })).toBe(107);
  });
});

describe('isOpen', () => {
  it('only between start and end while live', () => {
    expect(isOpen(live, 10)).toBe(true);
    expect(isOpen(live, 1_000_000)).toBe(false);
    expect(isOpen({ ...live, startsAt: 20 }, 10)).toBe(false);
    expect(isOpen({ ...live, status: 'cancelled' }, 10)).toBe(false);
  });
});

describe('endAfterBid', () => {
  const min = 60_000;
  it('leaves the end alone early on, pushes it back late', () => {
    expect(endAfterBid(1_000_000, 0)).toBe(1_000_000);
    expect(endAfterBid(1_000_000, 1_000_000 - 2 * min)).toBe(1_000_000 + 3 * min);
    expect(endAfterBid(1_000_000, 1_000_000 - 5 * min)).toBe(1_000_000);
  });
});

describe('bidProblem', () => {
  it('takes a good bid', () => {
    expect(bidProblem(live, 50_000, 60_000, 0, 10)).toBeNull();
  });
  it('refuses closed auctions, low or odd amounts, and money not there', () => {
    expect(bidProblem(live, 50_000, 60_000, 0, 2_000_000)).toMatch(/ended/);
    expect(bidProblem({ ...live, startsAt: 100 }, 50_000, 60_000, 0, 10)).toMatch(/started/);
    expect(bidProblem(live, 49_999, 60_000, 0, 10)).toMatch(/lowest bid/);
    expect(bidProblem(live, 50_000.5, 60_000, 0, 10)).toMatch(/whole dollars/);
    expect(bidProblem(live, 70_000, 60_000, 0, 10)).toMatch(/cash/);
  });
  it('counts what the bidder already has held when they raise their own bid', () => {
    const mine = { ...live, topBid: 50_000 };
    expect(bidProblem(mine, 60_000, 10_000, 50_000, 10)).toBeNull();
    expect(bidProblem(mine, 60_001, 10_000, 50_000, 10)).toMatch(/cash/);
  });
});

describe('pickBidderNumber', () => {
  it('never repeats a taken number', () => {
    const seq = [0.0, 0.0, 0.5];
    const n = pickBidderNumber([1], () => seq.shift()!);
    expect(n).toBe(500);
  });
});
