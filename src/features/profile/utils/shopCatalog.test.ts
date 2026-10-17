import { describe, it, expect } from 'vitest';
import { COSMETICS } from '../../../constants/cosmetics';
import { BACKDROP_LAYERS, GLOW_LAYERS } from '../../../constants/cosmeticLayers';
import { BD_MARKUP, FX_MARKUP } from '../../../constants/cosmeticMarkup';
import { classicsNote, glowTwin, searchShop, shelfOf, shopItems, shopPins } from './shopCatalog';

const classics = (type: Parameters<typeof shopItems>[0]) =>
  shopItems(type).filter((c) => shelfOf(c.price) === 'classics');

describe('shop shelves', () => {
  it('sorts each price into its shelf', () => {
    expect(shelfOf(250000)).toBe('showcase');
    expect(shelfOf(100000)).toBe('showcase');
    expect(shelfOf(99999)).toBe('premium');
    expect(shelfOf(30000)).toBe('premium');
    expect(shelfOf(29999)).toBe('classics');
  });

  it('lists a category most expensive first, without season rewards or pulsing twins', () => {
    const glows = shopItems('rowGlow');
    expect(glows[0]!.id).toBe('glow_overcome');
    expect(glows.some((c) => c.id.startsWith('glow_pulse_'))).toBe(false);
    expect(shopItems('rowFrame').some((c) => c.earned)).toBe(false);
    const prices = glows.map((c) => c.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('every classic glow has a pulsing twin and back', () => {
    for (const c of classics('rowGlow')) {
      const twin = glowTwin(c.id);
      expect(twin?.id, c.id).toMatch(/^glow_pulse_/);
      expect(glowTwin(twin!.id)?.id).toBe(c.id);
    }
  });

  it('the Classics note reads the real prices', () => {
    expect(classicsNote(classics('nameColor'), 'nameColor')).toBe('$5k each.');
    expect(classicsNote(classics('rowGlow'), 'rowGlow')).toBe('Up to $10k.');
    expect(classicsNote(classics('rowBackdrop'), 'rowBackdrop')).toBe('$5k each. Comes with both Fade and Solid.');
    expect(classicsNote(classics('rowFrame'), 'rowFrame')).toBe('$5k each.');
  });

  it('search lists every kind together, most expensive first', () => {
    const gold = searchShop('gold');
    const names = gold.map((e) => e.item.name);
    expect(names).toEqual(expect.arrayContaining(['Gold Rush', 'Gold Mongkol', 'Gold', 'Golden Aura', 'Pulsing Gold']));
    const prices = gold.map((e) => e.item.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(searchShop('effect').every((e) => e.kind === 'cosmetic' && e.item.type === 'rowGlow')).toBe(true);
    expect(searchShop('   ')).toEqual([]);
  });

  it('the new pins are on sale, most expensive first', () => {
    expect(shopPins().map((p) => p.id)).toEqual([
      'black_card',
      'ui_eye',
      'mongkol_gold',
      'newsboy_cap',
      'polycoria',
      'shiba',
      'mongkol_red',
    ]);
  });
});

describe('effect layers', () => {
  it('every layered cosmetic exists and has its markup', () => {
    for (const [id, key] of Object.entries(GLOW_LAYERS)) {
      expect(COSMETICS.find((c) => c.id === id)?.type, id).toBe('rowGlow');
      expect(FX_MARKUP[key], id).toBeDefined();
    }
    for (const [id, key] of Object.entries(BACKDROP_LAYERS)) {
      expect(COSMETICS.find((c) => c.id === id)?.type, id).toBe('rowBackdrop');
      if (key && key !== 'terminal') expect(BD_MARKUP[key], id).toBeDefined();
    }
  });
});
