import { describe, it, expect } from 'vitest';
import { filterHoldings, sortHoldings } from './shared';

const items = [
  { ticker: 'KTAE', shares: 5, value: 3000, character: { name: 'Kitae Kim' } },
  { ticker: 'GUN', shares: 20, value: 1700, character: { name: 'Gun Park' } },
  { ticker: 'DG', shares: 1, value: 85, character: { name: 'James Lee' } },
];

describe('filterHoldings', () => {
  it('returns all items for an empty query', () => {
    expect(filterHoldings(items, '')).toHaveLength(3);
    expect(filterHoldings(items, '   ')).toHaveLength(3);
  });

  it('matches on ticker (case-insensitive)', () => {
    const r = filterHoldings(items, 'gun');
    expect(r).toHaveLength(1);
    expect(r[0].ticker).toBe('GUN');
  });

  it('matches on character name', () => {
    const r = filterHoldings(items, 'kitae');
    expect(r).toHaveLength(1);
    expect(r[0].ticker).toBe('KTAE');
  });

  it('returns nothing when no match', () => {
    expect(filterHoldings(items, 'zzzz')).toHaveLength(0);
  });
});

describe('sortHoldings', () => {
  it('sorts by value desc/asc', () => {
    expect(sortHoldings(items, 'value', 'desc').map(i => i.ticker)).toEqual(['KTAE', 'GUN', 'DG']);
    expect(sortHoldings(items, 'value', 'asc').map(i => i.ticker)).toEqual(['DG', 'GUN', 'KTAE']);
  });

  it('sorts by shares', () => {
    expect(sortHoldings(items, 'shares', 'desc').map(i => i.ticker)).toEqual(['GUN', 'KTAE', 'DG']);
  });

  it('sorts alphabetically by character name', () => {
    expect(sortHoldings(items, 'name', 'asc').map(i => i.character.name)).toEqual(['Gun Park', 'James Lee', 'Kitae Kim']);
    expect(sortHoldings(items, 'name', 'desc').map(i => i.character.name)).toEqual(['Kitae Kim', 'James Lee', 'Gun Park']);
  });

  it('does not mutate the input array', () => {
    const copy = [...items];
    sortHoldings(items, 'value', 'asc');
    expect(items).toEqual(copy);
  });
});
