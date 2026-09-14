import { describe, it, expect } from 'vitest';
import { DEFAULT_SEASON_RULES, seasonRulesFor, seasonTierRule, nextSeasonTier } from './seasons';

describe('seasonRulesFor', () => {
  it('uses the defaults when a season carries no rules', () => {
    expect(seasonRulesFor(null)).toEqual({ ...DEFAULT_SEASON_RULES });
    expect(seasonRulesFor({})).toEqual({ ...DEFAULT_SEASON_RULES });
  });

  it('prefers the rules a season was started with', () => {
    expect(seasonRulesFor({ rules: { platinumTopShare: 0.2 } }).platinumTopShare).toBe(0.2);
    expect(seasonRulesFor({ rules: { platinumTopShare: 0.2 } }).diamondTopShare).toBe(DEFAULT_SEASON_RULES.diamondTopShare);
  });
});

describe('seasonTierRule', () => {
  it('spells out the numbers each tier needs', () => {
    expect(seasonTierRule('platinum')).toContain('top 15%');
    const diamond = seasonTierRule('diamond');
    expect(diamond).toContain('5%');
    expect(diamond).toContain('75%');
    expect(diamond).toContain('60%');
    expect(seasonTierRule('bronze')).toContain('2 weeks');
  });

  it('follows the season\'s own rules', () => {
    expect(seasonTierRule('platinum', seasonRulesFor({ rules: { platinumTopShare: 0.1 } }))).toContain('top 10%');
  });

  it('has no dashes in the player-facing wording', () => {
    for (const id of ['bronze', 'silver', 'gold', 'platinum', 'diamond']) {
      expect(seasonTierRule(id)).not.toMatch(/[—–]/);
    }
  });

  it('returns nothing for an unknown tier', () => {
    expect(seasonTierRule('mythic')).toBe('');
  });
});

describe('nextSeasonTier', () => {
  it('walks up the ladder and stops at the top', () => {
    expect(nextSeasonTier(null).id).toBe('bronze');
    expect(nextSeasonTier('gold').id).toBe('platinum');
    expect(nextSeasonTier('diamond')).toBeNull();
  });
});
