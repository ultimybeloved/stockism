import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { recapLines } = require('./weeklyRecap') as typeof import('./weeklyRecap');
const { computeWeeklyRecap } = require('../shared/rules/weeklyRecap') as typeof import('../shared/rules/weeklyRecap');
const { CHARACTERS } = require('../shared/characters') as typeof import('../shared/characters');

const T = CHARACTERS.find((c) => !c.isETF)!.ticker;
const base = {
  weekId: '2026-10-22',
  netWorth: 11500,
  grantedValue: 1300,
  holdings: { [T]: 10 },
  crew: 'ALLIED',
  qualified: true,
  rivalry: { won: true, opponents: ['HOSTEL'] },
  openPrices: { [T]: 100 },
  prices: { [T]: 110 },
};
const crewName = (id: string) => (id === 'ALLIED' ? 'Allied' : 'Hostel');
const buildWeeklyRecap = (input: Parameters<typeof computeWeeklyRecap>[0]) => {
  const recap = computeWeeklyRecap(input);
  return recap && recapLines(recap, crewName);
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

  it('stores only what the card draws', () => {
    const recap = computeWeeklyRecap({
      ...base,
      rivalry: { won: false, opponents: ['HOSTEL'], score: 3 } as never,
      wp: {
        startPortfolioValue: 10000,
        startGrantedValue: 1000,
        tradingDays: { '2026-10-23': true, '2026-10-24': true },
        checkinDays: { '2026-10-23': true },
      },
    })!;
    expect(recap).toMatchObject({ weekId: '2026-10-22', missions: 0 });
    expect(recap.tradingDays).toEqual(['2026-10-23', '2026-10-24']);
    expect(recap.checkinDays).toEqual(['2026-10-23']);
    expect(recap.rivalry).toEqual({ crew: 'ALLIED', opponents: ['HOSTEL'], won: false, qualified: true });
  });
});
