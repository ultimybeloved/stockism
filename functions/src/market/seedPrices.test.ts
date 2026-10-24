import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import type { Character } from '../shared/characters';

const require = createRequire(import.meta.url);

type Mod = typeof import('./seedPrices');
let planSeeds: Mod['planSeeds'];

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'seed-test' });
  ({ planSeeds } = require('./seedPrices') as Mod);
});

const char = (ticker: string, extra: Partial<Character> = {}) =>
  ({ name: ticker, ticker, basePrice: 40, ...extra }) as Character;

describe('planSeeds', () => {
  it('seeds only unpriced, non-IPO, non-ETF characters at base price', () => {
    const roster = [
      char('OLD'),
      char('NEW', { basePrice: 55 }),
      char('IPO', { ipoRequired: true }),
      char('FUND', { isETF: true }),
    ];
    const plan = planSeeds(roster, { OLD: 12 });
    expect(plan.seeds).toEqual([{ ticker: 'NEW', price: 55 }]);
    expect(plan.orphans).toEqual([]);
  });

  it('reports a priced ticker gone from the roster, the sign of a rename not yet migrated', () => {
    // Rename AAA -> BBB deployed: BBB is in the roster unpriced, AAA still priced.
    const plan = planSeeds([char('BBB')], { AAA: 30 });
    expect(plan.seeds).toEqual([{ ticker: 'BBB', price: 40 }]);
    expect(plan.orphans).toEqual(['AAA']);
  });

  it('has nothing to do when every character is priced', () => {
    expect(planSeeds([char('A'), char('B')], { A: 1, B: 2 })).toEqual({ seeds: [], orphans: [] });
  });
});
