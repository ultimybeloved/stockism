import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildWeeklyRecap } = require('./weeklyRecap') as typeof import('./weeklyRecap');
const { CHARACTERS } = require('../shared/characters') as typeof import('../shared/characters');

const T = CHARACTERS.find((c) => !c.isETF)!.ticker;
const base = {
  netWorth: 11500,
  grantedValue: 1300,
  holdings: { [T]: 10 },
  crew: 'ALLIED',
  qualified: true,
  rivalry: { won: true, opponents: ['HOSTEL'] },
  crewName: (id: string) => (id === 'ALLIED' ? 'Allied' : 'Hostel'),
  openPrices: { [T]: 100 },
  prices: { [T]: 110 },
};

describe('weekly recap', () => {
  it('splits trading from rewards and covers missions and the rivalry', () => {
    const lines = buildWeeklyRecap({
      ...base,
      wp: {
        startPortfolioValue: 10000,
        startMarginUsed: 0,
        startGrantedValue: 1000,
        claimed: { A: true, B: true },
        dailyClaims: 9,
      },
    })!;
    expect(lines[0]).toBe('Net worth $11,500: +$1,200 from trading (+12.0%), plus $300 in rewards.');
    expect(lines[1]).toContain(`($${T}) +10.0%`);
    expect(lines[2]).toBe('Missions finished: 11.');
    expect(lines[3]).toBe('Allied beat Hostel, and you finished your 5.');
  });

  it('says nothing without a starting value, and reports a loss plainly', () => {
    expect(buildWeeklyRecap({ ...base, wp: {} })).toBeNull();
    const lines = buildWeeklyRecap({
      ...base,
      netWorth: 9000,
      grantedValue: 1000,
      rivalry: null,
      prices: { [T]: 100 },
      wp: { startPortfolioValue: 10000, startGrantedValue: 1000 },
    })!;
    expect(lines).toEqual(['Net worth $9,000: -$1,000 from trading (-10.0%).']);
  });
});
