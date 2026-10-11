import { describe, it, expect } from 'vitest';
import { getCosmeticStyles } from './cosmetics';
import { frameTrend, frameSeed } from '../rules/cosmetics';

describe('getCosmeticStyles', () => {
  it('returns empty styles for no cosmetics', () => {
    const r = getCosmeticStyles({});
    expect(r.nameColor).toBeUndefined();
    expect(r.nameClass).toBe('');
    expect(r.glowColor).toBeUndefined();
    expect(r.backdropColor).toBeUndefined();
    expect(r.rowClass).toBe('');
  });

  it('static cosmetics expose their color and no class (behavior unchanged)', () => {
    const r = getCosmeticStyles({ nameColor: 'name_gold', rowGlow: 'glow_gold', rowBackdrop: 'backdrop_royal' });
    expect(r.nameColor).toBe('#F59E0B');
    expect(r.nameClass).toBe('');
    expect(r.glowColor).toBe('#F59E0B');
    expect(r.backdropColor).toBe('#7C3AED');
    expect(r.rowClass).toBe('');
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
    expect(framed.frameStyle).toMatchObject({ '--cos-seed': frameSeed('Alice').seconds });
    expect(framed.frameTrend).toBe('up');
    const plain = getCosmeticStyles({ nameColor: 'name_gold' }, null, { seedKey: 'Alice', trend: 'up' });
    expect(plain.frameStyle).toBeUndefined();
    expect(plain.frameTrend).toBeUndefined();
  });
});
