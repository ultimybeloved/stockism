import { describe, it, expect } from 'vitest';
import { computeRarityTiers, rarityClassFor, RARITY_ORDER } from './rarity';

// Build a characters array + prices map from [ticker, price] pairs (descending
// order not required — computeRarityTiers sorts internally).
const roster = (pairs) => ({
  characters: pairs.map(([ticker]) => ({ ticker })),
  prices: Object.fromEntries(pairs),
});

// 25 characters with a tight price cluster straddling the rare/uncommon rank
// cutoff (nominal boundary after the 11th character). Mirrors the live-market
// case: $JAY 40.78 ended the blue tier while $SHKO/$XIAO sat just below it,
// with the real divide at $PYNG 39.90.
const clusterPairs = [
  ['T00', 60], ['T01', 58], ['T02', 56], ['T03', 54], ['T04', 52],
  ['T05', 50], ['T06', 48], ['T07', 46], ['T08', 44], ['T09', 42],
  ['JAY', 40.78], ['SHKO', 40.49], ['XIAO', 40.27], ['PYNG', 39.90],
  ['T14', 39.55], ['T15', 39.2], ['T16', 38], ['T17', 36.5], ['T18', 35],
  ['T19', 33.5], ['T20', 32], ['T21', 30.5], ['T22', 29], ['T23', 27.5],
  ['T24', 26],
];

describe('computeRarityTiers gap snapping', () => {
  it('rounds cluster stragglers up into the higher tier when a clear break sits below', () => {
    const { characters, prices } = roster(clusterPairs);
    const tiers = computeRarityTiers(characters, prices);

    // Nominal cutoff would split the $40 cluster after JAY; the snapped
    // boundary lands on the drop to PYNG instead.
    expect(tiers.JAY).toBe('rare');
    expect(tiers.SHKO).toBe('rare');
    expect(tiers.XIAO).toBe('rare');
    expect(tiers.PYNG).toBe('uncommon');

    // Other boundaries have no qualifying break and stay on their rank cutoffs.
    expect(tiers.T00).toBe('legendary');
    expect(tiers.T01).toBe('epic');
    expect(tiers.T03).toBe('epic');
    expect(tiers.T04).toBe('rare');
    expect(tiers.T18).toBe('uncommon');
    expect(tiers.T19).toBe('common');
  });

  it('retreats the boundary upward when the cluster extends past the down-window', () => {
    // The uncommon/common rank cutoff (after 19 of 25) lands inside a flat
    // $13 cluster; the only clear divide is above it, below the $16 characters.
    const { characters, prices } = roster([
      ['T00', 60], ['T01', 58], ['T02', 56], ['T03', 54], ['T04', 52],
      ['T05', 50], ['T06', 48], ['T07', 46], ['T08', 44], ['T09', 42],
      ['T10', 40], ['T11', 38], ['T12', 36], ['T13', 34], ['T14', 32],
      ['T15', 30], ['GRN1', 16.8], ['GRN2', 16.2], ['STRG', 13.15],
      ['C0', 13.10], ['C1', 13.05], ['C2', 13.00], ['C3', 12.95],
      ['C4', 12.90], ['C5', 12.85],
    ]);
    const tiers = computeRarityTiers(characters, prices);

    expect(tiers.GRN1).toBe('uncommon');
    expect(tiers.GRN2).toBe('uncommon');
    // The $13.15 straggler belongs with the $13 cluster below the divide.
    expect(tiers.STRG).toBe('common');
    expect(tiers.C0).toBe('common');
    expect(tiers.C5).toBe('common');
  });

  it('retreats past a straggler to the dominant divide above it', () => {
    // Mirrors the live green/slate case: a $13 cluster under the cutoff, a
    // lone $14.14 straggler above it, and the real divide at $15.07 → $14.14.
    // The boundary retreats to the straggler, then upgrades to the bigger
    // adjacent break, so the straggler lands with the cluster below.
    const { characters, prices } = roster([
      ['T00', 60], ['T01', 58], ['T02', 56], ['T03', 54], ['T04', 52],
      ['T05', 50], ['T06', 48], ['T07', 46], ['T08', 44], ['T09', 42],
      ['T10', 40], ['T11', 38], ['T12', 36], ['T13', 17.5], ['T14', 16.6],
      ['T15', 15.8], ['SNGH', 15.07], ['BEOM', 14.14], ['JACE', 13.79],
      ['C0', 13.71], ['C1', 13.62], ['C2', 13.60], ['C3', 13.55],
      ['C4', 13.52], ['C5', 13.43],
    ]);
    const tiers = computeRarityTiers(characters, prices);

    expect(tiers.SNGH).toBe('uncommon');
    expect(tiers.BEOM).toBe('common');
    expect(tiers.JACE).toBe('common');
  });

  it('keeps every boundary on its rank cutoff when gaps are uniform', () => {
    const pairs = Array.from({ length: 25 }, (_, i) => [
      `T${String(i).padStart(2, '0')}`,
      100 * 0.97 ** i,
    ]);
    const { characters, prices } = roster(pairs);
    const tiers = computeRarityTiers(characters, prices);

    const counts = {};
    Object.values(tiers).forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    // Nominal splits for n=25: 1 / 3 / 7 / 8 / 6.
    expect(counts).toEqual({ legendary: 1, epic: 3, rare: 7, uncommon: 8, common: 6 });
  });

  it('handles equal prices deterministically via the ticker tie-break', () => {
    const pairs = 'ABCDEFGHIJ'.split('').map((t) => [t, 10]);
    const { characters, prices } = roster(pairs);
    const tiers = computeRarityTiers(characters, prices);

    // All gaps are zero, so nothing qualifies as a break and the rank cutoffs
    // hold: n=10 → 1 / 1 / 3 / 3 / 2, in ticker order.
    expect(tiers.A).toBe('legendary');
    expect(tiers.B).toBe('epic');
    expect(tiers.C).toBe('rare');
    expect(tiers.F).toBe('uncommon');
    expect(tiers.I).toBe('common');
    expect(tiers.J).toBe('common');
  });

  it('handles tiny and empty rosters', () => {
    expect(computeRarityTiers([], {})).toEqual({});
    expect(computeRarityTiers([{ ticker: 'X' }], { X: 5 })).toEqual({ X: 'legendary' });
    const two = computeRarityTiers(
      [{ ticker: 'X' }, { ticker: 'Y' }],
      { X: 5, Y: 3 },
    );
    expect(two.X).toBe('legendary');
    expect(RARITY_ORDER).toContain(two.Y);
  });

  it('excludes ETFs and falls back to basePrice when live price is missing', () => {
    const { characters, prices } = roster(clusterPairs);
    characters.push({ ticker: 'ETF1', isETF: true });
    characters.push({ ticker: 'NEWB', basePrice: 41 });
    delete prices.T24;
    const tiers = computeRarityTiers(characters, prices);

    expect(tiers.ETF1).toBeUndefined();
    expect(RARITY_ORDER).toContain(tiers.NEWB);
    // Missing price + no basePrice ranks at 0 — still gets a tier, no crash.
    expect(tiers.T24).toBe('common');
  });
});

describe('rarityClassFor', () => {
  it('maps tiers to class names and empty for none', () => {
    expect(rarityClassFor('epic')).toBe('rarity-epic');
    expect(rarityClassFor(undefined)).toBe('');
  });
});
