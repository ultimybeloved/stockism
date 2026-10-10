// Test suite for syncPortfolio, against the LOCAL Firebase emulator. Never
// touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:sync
//
// syncPortfolio moves no money, but almost every percent figure reads what it
// writes: portfolioValue, the 24h/7d/30d snapshots the leaderboard measures
// from, and grantedSamples, the daily record of free money that every 30-day
// percent figure and the admin calibration readout net out. If a sample is
// wrong, those numbers are wrong with no error anywhere.
//
// Sections:
//   A. Portfolio value         B. Rate limits
//   C. Granted-value samples   D. Weekly mission baselines
//   E. History and snapshots   F. Mission map pruning
//   G. Achievements            H. Bankruptcy flag
//   I. Account guards

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { syncPortfolio } =
  require('../../functions/src/users/portfolio') as typeof import('../../functions/src/users/portfolio');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) < tol;
const ctx = (uid: string) => ({ auth: { uid } });

// Same week maths as the backend (weeks start Monday).
const weekId = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() + 1);
  if (start > now) start.setDate(start.getDate() - 7);
  return start.toISOString().split('T')[0]!;
};

const PRICES = { AAA: 10, BBB: 20, CCC: 5, DDD: 1, EEE: 2, FFF: 3 };

const userRef = (uid: string) => db.collection('users').doc(uid);
async function seedUser(uid: string, extra: Loose = {}) {
  await userRef(uid).set({ displayName: uid, cash: 1000, holdings: {}, costBasis: {}, shorts: {}, ...extra });
}
const getUser = async (uid: string) => (await userRef(uid).get()).data();
const sync = (uid: string) => syncPortfolio.run({}, ctx(uid));
/** Let the next sync through the 30-second limit without waiting. */
const unthrottle = (uid: string, extra: Loose = {}) => userRef(uid).update({ lastSynced: 0, ...extra });
const history = async (uid: string) =>
  (await userRef(uid).collection('portfolioHistory').get()).docs.map((d: Loose) => d.data());

const rejects = async (fn: Loose, pattern: RegExp) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return pattern.test(e.message) ? true : e.message;
  }
};

async function main() {
  console.log('\n=== syncPortfolio suite (emulator) ===');
  await db.collection('market').doc('current').set({ prices: PRICES, launchedTickers: [] });

  // ── A. Portfolio value ────────────────────────────────────────────────────
  console.log('\nA. Portfolio value');

  await seedUser('v_mix', {
    cash: 1000,
    holdings: { AAA: 10, BBB: 5, GONE: 50 },
    shorts: {
      // v2: margin + (entry - now) * shares = 300 + (12 - 10) * 10
      AAA: { shares: 10, costBasis: 12, margin: 300, system: 'v2' },
      // legacy: margin - now * shares = 200 - 20 * 5
      BBB: { shares: 5, costBasis: 25, margin: 200, system: 'v1' },
      // closed position, ignored
      CCC: { shares: 0, costBasis: 5, margin: 50 },
    },
  });
  const mix = await sync('v_mix');
  // 1000 + (100 + 100 + 0) + 320 + 100
  check('cash, holdings and both short styles add up', near(mix.portfolioValue, 1620), `value=${mix.portfolioValue}`);
  check('a holding with no price counts as zero, not an error', near((await getUser('v_mix')).portfolioValue, 1620));

  await seedUser('v_round', { cash: 0.005, holdings: { DDD: 1.0049 } });
  const round = await sync('v_round');
  check('the value is rounded to the cent', round.portfolioValue === 1.01, `value=${round.portfolioValue}`);

  // ── B. Rate limits ────────────────────────────────────────────────────────
  console.log('\nB. Rate limits');

  await seedUser('r_fast');
  await sync('r_fast');
  await userRef('r_fast').update({ cash: 999999 });
  const fast = await sync('r_fast');
  check('a second sync within 30 seconds is turned away', fast.rateLimited === true, fast);
  check('and writes nothing', (await getUser('r_fast')).portfolioValue === 1000);

  await seedUser('r_hour', { lastSynced: 0, syncCountHour: 60, syncHourStart: Date.now() - 10 * 60 * 1000 });
  check('the 61st sync in an hour is turned away', (await sync('r_hour')).rateLimited === true);
  await unthrottle('r_hour', { syncHourStart: Date.now() - HOUR - 1 });
  const fresh = await sync('r_hour');
  const freshUser = await getUser('r_hour');
  check(
    'a new hour starts the count again',
    !fresh.rateLimited && freshUser.syncCountHour === 1 && Date.now() - freshUser.syncHourStart < 60000,
    freshUser,
  );

  // ── C. Granted-value samples ──────────────────────────────────────────────
  console.log('\nC. Granted-value samples');

  await seedUser('g_samples', { grantedValue: 250 });
  await sync('g_samples');
  let samples = (await getUser('g_samples')).grantedSamples;
  check(
    'the first sync records a sample of the granted total',
    samples?.length === 1 && samples[0].total === 250 && Date.now() - samples[0].ts < 60000,
    samples,
  );

  await unthrottle('g_samples', { grantedValue: 400 });
  await sync('g_samples');
  samples = (await getUser('g_samples')).grantedSamples;
  check('a second sync the same day adds no sample', samples.length === 1 && samples[0].total === 250, samples);

  await unthrottle('g_samples', {
    grantedSamples: [{ ts: Date.now() - DAY - 1000, total: 250 }],
  });
  await sync('g_samples');
  samples = (await getUser('g_samples')).grantedSamples;
  check('a day later the next sample records the new total', samples.length === 2 && samples[1].total === 400, samples);

  await seedUser('g_nogrant');
  await sync('g_nogrant');
  check('a player with no grants records 0, not a gap', (await getUser('g_nogrant')).grantedSamples?.[0]?.total === 0);

  const forty = Array.from({ length: 40 }, (_, i) => ({ ts: Date.now() - (41 - i) * DAY, total: i }));
  await seedUser('g_cap', { grantedValue: 99, grantedSamples: forty });
  await sync('g_cap');
  const capped = (await getUser('g_cap')).grantedSamples;
  check(
    'samples are capped at 40, dropping the oldest',
    capped.length === 40 && capped[0].total === 1 && capped[39].total === 99,
    { len: capped.length, first: capped[0], last: capped[39] },
  );

  // ── D. Weekly mission baselines ───────────────────────────────────────────
  console.log('\nD. Weekly mission baselines');

  await seedUser('w_base', { grantedValue: 75 });
  await sync('w_base');
  let wk = (await getUser('w_base')).weeklyMissions?.[weekId()];
  check(
    'the first sync of the week sets the starting value and granted total',
    wk?.startPortfolioValue === 1000 && wk?.startGrantedValue === 75,
    wk,
  );

  await unthrottle('w_base', { cash: 5000, grantedValue: 500 });
  await sync('w_base');
  wk = (await getUser('w_base')).weeklyMissions[weekId()];
  check('later syncs leave both alone', wk.startPortfolioValue === 1000 && wk.startGrantedValue === 75, wk);

  // A week recorded before startGrantedValue existed gets it filled in, without
  // moving the starting value.
  await seedUser('w_legacy', { grantedValue: 30, weeklyMissions: { [weekId()]: { startPortfolioValue: 800 } } });
  await sync('w_legacy');
  wk = (await getUser('w_legacy')).weeklyMissions[weekId()];
  check(
    'an older week gets its granted baseline added, the start value kept',
    wk.startPortfolioValue === 800 && wk.startGrantedValue === 30,
    wk,
  );

  // ── E. History and snapshots ──────────────────────────────────────────────
  console.log('\nE. History and snapshots');

  await seedUser('h_new');
  await sync('h_new');
  let h = await getUser('h_new');
  check('the first sync writes a history point', (await history('h_new')).length === 1);
  check(
    'and sets the 24h, 7d and 30d reference values',
    h.portfolioSnapshot24h?.value === 1000 &&
      h.portfolioSnapshot7d?.value === 1000 &&
      h.portfolioSnapshot30d?.value === 1000,
    h,
  );
  check('and the peak', h.peakPortfolioValue === 1000);

  await unthrottle('h_new', { cash: 1005 });
  await sync('h_new');
  check('a small move inside 10 minutes writes no history point', (await history('h_new')).length === 1);

  await unthrottle('h_new', { cash: 1100 });
  await sync('h_new');
  h = await getUser('h_new');
  check('a move over 1% does', (await history('h_new')).length === 2);
  check('the peak follows the value up', h.peakPortfolioValue === 1100);
  check('the 24h reference does not move within the day', h.portfolioSnapshot24h.value === 1000);

  await unthrottle('h_new', { cash: 900 });
  await sync('h_new');
  check('and the peak does not follow it down', (await getUser('h_new')).peakPortfolioValue === 1100);

  // 30-day reference: the value on record at or just before 30 days ago.
  await seedUser('h_30d', { cash: 2000 });
  const hist = userRef('h_30d').collection('portfolioHistory');
  await hist.add({ timestamp: Date.now() - 40 * DAY, value: 500 });
  await hist.add({ timestamp: Date.now() - 31 * DAY, value: 700 });
  await hist.add({ timestamp: Date.now() - 20 * DAY, value: 900 });
  await sync('h_30d');
  check(
    'the 30-day reference is the last value on record before 30 days ago',
    (await getUser('h_30d')).portfolioSnapshot30d?.value === 700,
    (await getUser('h_30d')).portfolioSnapshot30d,
  );

  await seedUser('h_young', { cash: 2000 });
  await userRef('h_young')
    .collection('portfolioHistory')
    .add({ timestamp: Date.now() - 5 * DAY, value: 1500 });
  await sync('h_young');
  check(
    'an account younger than 30 days measures from its first point',
    (await getUser('h_young')).portfolioSnapshot30d?.value === 1500,
  );

  await seedUser('h_week', {
    cash: 2000,
    portfolioSnapshot7d: { timestamp: Date.now() - 3 * DAY, value: 1600 },
    portfolioSnapshot24h: { timestamp: Date.now() - 2 * DAY, value: 1900 },
  });
  await sync('h_week');
  h = await getUser('h_week');
  check('weekly gain is measured from the 7-day reference', h.weeklyGain === 400, `weeklyGain=${h.weeklyGain}`);
  check('a 24h reference older than a day is refreshed', h.portfolioSnapshot24h.value === 2000);
  check('a 7d reference inside the week is kept', h.portfolioSnapshot7d.value === 1600);

  // ── F. Mission map pruning ────────────────────────────────────────────────
  console.log('\nF. Mission map pruning');

  await seedUser('p_prune', {
    dailyMissions: { '2026-01-01': {}, '2026-01-02': {}, '2026-01-03': {}, '2026-01-04': {} },
    weeklyMissions: { '2025-12-29': {}, '2026-01-05': {} },
  });
  await sync('p_prune');
  const pruned = await getUser('p_prune');
  check(
    'old daily mission days are pruned to the newest two',
    Object.keys(pruned.dailyMissions).sort().join() === '2026-01-03,2026-01-04',
    Object.keys(pruned.dailyMissions),
  );
  check(
    'the week just started is kept, along with the most recent other',
    Object.keys(pruned.weeklyMissions).length === 3 && pruned.weeklyMissions[weekId()],
    Object.keys(pruned.weeklyMissions),
  );

  // ── G. Achievements ───────────────────────────────────────────────────────
  console.log('\nG. Achievements');

  await seedUser('a_div', { cash: 3000, holdings: { AAA: 1, BBB: 1, CCC: 1, DDD: 1, EEE: 1 } });
  const div = await sync('a_div');
  check('five holdings earn DIVERSIFIED', div.newAchievements.includes('DIVERSIFIED'), div.newAchievements);
  check('a value over 2,500 earns BROKE_2K', div.newAchievements.includes('BROKE_2K'));
  check('but not BROKE_5K', !div.newAchievements.includes('BROKE_5K'));

  await unthrottle('a_div', {
    holdings: { AAA: 1, BBB: 1, CCC: 1, DDD: 1 },
    displayedAchievementPins: ['DIVERSIFIED', 'BROKE_2K'],
  });
  const undiv = await sync('a_div');
  const undivUser = await getUser('a_div');
  check('dropping to four holdings revokes DIVERSIFIED', undiv.revokedAchievements.includes('DIVERSIFIED'));
  check(
    'and strips it from the displayed pins',
    !undivUser.achievements.includes('DIVERSIFIED') && undivUser.displayedAchievementPins.join() === 'BROKE_2K',
    undivUser,
  );

  await seedUser('a_checkins', { totalCheckins: 14, discordId: '42' });
  const ci = await sync('a_checkins');
  check(
    'check-in and Discord achievements are awarded',
    ['DEDICATED_7', 'DEDICATED_14', 'DISCORD_LINKED'].every((a) => ci.newAchievements.includes(a)) &&
      !ci.newAchievements.includes('DEDICATED_30'),
    ci.newAchievements,
  );

  // ── H. Bankruptcy flag ────────────────────────────────────────────────────
  console.log('\nH. Bankruptcy flag');

  await seedUser('k_broke', { cash: 50 });
  await sync('k_broke');
  check('a value of 100 or less flags bankruptcy', (await getUser('k_broke')).isBankrupt === true);

  await unthrottle('k_broke', { cash: 400, bankruptAt: 123 });
  await sync('k_broke');
  check('recovering to 400 is not enough to clear it', (await getUser('k_broke')).isBankrupt === true);

  await unthrottle('k_broke', { cash: 600 });
  await sync('k_broke');
  const recovered = await getUser('k_broke');
  check(
    'recovering past 500 clears it and the date',
    recovered.isBankrupt === false && recovered.bankruptAt === undefined,
    recovered,
  );

  // ── I. Account guards ─────────────────────────────────────────────────────
  console.log('\nI. Account guards');

  check('sync needs a login', (await rejects(() => syncPortfolio.run({}, {}), /logged in/i)) === true);
  check('sync needs an account', (await rejects(() => sync('nobody'), /not found/i)) === true);
  for (const [uid, extra, pattern] of [
    ['i_banned', { isBanned: true }, /banned/i],
    ['i_wall', { requiresDiscordLink: true }, /link your discord/i],
  ] as const) {
    await seedUser(uid, extra);
    check(`${uid}: refused`, (await rejects(() => sync(uid), pattern)) === true);
    check(`${uid}: nothing written`, (await getUser(uid)).portfolioValue === undefined);
  }
}

it('syncPortfolio', main);
