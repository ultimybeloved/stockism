import { describe, it, expect } from 'vitest';
import { sharePath, sharePrices } from './sharePrices';
import { inviteLink } from '../../../rules/recruiting';

const HOUR = 3600000;
const at = (hoursAgo: number, price: number) => ({ timestamp: Date.now() - hoursAgo * HOUR, price });

describe('sharePrices', () => {
  it('starts at the price when the range opened and ends at the live price', () => {
    const history = [at(60, 5), at(30, 10), at(12, 20), at(1, 30)];
    expect(sharePrices(history, 24, 31)).toEqual([10, 20, 30, 31]);
  });

  it('uses the whole history for all time', () => {
    expect(sharePrices([at(900, 1), at(1, 2)], Infinity, 3)).toEqual([1, 2, 3]);
  });

  it('draws a flat line when there is no history', () => {
    expect(sharePrices([], 24, 7)).toEqual([7, 7]);
  });

  it('thins a long history but keeps both ends', () => {
    const history = Array.from({ length: 1000 }, (_, i) => at(20 - i / 100, i));
    const prices = sharePrices(history, 24, 5000, 100);
    expect(prices).toHaveLength(100);
    expect(prices[0]).toBe(0);
    expect(prices[99]).toBe(5000);
  });
});

describe('sharePath', () => {
  it('spans the box, high prices at the top', () => {
    expect(sharePath([1, 3], 100, 50, 5)).toBe('M0.0 45.0 L100.0 5.0');
  });

  it('survives a flat line', () => {
    expect(sharePath([2, 2], 10, 10, 0)).not.toContain('NaN');
  });
});

describe('inviteLink with a page', () => {
  it('points at the page and credits the player', () => {
    expect(inviteLink('Gun', '/stock/GUN')).toBe('https://stockism.app/stock/GUN?ref=Gun');
  });

  it('is the plain address for a guest', () => {
    expect(inviteLink(undefined, '/stock/GUN')).toBe('https://stockism.app/stock/GUN');
  });
});
