import { describe, it, expect } from 'vitest';
import { getCosmeticStyles } from './cosmetics';

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
});
