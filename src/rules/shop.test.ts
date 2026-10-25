import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COSMETICS, COSMETIC_MAP } from '../constants/cosmetics';
import {
  BUNDLES,
  NEVER_DISCOUNTED,
  FEATURED_MIN_PRICE,
  bundleQuote,
  featuredCosmeticId,
  featuredPrice,
  shopWeek,
  shopWeekEndsAt,
} from './shop';
import { SEASON_REWARDS, seasonRewardIds } from './seasons';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const priceOf = (id: string) => COSMETIC_MAP[id]?.price;

describe('cosmetic catalogs', () => {
  it('the server catalog matches the shop list item for item', () => {
    const src = readFileSync(join(__dirname, '../../functions/src/shared/constants/cosmetics.ts'), 'utf8');
    const server = Object.fromEntries(
      [
        ...src.matchAll(
          /^\s+([a-z0-9_]+): \{ type: '(\w+)', price: (\d+), name: '((?:[^'\\]|\\.)*)'(, earned: true)? \},$/gm,
        ),
      ].map((m) => [m[1], { type: m[2], price: Number(m[3]), name: m[4]!.replace(/\\'/g, "'"), earned: !!m[5] }]),
    );
    const shop = Object.fromEntries(
      COSMETICS.filter((c) => !c.free).map((c) => [
        c.id,
        { type: c.type, price: c.price, name: c.name, earned: !!c.earned },
      ]),
    );
    expect(server).toEqual(shop);
  });
});

describe('season rewards', () => {
  it('every reward is an earned item, never bundled', () => {
    for (const tiers of Object.values(SEASON_REWARDS)) {
      for (const id of Object.values(tiers)) {
        expect(COSMETIC_MAP[id!]?.earned, id).toBe(true);
        expect(
          BUNDLES.some((b) => b.items.includes(id!)),
          id,
        ).toBe(false);
      }
    }
  });

  it('a tier earns its own reward and every one below it', () => {
    expect(seasonRewardIds('P1', 'bronze')).toEqual(['frame_p1_bronze']);
    expect(seasonRewardIds('P1', 'gold')).toEqual(['frame_p1_bronze', 'frame_p1_silver', 'frame_p1_gold']);
    expect(seasonRewardIds('P1', 'diamond')).toHaveLength(5);
    expect(seasonRewardIds('P1', null)).toEqual([]);
    expect(seasonRewardIds('S9', 'diamond')).toEqual([]);
  });
});

describe('bundles', () => {
  it('every bundle is four real items, one per slot, none of them a top frame', () => {
    for (const b of BUNDLES) {
      const items = b.items.map((id) => COSMETIC_MAP[id]);
      expect(items.every(Boolean), b.id).toBe(true);
      expect(new Set(items.map((c) => c!.type)).size, b.id).toBe(4);
      expect(
        b.items.some((id) => NEVER_DISCOUNTED.includes(id)),
        b.id,
      ).toBe(false);
    }
  });

  it('charges 20% off only the pieces the player is missing', () => {
    const steel = BUNDLES.find((b) => b.id === 'bundle_steel')!;
    expect(bundleQuote(steel, [], priceOf)).toEqual({ missing: steel.items, fullPrice: 20000, price: 16000 });
    const partial = bundleQuote(steel, ['frame_steel', 'name_silver'], priceOf);
    expect(partial.missing).toEqual(['glow_silver', 'backdrop_onyx']);
    expect(partial.price).toBe(8000);
    expect(bundleQuote(steel, steel.items, priceOf)).toMatchObject({ missing: [], price: 0 });
  });
});

describe('featured item', () => {
  const catalog = COSMETICS.map(({ id, price, earned }) => ({ id, price, earned }));
  const eligible = catalog.filter(
    (c) => !c.earned && c.price >= FEATURED_MIN_PRICE && !NEVER_DISCOUNTED.includes(c.id),
  );
  const reopen = Date.UTC(2026, 9, 22, 21, 0); // the Thursday reopen, 22 Oct 2026

  it('is never Gilded, Comet, a season reward, or a cheap item', () => {
    for (let w = 0; w < 300; w++) {
      const id = featuredCosmeticId(catalog, reopen + w * WEEK);
      expect(NEVER_DISCOUNTED).not.toContain(id);
      expect(COSMETIC_MAP[id!]!.earned, id!).toBeUndefined();
      expect(COSMETIC_MAP[id!]!.price).toBeGreaterThanOrEqual(FEATURED_MIN_PRICE);
    }
  });

  it('features every eligible item once before repeating', () => {
    const start = Math.ceil(shopWeek(reopen) / eligible.length) * eligible.length;
    const firstWeek = Date.UTC(2023, 11, 28, 21, 0) + start * WEEK;
    const ids = eligible.map((_, w) => featuredCosmeticId(catalog, firstWeek + w * WEEK));
    expect(new Set(ids).size).toBe(eligible.length);
  });

  it('holds all week and changes at the Thursday reopen', () => {
    expect(featuredCosmeticId(catalog, reopen + 1000)).toBe(featuredCosmeticId(catalog, reopen + WEEK - 1000));
    expect(shopWeekEndsAt(reopen + 1000)).toBe(reopen + WEEK);
    const end = new Date(shopWeekEndsAt(reopen + 3 * 24 * 3600 * 1000));
    expect([end.getUTCDay(), end.getUTCHours()]).toEqual([4, 21]);
  });

  it('takes 25% off', () => {
    expect(featuredPrice(80000)).toBe(60000);
  });
});
