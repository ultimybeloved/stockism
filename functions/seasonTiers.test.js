import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as frontendSeasons from '../src/constants/seasons.js';
import { calculateExitValue } from '../src/utils/calculations.js';
import * as frontendSeasonWeeks from '../src/utils/seasonWeeks.js';

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
  seasonCapital,
  seasonAccountSize,
  marginDollarDays,
  seasonAverageMargin,
  seasonMarginUpdate,
  freshMarginTally,
  checkpointTier,
  standingTier,
  finalTier,
  weeklyRecordSummary,
  topTierSlots,
  divisionFor,
  divisionSlots,
  seasonTitles,
  lastHaltStart,
  rankTopTiers,
  isTopTierExcluded,
  averageGranted,
} = require('./services/seasonTiers');
const {
  grantedTotalAt, grantedSince, netEquityAt, exitEquityAt, predictionFlowUpdate, grantedFlowUpdate, grantedValueUpdate,
} = require('./helpers');

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
    // $1,000 profit on the $11,000 traded with (the $1,000 granted is capital too).
    expect(s.returnPercent).toBeCloseTo((1000 / 11000) * 100, 9);
    expect(s.marketPercent).toBeCloseTo(10, 9); // 1100 -> 1210
  });

  // Pinned at T0; the season has run 10 days when scored at T10.
  const T0 = 1_000_000_000_000;
  const T10 = T0 + 10 * DAY;
  const pinned = { ...baseline, granted: 0, pinnedAt: T0 };

  it('measures money owed all season as money traded with, so margin makes no return bigger', () => {
    // $10k account owes $10k the whole time and makes $2k: +10%, the same as $2k on $20k.
    const u = { seasonBaseline: pinned, grantedValue: 0, marginUsed: 10000, seasonMargin: freshMarginTally('S1', 10000, T0) };
    const avg = seasonAverageMargin(u, 'S1', T10);
    expect(avg).toBeCloseTo(10000, 6);
    expect(seasonScore(u, season, { value: 12000, indexNow: 1100, margin: avg }).returnPercent).toBeCloseTo(10, 9);
  });

  it('counts borrowing only for as long as it was owed', () => {
    // Owed $10k for 1 day of 10, then repaid: averages $1,000.
    let u = { seasonBaseline: pinned, marginUsed: 10000, seasonMargin: freshMarginTally('S1', 10000, T0) };
    u = { ...u, marginUsed: 0, ...seasonMarginUpdate(u, 0, T0 + DAY) };
    expect(seasonAverageMargin(u, 'S1', T10)).toBeCloseTo(1000, 6);
    expect(marginDollarDays(u, 'S1', T10)).toBeCloseTo(10000, 6);
  });

  it('cannot be hidden by repaying before a checkpoint', () => {
    // Borrow $10k on day 1, repay on day 6: five days of $10k still count.
    let u = { seasonBaseline: pinned, marginUsed: 0, seasonMargin: freshMarginTally('S1', 0, T0) };
    u = { ...u, marginUsed: 10000, ...seasonMarginUpdate(u, 10000, T0 + DAY) };
    u = { ...u, marginUsed: 0, ...seasonMarginUpdate(u, 0, T0 + 6 * DAY) };
    expect(seasonAverageMargin(u, 'S1', T10)).toBeCloseTo(5000, 6);
  });

  it('ignores a tally from another season and writes nothing outside one', () => {
    const u = { seasonBaseline: pinned, seasonMargin: { seasonId: 'S0', dd: 99999, amount: 5000, at: T0 } };
    expect(seasonAverageMargin(u, 'S1', T10)).toBe(0);
    expect(seasonMarginUpdate({ marginUsed: 5 }, 10, T10)).toEqual({});
  });

  it('matches the site', () => {
    let u = { seasonBaseline: pinned, marginUsed: 3000, seasonMargin: freshMarginTally('S1', 3000, T0) };
    u = { ...u, marginUsed: 700, ...seasonMarginUpdate(u, 700, T0 + 3.5 * DAY) };
    for (const t of [T0, T0 + DAY, T10, T10 + 40 * DAY]) {
      expect(frontendSeasonWeeks.marginDollarDays(u, 'S1', t)).toBeCloseTo(marginDollarDays(u, 'S1', t), 9);
      expect(frontendSeasonWeeks.seasonAverageMargin(u, 'S1', t)).toBeCloseTo(seasonAverageMargin(u, 'S1', t), 9);
    }
    expect(frontendSeasonWeeks.seasonAccountSize({ value: 8000, ladder: 700 })).toBe(seasonAccountSize({ value: 8000, ladder: 700 }));
    for (const granted of [-3000, 0, 500, 5000]) {
      expect(frontendSeasonWeeks.seasonCapital({ value: 8000, ladder: 700 }, { granted, margin: 2500 }))
        .toBe(seasonCapital({ value: 8000, ladder: 700 }, { granted, margin: 2500 }));
    }
  });

  it('counts cash parked in the ladder at the start as money traded with', () => {
    // $5k account with $5k parked in the ladder. Takes it out (+5000 flow) and
    // makes $1k trading $10k: +10%, not +20% on the $5k left outside.
    const b = { ...baseline, value: 5000, ladder: 5000, granted: 0, ladderFlow: 0 };
    const u = { seasonBaseline: b, grantedValue: 5000, ladderFlowValue: 5000 };
    const s = seasonScore(u, season, { value: 11000, indexNow: 1100 });
    expect(s.returnPercent).toBeCloseTo(10, 9);
    expect(seasonAccountSize(b)).toBe(10000);
    expect(divisionFor(seasonAccountSize(b))).toBe('trader');
  });

  it('adds ladder winnings taken out beyond what was parked to the money traded with', () => {
    // Parked $1k, took out $3k: the extra $2k is new money to trade with.
    expect(seasonCapital({ value: 10000, ladder: 1000 }, { granted: 3000, margin: 0 })).toBe(13000);
    // Depositing more never shrinks it.
    expect(seasonCapital({ value: 10000, ladder: 0 }, { granted: -4000, margin: 0 })).toBe(10000);
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
    // Ladder cash counts toward the floor.
    expect(seasonScore({ seasonBaseline: { ...baseline, value: 600, ladder: 400 } }, season, { value: 1 })).not.toBeNull();
  });
});

describe('money in mid-season', () => {
  const T0 = Date.UTC(2026, 8, 18);
  const pinned = buildSeasonBaseline({ seasonId: 'S1', value: 10000, granted: 0, grantedDays: 0, index: 1000, pinnedAt: T0 });
  // What the server's grantedValueUpdate / grantedFlowUpdate add to the counters.
  const book = (u, amount, t) => ({
    ...u,
    grantedValue: (u.grantedValue || 0) + amount,
    grantedDays: (u.grantedDays || 0) + frontendSeasonWeeks.grantedDaysFor(amount, t),
  });
  const at = (u, value, t) => seasonScore(u, season, { value, indexNow: 1000, granted: undefined, at: t });

  it('collecting a mission never lowers the return', () => {
    // Reported bug: +$1k trading was 10%, a $500 mission dropped it to 9.5%.
    const t = T0 + 10 * DAY;
    const before = { seasonBaseline: pinned };
    const after = book(before, 500, t);
    expect(at(before, 11000, t).returnPercent).toBeCloseTo(10, 9);
    expect(at(after, 11500, t).returnPercent).toBeCloseTo(10, 9);
  });

  it('counts money in for the share of the season it was held', () => {
    // $1,000 in on day 10, scored on day 20: held half the time, counts $500.
    const u = book({ seasonBaseline: pinned }, 1000, T0 + 10 * DAY);
    expect(averageGranted(1000, u.grantedDays, T0, T0 + 20 * DAY)).toBeCloseTo(500, 6);
    expect(at(u, 12050, T0 + 20 * DAY).returnPercent).toBeCloseTo((1050 / 10500) * 100, 6);
  });

  it('never counts more than the full amount, even if a booking missed the time counter', () => {
    const u = { seasonBaseline: pinned, grantedValue: 1000, grantedDays: 0 };
    expect(averageGranted(1000, 0, T0, T0 + DAY)).toBe(1000);
    expect(averageGranted(-1000, 0, T0, T0 + DAY)).toBe(-1000);
    expect(at(u, 12100, T0 + DAY).returnPercent).toBeCloseTo((1100 / 11000) * 100, 9);
  });

  it('counts it in full for a baseline pinned before the counter existed', () => {
    const { grantedDays, ...old } = pinned;
    const u = { seasonBaseline: old, grantedValue: 1000, grantedDays: 123 };
    expect(at(u, 12100, T0 + 20 * DAY).returnPercent).toBeCloseTo((1100 / 11000) * 100, 9);
  });

  it('weighs weekly records the same way, and matches the site', () => {
    const ctx = { seasonId: 'S1', baselineValue: 10000, baselineIndex: 1000, pinnedAt: T0 };
    // $700 mission collected right before the week-1 checkpoint: +$300 trading
    // on $10k is 3%, which beats a 2.9% market. Counted in full it is 2.8% and would not.
    const wk = T0 + 7 * DAY;
    const a = frontendSeasonWeeks.grantedDaysFor(700, wk - 1000);
    const rows = [{ s: 'S1', w: 1, t: wk, v: 11000, g: 700, a, x: 1029, c: 0, h: 0, d: 0 }];
    expect(weeklyRecordSummary(rows, ctx, 1).beatWeeks).toBe(1);
    const { a: _drop, ...oldRow } = rows[0];
    expect(weeklyRecordSummary([oldRow], ctx, 1).beatWeeks).toBe(0);

    const site = frontendSeasonWeeks.deriveSeasonWeeks(rows, {
      seasonId: 'S1', baselineValue: 10000, pinnedAt: T0, indexAtStart: 1000,
    });
    expect(site[0].beat).toBe(true);
    const server = seasonScore({ seasonBaseline: pinned }, season, {
      value: 11000, indexNow: 1029, granted: 700, grantedDays: a, at: wk, margin: 0,
    });
    expect(site[0].totalReturn).toBeCloseTo(server.returnPercent, 9);
    for (const [g, d, from, to] of [[700, a, T0, wk], [0, 0, T0, wk], [500, undefined, T0, wk], [100, 5, wk, wk]]) {
      expect(frontendSeasonWeeks.averageGranted(g, d, from, to)).toBe(averageGranted(g, d, from, to));
    }
  });
});

describe('prediction flows', () => {
  it('book on their own counter, never the ladder shadow stat or the grant clock', () => {
    const u = predictionFlowUpdate(-250);
    expect(Object.keys(u).sort()).toEqual(['grantedValue', 'predictionFlowValue']);
    expect(Object.keys(grantedFlowUpdate(-250)).sort()).toEqual(['grantedValue', 'ladderFlowValue']);
    expect(Object.keys(grantedValueUpdate(250)).sort()).toEqual(['grantedDays', 'grantedValue']);
    expect(predictionFlowUpdate(0)).toEqual({});
  });

  const T0 = Date.UTC(2026, 8, 18);
  const b = buildSeasonBaseline({ seasonId: 'S1', value: 10000, granted: 0, grantedDays: 0, index: 1000, pinnedAt: T0 });

  it('a winning all-in bet is not a season gain, and a losing one is not a loss', () => {
    const t = T0 + 5 * DAY;
    // Bet everything, won 10x: $100k in cash, still 0%.
    const won = { seasonBaseline: b, grantedValue: 90000, predictionFlowValue: 90000 };
    expect(seasonScore(won, season, { value: 100000, indexNow: 1000, at: t }).returnPercent).toBeCloseTo(0, 6);
    const lost = { seasonBaseline: b, grantedValue: -10000, predictionFlowValue: -10000 };
    expect(seasonScore(lost, season, { value: 0, indexNow: 1000, at: t }).returnPercent).toBeCloseTo(0, 6);
  });

  it('a payout counts toward capital in full the moment it lands', () => {
    // HAHA, 2026-09-18: $1,359 start, a $17,416 payout hours before scoring,
    // down $1,537 trading it. Averaging the payout read that as -31%.
    const small = { ...b, value: 1359 };
    const u = { seasonBaseline: small, grantedValue: 17416, predictionFlowValue: 17416 };
    const s = seasonScore(u, season, { value: 1359 + 17416 - 1537, indexNow: 1000, at: T0 + DAY });
    expect(s.returnPercent).toBeCloseTo((-1537 / (1359 + 17416)) * 100, 6);
  });

  it('scores a stored week record the same way, and matches the site', () => {
    const ctx = { seasonId: 'S1', baselineValue: 10000, baselineIndex: 1000, pinnedAt: T0 };
    const wk = T0 + 7 * DAY;
    // $5,000 payout the day before the checkpoint, $500 made on it: 500 / 15000.
    const rows = [{ s: 'S1', w: 1, t: wk, v: 15500, g: 5000, a: 0, f: 5000, x: 1000, c: 0, h: 0, d: 0 }];
    const server = seasonScore({ seasonBaseline: b }, season, {
      value: 15500, indexNow: 1000, granted: 5000, grantedDays: 0, sideFlows: 5000, at: wk, margin: 0,
    });
    expect(server.returnPercent).toBeCloseTo((500 / 15000) * 100, 9);
    const site = frontendSeasonWeeks.deriveSeasonWeeks(rows, { seasonId: 'S1', baselineValue: 10000, pinnedAt: T0, indexAtStart: 1000 });
    expect(site[0].totalReturn).toBeCloseTo(server.returnPercent, 9);
    expect(site[0].weekReturn).toBeCloseTo(server.returnPercent, 9);
    expect(weeklyRecordSummary(rows, ctx, 1).beatWeeks).toBe(1);
  });
});

describe('checkpointTier', () => {
  it('banks Bronze only for turning up', () => {
    expect(checkpointTier({ activeWeeks: 2 })).toBe('bronze');
    expect(checkpointTier({ activeWeeks: 1 })).toBeNull();
  });

  it('never banks anything above Bronze, however well the week went', () => {
    expect(checkpointTier({ returnPercent: 900, marketPercent: 0, activeWeeks: 20 })).toBe('bronze');
    expect(checkpointTier({ returnPercent: 900, marketPercent: 0, activeWeeks: 0 })).toBeNull();
  });
});

describe('standingTier', () => {
  it('is Gold for beating the market over the season, even a falling one', () => {
    expect(standingTier({ returnPercent: 12, marketPercent: 5 })).toBe('gold');
    expect(standingTier({ returnPercent: -2, marketPercent: -8 })).toBe('gold');
  });

  it('is Silver for being up but behind the market, matching it included', () => {
    expect(standingTier({ returnPercent: 3, marketPercent: 5 })).toBe('silver');
    expect(standingTier({ returnPercent: 5, marketPercent: 5 })).toBe('silver');
  });

  it('is nothing when down and behind', () => {
    expect(standingTier({ returnPercent: -4, marketPercent: 5 })).toBeNull();
  });

  it('matches the site', () => {
    for (const [r, m] of [[12, 5], [-2, -8], [3, 5], [5, 5], [-4, 5], [0, -1]]) {
      expect(frontendSeasons.seasonStandingTier({ returnPercent: r, marketPercent: m }))
        .toBe(standingTier({ returnPercent: r, marketPercent: m }));
    }
  });
});

describe('finalTier', () => {
  const ranked = new Map([['p', 'platinum']]);

  it('judges Silver and Gold on where the player finishes, not a week they touched it', () => {
    // Ahead of the market once mid-season, behind at the end: Bronze only.
    expect(finalTier({ uid: 'a', tier: 'bronze', returnPercent: -3, marketPercent: 4 }, ranked)).toBe('bronze');
    expect(finalTier({ uid: 'a', tier: 'bronze', returnPercent: 2, marketPercent: 4 }, ranked)).toBe('silver');
    expect(finalTier({ uid: 'a', tier: null, returnPercent: 9, marketPercent: 4 }, ranked)).toBe('gold');
  });

  it('takes a ranked place over the standing tier', () => {
    expect(finalTier({ uid: 'p', tier: 'bronze', returnPercent: 50, marketPercent: 4 }, ranked)).toBe('platinum');
  });

  it('gives nothing to a player with nothing', () => {
    expect(finalTier({ uid: 'z', tier: null, returnPercent: -1, marketPercent: 4 }, ranked)).toBeNull();
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

  it('measures a week against borrowing too, and matches the site', () => {
    // +$1,000 on $10k with $10k owed all week (70,000 dollar-days over 7 days):
    // +5%, which loses to a +6% market.
    const WEEK = 7 * DAY;
    const rows = [{ ...row(1, 11000, 1060), t: WEEK, d: 70000 }];
    const pinnedCtx = { ...ctx, pinnedAt: 0.0001 };
    expect(weeklyRecordSummary(rows, pinnedCtx, 1).beatWeeks).toBe(0);
    expect(weeklyRecordSummary([{ ...row(1, 11000, 1060), t: WEEK, d: 0 }], pinnedCtx, 1).beatWeeks).toBe(1);
    const site = frontendSeasonWeeks.deriveSeasonWeeks(rows, {
      seasonId: 'S1', baselineValue: 10000, indexAtStart: 1000, pinnedAt: 0.0001,
    });
    expect(site[0].beat).toBe(false);
    expect(site[0].weekReturn).toBeCloseTo(5, 9);
    expect(site[0].totalReturn).toBeCloseTo(5, 9);
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

  it('passes an excluded player’s place to the next one down', () => {
    const out = rankTopTiers([
      player('a', 80, { topTierExcluded: true }), player('b', 60), player('c', 40), player('d', 30), ...filler,
    ]);
    expect(out.has('a')).toBe(false);
    expect(out.get('b')).toBe('diamond');
    expect(out.get('c')).toBe('platinum');
    expect(out.get('d')).toBe('platinum');
  });

  it('still counts excluded players toward the division size', () => {
    // 20 on the board, 17 of them excluded: still three Platinum places.
    const excluded = Array.from({ length: 17 }, (_, i) => player(`x${i}`, 90 + i, { topTierExcluded: true }));
    const out = rankTopTiers([...excluded, player('a', 3), player('b', 2), player('c', 1)]);
    expect([...out.keys()].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('isTopTierExcluded', () => {
  it('only applies to the season it was set in', () => {
    const u = { seasonTopTierExclusion: { seasonId: 'P1', at: 1 } };
    expect(isTopTierExcluded(u, 'P1')).toBe(true);
    expect(isTopTierExcluded(u, 'P2')).toBe(false);
    expect(isTopTierExcluded({}, 'P1')).toBe(false);
    expect(isTopTierExcluded(u, undefined)).toBe(false);
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

describe('size divisions', () => {
  it('places a baseline by the value it was pinned at', () => {
    expect(divisionFor(1000)).toBe('rookie');
    expect(divisionFor(9999.99)).toBe('rookie');
    expect(divisionFor(10000)).toBe('trader');
    expect(divisionFor(199999)).toBe('whale');
    expect(divisionFor(5000000)).toBe('titan');
    expect(divisionFor(undefined)).toBe('rookie');
  });

  it('matches the site', () => {
    for (const v of [0, 500, 10000, 49999, 50000, 200000, 1e7]) {
      expect(frontendSeasons.seasonDivisionFor(v).id).toBe(divisionFor(v));
    }
  });

  it('ranks Platinum and Diamond within each division, not across the board', () => {
    const p = (uid, excess, division) => ({
      uid, excess, division, activeWeeks: 2, beatShare: 1, peakConcentration: 0.3,
    });
    // Rookies swing further: all ten of them beat every Titan.
    const rookies = Array.from({ length: 10 }, (_, i) => p(`r${i}`, 500 - i * 10, 'rookie'));
    const titans = Array.from({ length: 10 }, (_, i) => p(`t${i}`, 50 - i, 'titan'));
    const out = rankTopTiers([...rookies, ...titans]);
    // 10 players each: 2 Platinum places (1 of them Diamond) per division.
    expect(out.get('r0')).toBe('diamond');
    expect(out.get('r1')).toBe('platinum');
    expect(out.get('t0')).toBe('diamond');
    expect(out.get('t1')).toBe('platinum');
    expect(out.has('r2')).toBe(false);
    expect(out.has('t2')).toBe(false);
  });

  it('counts players and places per division', () => {
    const field = [
      ...Array.from({ length: 20 }, (_, i) => ({ uid: `r${i}`, baselineValue: 2000 })),
      { uid: 'w', baselineValue: 60000 },
    ];
    const slots = Object.fromEntries(divisionSlots(field).map((d) => [d.id, d]));
    expect(slots.rookie).toMatchObject({ players: 20, platinum: 3, diamond: 1 });
    expect(slots.whale).toMatchObject({ players: 1, platinum: 1, diamond: 1 });
    expect(slots.trader).toMatchObject({ players: 0, platinum: 0, diamond: 0 });
    expect(slots.titan.max).toBeNull();
  });
});

describe('exitEquityAt', () => {
  // Unsplit stocks, so liquidity is BASE_LIQUIDITY (a split stock's is higher).
  const prices = { SOPH: 100, CROC: 50 };

  it('sells holdings and covers shorts at the price their own order pushes to', () => {
    // 100 SOPH: impact 100 x 1.2% x sqrt(100/100) = $1.20, so each sells at $98.80.
    expect(exitEquityAt({ cash: 1000, holdings: { SOPH: 100 } }, prices)).toBe(10880);
    // Cover 10 CROC at 50 + 50 x 1.2% x sqrt(0.1) = 50.1897: 600 + (60 - 50.1897) x 10.
    const u = { cash: 0, shorts: { CROC: { shares: 10, costBasis: 60, margin: 600 } } };
    expect(exitEquityAt(u, prices)).toBe(698.1);
  });

  it('costs a bigger position more, capped at one order\'s 5% move', () => {
    const haircut = (shares) => 1 - exitEquityAt({ holdings: { SOPH: shares } }, prices) / (100 * shares);
    expect(haircut(1000)).toBeGreaterThan(haircut(100));
    expect(haircut(100000)).toBeCloseTo(0.05, 5);
  });

  it('subtracts a margin loan and survives nothing', () => {
    expect(exitEquityAt({ cash: 1000, marginUsed: 400 }, prices)).toBe(600);
    expect(exitEquityAt(null, prices)).toBe(0);
  });

  it('matches the season card on the site', () => {
    const u = {
      cash: 1234.5,
      holdings: { SOPH: 37, CROC: 2500 },
      shorts: { SOPH: { shares: 12, costBasis: 110, margin: 1320, system: 'v2' } },
      marginUsed: 300,
    };
    expect(calculateExitValue(u, prices)).toBeCloseTo(exitEquityAt(u, prices), 1);
  });
});

describe('seasonTitles', () => {
  it('gives a real season the season and arc titles', () => {
    const t = seasonTitles({ id: 'S1', number: 1, name: 'Gapryong Kim Arc' }, 'gold');
    expect(t).toEqual([
      { id: 'season_1_gold', text: 'Season 1 Gold' },
      { id: 'arc_s1_gold', text: 'Gapryong Kim Arc Gold' },
    ]);
  });

  it('gives a preseason one title that never says Season N', () => {
    const t = seasonTitles({ id: 'P1', number: 0, preseason: true, preseasons: 1, name: 'Gapryong Kim Arc' }, 'diamond');
    expect(t).toEqual([{ id: 'preseason_1_diamond', text: 'Preseason Diamond' }]);
  });

  it('numbers a second preseason', () => {
    const t = seasonTitles({ id: 'P2', number: 1, preseason: true, preseasons: 2, name: 'X' }, 'gold');
    expect(t).toEqual([{ id: 'preseason_2_gold', text: 'Preseason 2 Gold' }]);
  });

  it('gives Bronze and Silver no title by default', () => {
    const s1 = { id: 'S1', number: 1, name: 'X' };
    expect(seasonTitles(s1, 'bronze')).toEqual([]);
    expect(seasonTitles({ ...s1, preseason: true }, 'silver')).toEqual([]);
    expect(seasonTitles(s1, null)).toEqual([]);
  });

  it('follows the titled tiers pinned on the season', () => {
    const s1 = { id: 'S1', number: 1, name: 'X', rules: { titledTiers: ['diamond'] } };
    expect(seasonTitles(s1, 'platinum')).toEqual([]);
    expect(seasonTitles(s1, 'diamond')).toHaveLength(2);
  });
});

describe('lastHaltStart', () => {
  const at = (iso) => Date.parse(iso);
  it('is this Thursday 13:00 UTC from later in the week', () => {
    expect(lastHaltStart(at('2026-09-18T01:33:00Z'))).toBe(at('2026-09-17T13:00:00Z'));
    expect(lastHaltStart(at('2026-09-23T23:00:00Z'))).toBe(at('2026-09-17T13:00:00Z'));
  });
  it('is today once the halt has begun', () => {
    expect(lastHaltStart(at('2026-09-17T13:00:00Z'))).toBe(at('2026-09-17T13:00:00Z'));
  });
  it('is last week on a Thursday morning', () => {
    expect(lastHaltStart(at('2026-09-24T09:00:00Z'))).toBe(at('2026-09-17T13:00:00Z'));
  });
});
