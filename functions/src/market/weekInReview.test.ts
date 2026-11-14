import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { weekInReviewEmbed } = require('./weekInReview') as typeof import('./weekInReview');

const icon = (name: string) => `:${name}:`;
const crewLabel = (id: string) => `crew ${id}`;
const mover = (ticker: string, change: number) => ({ ticker, price: 110, priceWeekAgo: 100, change });
const base = {
  weekEndUnix: 1795122600,
  trades: 1234,
  volume: 456789.4,
  activePlayers: 118,
  activeWindowDays: 7,
  gainers: [mover('AAA', 30), mover('BBB', 20), mover('CCC', 10), mover('DDD', 5)],
  losers: [mover('ZZZ', -12)],
  climbers: [{ name: 'Small_Fry', percent: 41.26 }],
  portfolios: [{ name: 'Whale', worth: 1234567.8 }],
  rivalryWinners: ['ALLIED'],
  recruiters: [{ name: 'Boss_Man', total: 1 }],
  featured: { name: 'Gold Frame', price: 100000, salePrice: 75000 },
};
const field = (embed: ReturnType<typeof weekInReviewEmbed>, title: string) =>
  embed.fields.find((f) => f.name.includes(title))?.value;

describe('week in review', () => {
  it('tells the whole week in one embed', () => {
    const embed = weekInReviewEmbed(base, icon, crewLabel);
    expect(embed.description).toContain('<t:1795122600:D>');
    expect(field(embed, 'Stocks That Ran')!.split('\n')).toHaveLength(3);
    expect(field(embed, 'Stocks That Ran')).toContain('**AAA** $100.00 → $110.00 (+30.0%)');
    expect(field(embed, 'Stocks That Fell')).toContain('(-12.0%)');
    expect(field(embed, 'Top Climbers')).toBe('1. **Small_Fry** +41.3%');
    expect(field(embed, 'Top Portfolios')).toBe(':rank1: **Whale** $1,234,568');
    expect(field(embed, 'Rivalry Winners')).toBe('crew ALLIED');
    expect(field(embed, 'Recruiters This Week')).toBe('**Boss_Man** (1 recruit so far)');
    expect(field(embed, 'Featured in the Shop')).toContain('$75,000 (normally $100,000)');
    expect(field(embed, 'The Week in Numbers')).toContain('1,234 trades, $456,789 traded, and 118 players');
  });

  it('leaves out sections with nothing to say', () => {
    const quiet = { ...base, gainers: [], climbers: [], rivalryWinners: [], recruiters: [], featured: null };
    const embed = weekInReviewEmbed(quiet, icon, crewLabel);
    expect(field(embed, 'Stocks That Ran')).toBe('None');
    for (const gone of ['Top Climbers', 'Rivalry Winners', 'Recruiters This Week', 'Featured in the Shop'])
      expect(field(embed, gone)).toBeUndefined();
  });

  it('stays inside Discord field limits', () => {
    const long = {
      ...base,
      recruiters: Array.from({ length: 40 }, (_, i) => ({ name: `Recruiter_Number_${i}`, total: 12 })),
    };
    for (const f of weekInReviewEmbed(long, icon, crewLabel).fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});
