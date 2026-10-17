import { describe, it, expect } from 'vitest';
import { getCosmeticStyles, titleTier } from './cosmetics';
import { frameTrend, frameSeed, cleanCosmeticStyle } from '../rules/cosmetics';

describe('getCosmeticStyles', () => {
  it('returns empty styles for no cosmetics', () => {
    const r = getCosmeticStyles({});
    expect(r.nameColor).toBeUndefined();
    expect(r.nameClass).toBe('');
    expect(r.glowColor).toBeUndefined();
    expect(r.backdropColor).toBeUndefined();
    expect(r.rowClass).toBe('');
  });

  it('static cosmetics expose their color; a plain backdrop paints a tint class', () => {
    const r = getCosmeticStyles({ nameColor: 'name_gold', rowGlow: 'glow_gold', rowBackdrop: 'backdrop_royal' });
    expect(r.nameColor).toBe('#F59E0B');
    expect(r.nameClass).toBe('');
    expect(r.glowColor).toBe('#F59E0B');
    expect(r.backdropColor).toBe('#7C3AED');
    expect(r.rowClass).toBe('cos-tint-fade');
    expect(r.rowStyle).toMatchObject({ '--cos-tint': '#7C3AED' });
    expect(r.layers).toEqual({ backdrop: null, glow: null });
  });

  it('the tint style picks Fade or Solid', () => {
    const solid = getCosmeticStyles({ rowBackdrop: 'backdrop_royal' }, null, { style: { tint: 'solid' } });
    expect(solid.rowClass).toBe('cos-tint-solid');
  });

  it('scene backdrops and effects come back as layers on a dark, isolated row', () => {
    const r = getCosmeticStyles({ rowBackdrop: 'backdrop_vault', rowGlow: 'glow_rain' });
    expect(r.layers).toEqual({ backdrop: 'backdrop_vault', glow: 'glow_rain' });
    expect(r.rowClass.split(' ')).toEqual(
      expect.arrayContaining(['cos-row', 'dark', 'cos-busy', 'cos-bd-vault', 'cos-g-rain']),
    );
    expect(r.glowColor).toBeUndefined();
    const fxOnly = getCosmeticStyles({ rowGlow: 'glow_strength' });
    expect(fxOnly.rowClass).toContain('cos-row');
    expect(fxOnly.rowClass).not.toContain('dark');
  });

  it('names that draw their own markup are reported by id', () => {
    const r = getCosmeticStyles({ nameColor: 'name_splitflap' }, null, { style: { flap: 'board' } });
    expect(r.nameId).toBe('name_splitflap');
    expect(r.flapStyle).toBe('board');
    expect(getCosmeticStyles({}).flapStyle).toBe('random');
  });

  it('animated cosmetics expose a CSS class instead of an inline color', () => {
    const r = getCosmeticStyles({ nameColor: 'name_rainbow', rowFrame: 'frame_frost' });
    expect(r.nameColor).toBeUndefined();
    expect(r.nameClass).toBe('cos-name-rainbow');
    expect(r.rowClass).toContain('cos-frame-frost');
  });

  it('combines animated glow and frame classes on the row', () => {
    const r = getCosmeticStyles({ rowGlow: 'glow_pulse_gold', rowFrame: 'frame_frost' });
    expect(r.rowClass).toContain('cos-glow-pulse-gold');
    expect(r.rowClass).toContain('cos-frame-frost');
    expect(r.glowColor).toBeUndefined();
  });

  it('ignores unknown ids gracefully', () => {
    const r = getCosmeticStyles({ nameColor: 'does_not_exist' });
    expect(r.nameColor).toBeUndefined();
    expect(r.nameClass).toBe('');
  });

  it('filters unowned cosmetics when an owned list is provided', () => {
    const r = getCosmeticStyles({ nameColor: 'name_gold', rowBackdrop: 'backdrop_royal' }, ['backdrop_royal']);
    expect(r.nameColor).toBeUndefined(); // name_gold not owned — stripped
    expect(r.backdropColor).toBe('#7C3AED'); // backdrop_royal owned — kept
  });

  it('applies everything when no owned list is provided (pre-filtered server payloads)', () => {
    const r = getCosmeticStyles({ nameColor: 'name_gold' });
    expect(r.nameColor).toBe('#F59E0B');
  });

  it('survives malformed activeCosmetics values', () => {
    expect(() => getCosmeticStyles('junk-string' as never, ['name_gold'])).not.toThrow();
    expect(getCosmeticStyles('junk-string' as never).nameColor).toBeUndefined();
  });
});

describe('frame personalisation', () => {
  it('Bull / Bear trend follows the 24h snapshot', () => {
    expect(frameTrend(110, { value: 100 })).toBe('up');
    expect(frameTrend(90, { value: 100 })).toBe('down');
    expect(frameTrend(100, { value: 100 })).toBeNull();
    expect(frameTrend(100, null)).toBeNull();
    expect(frameTrend(100, { value: 0 })).toBeNull();
  });

  it('seed is stable per name and differs between players', () => {
    expect(frameSeed('Alice')).toEqual(frameSeed('alice'));
    expect(frameSeed('Alice')).not.toEqual(frameSeed('Bob'));
    const { seconds, degrees } = frameSeed('Alice');
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThan(60);
    expect(degrees).toBeGreaterThanOrEqual(0);
    expect(degrees).toBeLessThan(360);
  });

  it('only animated frames get a seed style and trend', () => {
    const framed = getCosmeticStyles({ rowFrame: 'frame_frost' }, null, { seedKey: 'Alice', trend: 'up' });
    expect(framed.rowStyle).toMatchObject({ '--cos-seed': frameSeed('Alice').seconds });
    expect(framed.frameTrend).toBe('up');
    const plain = getCosmeticStyles({ nameColor: 'name_gold' }, null, { seedKey: 'Alice', trend: 'up' });
    expect(plain.rowStyle).toEqual({});
    expect(plain.frameTrend).toBeUndefined();
  });

  it('the Split style shows both halves of Bull / Bear every day', () => {
    const r = getCosmeticStyles({ rowFrame: 'frame_bullbear' }, null, { trend: 'up', style: { bullbear: 'split' } });
    expect(r.frameTrend).toBe('split');
    const daily = getCosmeticStyles({ rowFrame: 'frame_bullbear' }, null, {
      trend: 'up',
      style: { bullbear: 'daily' },
    });
    expect(daily.frameTrend).toBe('up');
  });
});

describe('cleanCosmeticStyle', () => {
  it('keeps known keys with known values and drops everything else', () => {
    expect(cleanCosmeticStyle({ flap: 'scramble', bullbear: 'split', tint: 'solid' })).toEqual({
      flap: 'scramble',
      bullbear: 'split',
      tint: 'solid',
    });
    expect(cleanCosmeticStyle({ flap: 'spin', tint: 7, admin: true })).toEqual({});
    expect(cleanCosmeticStyle('junk')).toEqual({});
    expect(cleanCosmeticStyle(null)).toEqual({});
    expect(cleanCosmeticStyle(['flap'])).toEqual({});
  });
});

describe('titleTier', () => {
  it('reads the season tier off every title id adminEndSeason writes', () => {
    expect(titleTier('preseason_1_diamond')).toBe('diamond');
    expect(titleTier('season_2_platinum')).toBe('platinum');
    expect(titleTier('arc_s1_gold')).toBe('gold');
  });

  it('treats anything else as a plain title', () => {
    expect(titleTier('market_maker')).toBeNull();
    expect(titleTier('diamond_hands')).toBeNull();
    expect(titleTier(undefined)).toBeNull();
  });
});
