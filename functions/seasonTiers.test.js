import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as frontendSeasons from '../src/constants/seasons.js';

const require = createRequire(import.meta.url);

// helpers.js grabs a Firestore handle at import time. Nothing here reads or
// writes; the app just has to exist.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const {
  DEFAULT_SEASON_RULES,
  rulesFor,
  higherTier,
  buildSeasonBaseline,
  seasonScore,
  checkpointTier,
  weeklyRecordSummary,
  topTierSlots,
  rankTopTiers,
} = require('./services/seasonTiers');
const { grantedTotalAt, grantedSince, netEquityAt } = require('./helpers');

const season = { id: 'S1', indexAtStart: 1000 };
const DAY = 24 * 60 * 60 * 1000;

describe('the frontend mirror', () => {
  it('carries the same rules as the backend', () => {
    expect({ ...frontendSeasons.DEFAULT_SEASON_RULES }).toEqual({ ...DEFAULT_SEASON_RULES });
  });
});

describe('seasonScore', () => {
  const baseline = buildSeasonBaseline({
    seasonId: 'S1', value: 10000, granted: 500, ladderFlow: 0, index: 1100, pinnedAt: 1,
  });

  it('strips free money and measures the market from the player\'s own start', () => {
    // Joined when the index was 1100, not the season's 1000.
    const s = seasonScore({ seasonBaseline: baseline, grantedValue: 1500 }, season, { value: 12000, indexNow: 1210 });
    expect(s.returnPercent).toBeCloseTo(10, 9); // (12000 - 1000 granted - 10000) / 10000
    expect(s.marketPercent).toBeCloseTo(10, 9); // 1100 -> 1210
    expect(s.excess).toBeCloseTo(0, 9);
  });

  it('falls back to the season\'s opening index for a baseline without one', () => {
    const old = { ...baseline, index: undefined };
    const s = seasonScore({ seasonBaseline: old, grantedValue: 500 }, season, { value: 10000, indexNow: 1100 });
    expect(s.marketPercent).toBeCloseTo(10, 9);
  });

  it('takes grants from a stored week record when given one', () => {
    const s = seasonScore({ seasonBaseline: baseline, grantedValue: 99999 }, season, { value: 11000, indexNow: 1100, granted: 1000 });
    expect(s.returnPercent).toBeCloseTo(0, 9);
  });

  it('does not treat a ladder deposit as a trading loss', () => {
    // $2,000 moved into the ladder: portfolio drops, the flow books -2000.
    const u = { seasonBaseline: { ...baseline, granted: 0 }, grantedValue: -2000, ladderFlowValue: -2000 };
    const s = seasonScore(u, season, { value: 8000, indexNow: 1100 });
    expect(s.returnPercent).toBeCloseTo(0, 9);
    expect(s.returnWithLadder).toBeCloseTo(-20, 9);
  });

  it('cannot score another season, a missing baseline or a tiny one', () => {
    expect(seasonScore({ seasonBaseline: { ...baseline, seasonId: 'S0' } }, season, { value: 1 })).toBeNull();
    expect(seasonScore({}, season, { value: 1 })).toBeNull();
    expect(seasonScore({ seasonBaseline: { ...baseline, value: 999 } }, season, { value: 1 })).toBeNull();
  });
});

describe('checkpointTier', () => {
  it('banks Gold for beating the market, even in a falling one', () => {
    expect(checkpointTier({ returnPercent: 12, marketPercent: 5, activeWeeks: 0 })).toBe('gold');
    expect(checkpointTier({ returnPercent: -2, marketPercent: -8, activeWeeks: 0 })).toBe('gold');
  });

  it('banks Silver for being up but behind the market', () => {
    expect(checkpointTier({ returnPercent: 3, marketPercent: 5, activeWeeks: 0 })).toBe('silver');
  });

  it('treats matching the market as not beating it', () => {
    expect(checkpointTier({ returnPercent: 5, marketPercent: 5, activeWeeks: 0 })).toBe('silver');
  });

  it('banks Bronze only for turning up', () => {
    expect(checkpointTier({ returnPercent: -4, marketPercent: 5, activeWeeks: 2 })).toBe('bronze');
    expect(checkpointTier({ returnPercent: -4, marketPercent: 5, activeWeeks: 1 })).toBeNull();
  });

  it('never banks Platinum or Diamond', () => {
    expect(checkpointTier({ returnPercent: 900, marketPercent: 0, activeWeeks: 20 })).toBe('gold');
  });
});

describe('higherTier', () => {
  it('never lowers a banked tier', () => {
    expect(higherTier('gold', undefined)).toBe('gold');
    expect(higherTier('gold', 'platinum')).toBe('platinum');
    expect(higherTier('diamond', 'platinum')).toBe('diamond');
    expect(higherTier(null, undefined)).toBeNull();
  });
});

describe('weeklyRecordSummary', () => {
  const ctx = { seasonId: 'S1', baselineValue: 10000, baselineIndex: 1000 };
  const row = (w, v, x, c = 0, h = 0, g = 0) => ({ s: 'S1', w, t: w, v, g, x, c, h });

  it('counts the weeks that beat the market', () => {
    const out = weeklyRecordSummary([
      row(1, 11000, 1050),  // +10% vs +5%: beat
      row(2, 11000, 1100),  // 0% vs +4.8%: not
      row(3, 12100, 1100),  // +10% vs 0%: beat
    ], ctx, 3);
    expect(out.beatWeeks).toBe(2);
    expect(out.beatShare).toBeCloseTo(2 / 3, 9);
  });

  it('counts a week with no record as not beaten', () => {
    // A late joiner: two great weeks out of a four-week season.
    const out = weeklyRecordSummary([row(3, 12000, 1000), row(4, 14000, 1000)], ctx, 4);
    expect(out.weeks).toBe(4);
    expect(out.beatShare).toBe(0.5);
  });

  it('strips free money before scoring a week', () => {
    const out = weeklyRecordSummary([row(1, 11000, 1000, 0, 0, 1000)], ctx, 1);
    expect(out.beatWeeks).toBe(0);
  });

  it('reports the peak concentration of invested money', () => {
    const out = weeklyRecordSummary([row(1, 1, 1000, 400, 1000), row(2, 1, 1000, 900, 1000)], ctx, 2);
    expect(out.peakConcentration).toBeCloseTo(0.9, 9);
  });

  it('ignores other seasons and survives no record at all', () => {
    expect(weeklyRecordSummary([{ ...row(1, 99999, 1), s: 'S0' }], ctx, 0).weeks).toBe(0);
    expect(weeklyRecordSummary(undefined, ctx, 2)).toEqual({ weeks: 2, beatWeeks: 0, beatShare: 0, peakConcentration: 0 });
  });
});

describe('topTierSlots', () => {
  it('gives shares of the board, with at least one place once anyone is on it', () => {
    expect(topTierSlots(100)).toEqual({ platinum: 15, diamond: 5 });
    expect(topTierSlots(20)).toEqual({ platinum: 3, diamond: 1 });
    expect(topTierSlots(3)).toEqual({ platinum: 1, diamond: 1 });
    expect(topTierSlots(0)).toEqual({ platinum: 0, diamond: 0 });
  });
});

describe('rankTopTiers', () => {
  const player = (uid, excess, extra = {}) => ({
    uid, excess, activeWeeks: 4, beatShare: 1, peakConcentration: 0.3, ...extra,
  });
  // A board of 20: three Platinum places, one Diamond.
  const filler = Array.from({ length: 16 }, (_, i) => player(`f${i}`, 1 + i / 100));

  it('gives Platinum to the top of the board against the market', () => {
    const out = rankTopTiers([player('a', 80), player('b', 60), player('c', 40), player('d', 30), ...filler]);
    expect(out.get('a')).toBe('diamond');
    expect(out.get('b')).toBe('platinum');
    expect(out.get('c')).toBe('platinum');
    expect(out.has('d')).toBe(false);
  });

  it('passes Diamond down to the best Platinum player who was not all-in on one character', () => {
    // The $GAP-sitter tops the board and keeps Platinum, but Diamond goes to b.
    const out = rankTopTiers([
      player('sitter', 300, { peakConcentration: 1 }), player('b', 60), player('c', 40), player('d', 30), ...filler,
    ]);
    expect(out.get('sitter')).toBe('platinum');
    expect(out.get('b')).toBe('diamond');
  });

  it('rules a player out of Diamond for one checkpoint over the limit', () => {
    const out = rankTopTiers([
      player('a', 80, { peakConcentration: 0.61 }), player('b', 60, { beatShare: 0.5 }), player('c', 40), ...filler, player('z', 0.5),
    ]);
    expect(out.get('a')).toBe('platinum');
    expect(out.get('b')).toBe('platinum');
    expect(out.get('c')).toBe('diamond');
  });

  it('accepts exactly the limits', () => {
    const out = rankTopTiers([player('a', 80, { peakConcentration: 0.6, beatShare: 0.75 }), ...filler]);
    expect(out.get('a')).toBe('diamond');
  });

  it('leaves places empty rather than give them to players behind the market', () => {
    const behind = Array.from({ length: 20 }, (_, i) => player(`p${i}`, -1 - i));
    expect(rankTopTiers([player('a', 5), ...behind]).size).toBe(1);
  });

  it('needs the Bronze minimum of active weeks to take a place', () => {
    const out = rankTopTiers([player('ghost', 500, { activeWeeks: 1 }), player('b', 10)]);
    expect(out.has('ghost')).toBe(false);
    expect(out.get('b')).toBe('diamond');
  });

  it('breaks ties the same way every time', () => {
    const board = [player('zed', 50), player('amy', 50), ...filler.slice(0, 5)];
    expect([...rankTopTiers(board).keys()]).toEqual([...rankTopTiers([...board].reverse()).keys()]);
    expect(rankTopTiers(board).get('amy')).toBe('diamond');
  });

  it('uses the rules a season was started with', () => {
    const rules = rulesFor({ rules: { platinumTopShare: 0.5 } });
    const out = rankTopTiers([player('a', 3), player('b', 2), player('c', 1), player('d', 0.5)], rules);
    expect([...out.keys()]).toHaveLength(2);
  });

  it('handles an empty board', () => {
    expect(rankTopTiers([]).size).toBe(0);
    expect(rankTopTiers(undefined).size).toBe(0);
  });
});

describe('grantedTotalAt / grantedSince', () => {
  const now = Date.now();

  it('reads the newest sample at or before the moment', () => {
    const u = { grantedSamples: [{ ts: now - 40 * DAY, total: 100 }, { ts: now - 20 * DAY, total: 300 }] };
    expect(grantedTotalAt(u, now - 30 * DAY)).toBe(100);
    expect(grantedTotalAt(u, now)).toBe(300);
  });

  it('falls back to the oldest sample, which can only under-count grants', () => {
    // Tracking began ten days ago; the 30-day window is older than that.
    const u = { grantedValue: 900, grantedSamples: [{ ts: now - 10 * DAY, total: 200 }, { ts: now - 5 * DAY, total: 500 }] };
    expect(grantedTotalAt(u, now - 30 * DAY)).toBe(200);
    expect(grantedSince(u, 30 * DAY)).toBe(700);
  });

  it('says nothing without samples', () => {
    expect(grantedTotalAt({ grantedValue: 500 }, now)).toBeNull();
    expect(grantedSince({ grantedValue: 500 }, 7 * DAY)).toBe(0);
  });

  it('keeps the sign of a ladder deposit', () => {
    const u = { grantedValue: -1000, grantedSamples: [{ ts: now - 10 * DAY, total: 0 }] };
    expect(grantedSince(u, 7 * DAY)).toBe(-1000);
  });
});

describe('netEquityAt', () => {
  const prices = { GAP: 100, SHNG: 50 };

  it('adds cash, holdings and shorts, and subtracts a margin loan', () => {
    const u = {
      cash: 1000,
      holdings: { GAP: 10, SHNG: 0 },
      shorts: { SHNG: { shares: 10, costBasis: 60, margin: 600, system: 'v2' } },
      marginUsed: 500,
    };
    // 1000 + 1000 holdings + (600 + (60-50)*10) short - 500 loan
    expect(netEquityAt(u, prices)).toBe(2200);
  });

  it('counts borrowed money as zero gain', () => {
    // Borrowing $500 to buy $500 of stock changes nothing about what you own.
    const before = { cash: 1000, holdings: {} };
    const after = { cash: 1000, holdings: { GAP: 5 }, marginUsed: 500 };
    expect(netEquityAt(after, prices)).toBe(netEquityAt(before, prices));
  });

  it('ignores negative share counts and survives nothing', () => {
    expect(netEquityAt({ cash: 10, holdings: { GAP: -3 } }, prices)).toBe(10);
    expect(netEquityAt(null, prices)).toBe(0);
  });
});
