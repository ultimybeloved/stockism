// Money-path test suite for missions and the daily check-in, against the LOCAL
// Firebase emulator. Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:missions
//
// Between them these are the biggest writers of grantedValue, the counter that
// nets free money out of every percent board and the season metric. A reward
// that pays without booking it shows up as trading skill: no error, no crash,
// just a wrong tier. Every payout check below also checks the booking.
//
// Sections:
//   A. Check-in: first claim       B. Check-in: streaks
//   C. Check-in: ladder top-up     D. Mission claims
//   E. Mission gating              F. Weekly missions
//   G. Reroll                      H. Account guards
//   I. Weekly Calls                J. Crew Rivalries

import { it } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

const require = createRequire(import.meta.url);

// Cloud Functions run in UTC. The check-in parses old "Mon Jan 27 2025" dates
// in local time, so the suite pins UTC to see what production sees.
process.env.TZ = 'UTC';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Loaded AFTER initializeApp so their top-level admin.firestore() binds to the emulator.
const { dailyCheckin, claimMissionReward, rerollMissions } =
  require('../../functions/src/missions/missions') as typeof import('../../functions/src/missions/missions');
const { makeWeeklyCall } =
  require('../../functions/src/missions/weeklyCalls') as typeof import('../../functions/src/missions/weeklyCalls');
const { recordChapterMarker, adminSetChapterNote } =
  require('../../functions/src/market/chapterMarkers') as typeof import('../../functions/src/market/chapterMarkers');
const { lockCallBaseline, resolveWeeklyCalls } =
  require('../../functions/src/missions/callResolution') as typeof import('../../functions/src/missions/callResolution');
const { settleRivalryWeek } =
  require('../../functions/src/crews/rivalries') as typeof import('../../functions/src/crews/rivalries');
const {
  getDailyMissions,
  getWeeklyMissions,
  DAILY_MISSIONS,
  WEEKLY_MISSIONS,
  CREW_UNDERDOG_MULT_MAX,
  RIVALRY,
  WEEKLY_CALL,
} = require('../../functions/src/shared/crews') as typeof import('../../functions/src/shared/crews');
const { missionWeekId, callPicksOpen } =
  require('../../functions/src/shared/rules/missions') as typeof import('../../functions/src/shared/rules/missions');
const { getLadderChips } =
  require('../../functions/src/shared/ladderMath') as typeof import('../../functions/src/shared/ladderMath');
const { CHECKIN_STREAK_REWARDS, CREW_MEMBERS, ADMIN_UID } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const DAY = 24 * 60 * 60 * 1000;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) < tol;
const ctx = (uid: string) => ({ auth: { uid } });
const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

const CREW = Object.keys(CREW_MEMBERS)[0]!;
const CREW_TICKERS = CREW_MEMBERS[CREW]!;
const RIVAL = Object.keys(CREW_MEMBERS)[1]!;
const MINE = CREW_TICKERS[0]!;
const THEIRS = CREW_MEMBERS[RIVAL]![0]!;
const SPARE = CREW_TICKERS[1]!;

// Same date maths as the backend (UTC days, weeks start at the Thursday reopen).
const isoDay = (d: Date) => d.toISOString().split('T')[0]!;
const today = () => isoDay(new Date());
const weekId = () => missionWeekId();

// Kept buys of three stocks, cheap, well down on the week, plus big sells of
// old shares, so every daily mission is done at once.
const BUY = { shares: 10, value: 1e6, low: 5 };
const FULL_DAILY = {
  buys: { [MINE]: BUY, [THEIRS]: BUY, [SPARE]: BUY },
  limitBuys: { [MINE]: BUY },
  heldSoldValue: 1e6,
  heldLossValue: 1e6,
  limitSoldValue: 1e6,
};
/** Weekly progress that satisfies the activity weeklies. */
const days7 = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [`2000-01-0${d}`, true]));
const FULL_WEEKLY = { tradeCount: 10, tradingDays: days7, checkinDays: days7 };
// Nearly all the value is in the crew, so the composition missions pass too.
const CREW_HOLDINGS = { [MINE]: 100, [THEIRS]: 10, [SPARE]: 10 };
const PRICES = { [MINE]: 1000, [THEIRS]: 1, [SPARE]: 1 };
const WEEK_OPEN = { [MINE]: 100, [THEIRS]: 100, [SPARE]: 100 };

/** A reroll seed under which the given mission is assigned to CREW right now. */
function seedAssigning(type: 'daily' | 'weekly', missionId: string) {
  for (let s = 0; s < 100000; s++) {
    const list = type === 'daily' ? getDailyMissions(today(), CREW, s) : getWeeklyMissions(CREW, weekId(), s);
    if (list.some((m) => m.id === missionId)) return s;
  }
  throw new Error(`no seed assigns ${missionId}`);
}
/** A daily mission that is NOT assigned under the given seed. */
function unassignedDaily(seed: number) {
  const assigned = new Set(getDailyMissions(today(), CREW, seed).map((m) => m.id));
  return Object.keys(DAILY_MISSIONS).find((id) => !assigned.has(id))!;
}

async function seedUser(uid: string, extra: Loose = {}) {
  await db
    .collection('users')
    .doc(uid)
    .set({
      displayName: uid,
      cash: 1000,
      holdings: {},
      costBasis: {},
      shorts: {},
      createdAt: ts(Date.now() - 30 * DAY),
      ...extra,
    });
}
/** A crew member whose missions for today and this week are all complete. */
async function seedMissionUser(uid: string, { seed = 0, extra = {} as Loose } = {}) {
  await seedUser(uid, {
    crew: CREW,
    holdings: CREW_HOLDINGS,
    dailyMissions: { [today()]: { ...FULL_DAILY } },
    weeklyMissions: { [weekId()]: { ...FULL_WEEKLY, ...(seed ? { rerollSeed: seed } : {}) } },
    ...extra,
  });
}
const getUser = async (uid: string) => (await db.collection('users').doc(uid).get()).data();
const getLadder = async (uid: string) => (await db.collection('ladderGameUsers').doc(uid).get()).data();
const setCrewMultiplier = (m: number | null) =>
  db
    .collection('market')
    .doc('crewStats')
    .set(m === null ? {} : { multipliers: { [CREW]: m } });

const rejects = async (fn: Loose, pattern: RegExp) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return pattern.test(e.message) ? true : e.message;
  }
};

async function main() {
  console.log('\n=== Missions and check-in money-path suite (emulator) ===');
  await db.collection('market').doc('current').set({ prices: PRICES, weekOpenPrices: WEEK_OPEN });
  await setCrewMultiplier(null);

  // ── A. Check-in: first claim ──────────────────────────────────────────────
  console.log('\nA. Check-in: first claim');

  await seedUser('ci_first');
  const first = await dailyCheckin.run({}, ctx('ci_first'));
  const firstUser = await getUser('ci_first');
  const base = CHECKIN_STREAK_REWARDS[0]!;
  check('a first check-in pays the day-1 reward', first.reward === base, `reward=${first.reward}`);
  check('the reward lands in cash', near(firstUser.cash, 1000 + base), `cash=${firstUser.cash}`);
  check(
    'and is booked as granted value, in full',
    near(firstUser.grantedValue, base),
    `grantedValue=${firstUser.grantedValue}`,
  );
  check('grantedDays is booked alongside it', firstUser.grantedDays > 0, `grantedDays=${firstUser.grantedDays}`);
  check('streak starts at 1', firstUser.checkinStreak === 1 && firstUser.maxCheckinStreak === 1);
  check('totalCheckins counts it', firstUser.totalCheckins === 1);
  check('today is marked for the daily missions', firstUser.dailyMissions?.[today()]?.checkedIn === true);
  check('and for the weekly check-in mission', firstUser.weeklyMissions?.[weekId()]?.checkinDays?.[today()] === true);
  const log = firstUser.transactionLog || [];
  const entry = log[log.length - 1] || {};
  check(
    'a CHECKIN entry with the right before/after is logged',
    entry.type === 'CHECKIN' && entry.bonus === base && entry.cashBefore === 1000 && entry.cashAfter === 1000 + base,
    entry,
  );

  check(
    'a second check-in the same day is refused',
    (await rejects(() => dailyCheckin.run({}, ctx('ci_first')), /already checked in/i)) === true,
  );
  const again = await getUser('ci_first');
  check(
    'and pays and books nothing',
    again.cash === firstUser.cash && again.grantedValue === firstUser.grantedValue,
    `cash=${again.cash} granted=${again.grantedValue}`,
  );

  // A full log keeps the newest 100 entries.
  await seedUser('ci_log', {
    transactionLog: Array.from({ length: 100 }, (_, i) => ({ type: 'BUY', n: i })),
  });
  await dailyCheckin.run({}, ctx('ci_log'));
  const logged = (await getUser('ci_log')).transactionLog;
  check(
    'the transaction log stays capped at 100, newest kept',
    logged.length === 100 && logged[99].type === 'CHECKIN' && logged[0].n === 1,
    `len=${logged.length}`,
  );

  // ── B. Check-in: streaks ──────────────────────────────────────────────────
  console.log('\nB. Check-in: streaks');

  await seedUser('ci_cont', { lastCheckin: ts(Date.now() - DAY), checkinStreak: 3, maxCheckinStreak: 3 });
  const cont = await dailyCheckin.run({}, ctx('ci_cont'));
  const contUser = await getUser('ci_cont');
  check('checking in the day after extends the streak', cont.newStreak === 4, `streak=${cont.newStreak}`);
  check(
    'and pays that day of the ladder',
    cont.reward === CHECKIN_STREAK_REWARDS[3] && near(contUser.grantedValue, CHECKIN_STREAK_REWARDS[3]!),
    `reward=${cont.reward} granted=${contUser.grantedValue}`,
  );
  check('max streak follows it up', contUser.maxCheckinStreak === 4);

  await seedUser('ci_cap', { lastCheckin: ts(Date.now() - DAY), checkinStreak: 40, maxCheckinStreak: 40 });
  const cap = await dailyCheckin.run({}, ctx('ci_cap'));
  check(
    'a long streak pays the top reward and no more',
    cap.reward === CHECKIN_STREAK_REWARDS[CHECKIN_STREAK_REWARDS.length - 1],
    `reward=${cap.reward}`,
  );

  await seedUser('ci_gap', { lastCheckin: ts(Date.now() - 2 * DAY), checkinStreak: 6, maxCheckinStreak: 9 });
  const gap = await dailyCheckin.run({}, ctx('ci_gap'));
  const gapUser = await getUser('ci_gap');
  check('missing a day resets the streak to 1', gap.newStreak === 1 && gap.reward === base, gap);
  check('but the best streak is kept', gapUser.maxCheckinStreak === 9, `max=${gapUser.maxCheckinStreak}`);

  const yesterday = new Date(Date.now() - DAY);
  await seedUser('ci_oldfmt', { lastCheckin: yesterday.toDateString(), checkinStreak: 2 });
  const oldFmt = await dailyCheckin.run({}, ctx('ci_oldfmt'));
  check('an old text-format date from yesterday still continues the streak', oldFmt.newStreak === 3, oldFmt);

  await seedUser('ci_oldtoday', { lastCheckin: new Date().toDateString(), checkinStreak: 2 });
  check(
    'an old text-format date from today still blocks a second claim',
    (await rejects(() => dailyCheckin.run({}, ctx('ci_oldtoday')), /already checked in/i)) === true,
  );

  await seedUser('ci_secs', { lastCheckin: { seconds: Math.floor((Date.now() - DAY) / 1000) }, checkinStreak: 1 });
  const secs = await dailyCheckin.run({}, ctx('ci_secs'));
  check('a plain {seconds} date also continues the streak', secs.newStreak === 2, secs);

  // ── C. Check-in: ladder top-up ────────────────────────────────────────────
  console.log('\nC. Check-in: ladder top-up');

  const newLadder = await getLadder('ci_first');
  check(
    'a first check-in opens the ladder with 500 in house chips',
    first.ladderTopUpAmount === 500 && newLadder?.balance === 500 && getLadderChips(newLadder) === 500,
    newLadder,
  );
  check('those chips are not booked as granted value', near(firstUser.grantedValue, base));

  await seedUser('ci_low');
  // A doc from before the chip migration: nonWithdrawable is a lifetime total,
  // and 290 of the 300 granted were since lost, so 10 chips are left.
  await db.collection('ladderGameUsers').doc('ci_low').set({
    uid: 'ci_low',
    balance: 40,
    nonWithdrawable: 300,
    totalLost: 290,
  });
  const low = await dailyCheckin.run({}, ctx('ci_low'));
  const lowLadder = await getLadder('ci_low');
  check(
    'a low ladder balance is topped up to 100',
    low.ladderTopUpAmount === 60 && lowLadder.balance === 100,
    lowLadder,
  );
  check(
    'the top-up is chips on top of what is left, not on the lifetime total',
    lowLadder.chipsMigrated === true && getLadderChips(lowLadder) === 70,
    `chips=${getLadderChips(lowLadder)}`,
  );
  check('so the 30 the player still owns stays withdrawable', lowLadder.balance - getLadderChips(lowLadder) === 30);

  await seedUser('ci_flush');
  await db
    .collection('ladderGameUsers')
    .doc('ci_flush')
    .set({ uid: 'ci_flush', balance: 250, nonWithdrawable: 0, chipsMigrated: true });
  const flush = await dailyCheckin.run({}, ctx('ci_flush'));
  const flushLadder = await getLadder('ci_flush');
  check(
    'a ladder balance of 100 or more is left alone',
    flush.ladderTopUpAmount === 0 && flushLadder.balance === 250 && getLadderChips(flushLadder) === 0,
    flushLadder,
  );

  // ── D. Mission claims ─────────────────────────────────────────────────────
  console.log('\nD. Mission claims');

  const [daily] = getDailyMissions(today(), CREW, 0);
  await seedMissionUser('m_claim');
  const claim = await claimMissionReward.run({ missionId: daily!.id, type: 'daily', reward: 999999 }, ctx('m_claim'));
  const claimUser = await getUser('m_claim');
  check('a finished daily mission pays its listed reward', claim.reward === daily!.reward, claim);
  check('a reward sent by the client is ignored', claimUser.cash === 1000 + daily!.reward, `cash=${claimUser.cash}`);
  check(
    'the reward is booked as granted value, in full',
    near(claimUser.grantedValue, daily!.reward),
    `grantedValue=${claimUser.grantedValue}`,
  );
  check('it is marked claimed', claimUser.dailyMissions[today()].claimed?.[daily!.id] === true);
  check('and counted', claimUser.totalMissionsCompleted === 1);

  check(
    'the same mission cannot be claimed twice',
    (await rejects(
      () => claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_claim')),
      /already claimed/i,
    )) === true,
  );
  const twice = await getUser('m_claim');
  check(
    'and the refused claim books nothing',
    twice.cash === claimUser.cash && twice.grantedValue === claimUser.grantedValue,
  );

  // Underdog multiplier.
  await setCrewMultiplier(1.5);
  await seedMissionUser('m_mult');
  const mult = await claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_mult'));
  const multUser = await getUser('m_mult');
  const multReward = Math.round(daily!.reward * 1.5);
  check('an underdog crew gets the multiplied reward', mult.reward === multReward, mult);
  check('and the multiplied amount is what gets booked', near(multUser.grantedValue, multReward));

  await setCrewMultiplier(50);
  await seedMissionUser('m_multcap');
  const capped = await claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_multcap'));
  check(
    'the multiplier is capped',
    capped.reward === Math.round(daily!.reward * CREW_UNDERDOG_MULT_MAX),
    `reward=${capped.reward}`,
  );
  await setCrewMultiplier(null);

  // Mission-count achievements.
  await seedMissionUser('m_ach', { extra: { totalMissionsCompleted: 9 } });
  await claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_ach'));
  const ach = await getUser('m_ach');
  check(
    'the 10th mission awards MISSION_10',
    ach.totalMissionsCompleted === 10 && (ach.achievements || []).includes('MISSION_10'),
    ach.achievements,
  );

  // ── E. Mission gating ─────────────────────────────────────────────────────
  console.log('\nE. Mission gating');

  await seedMissionUser('m_unassigned');
  check(
    'a finished mission that is not assigned today is refused',
    (await rejects(
      () => claimMissionReward.run({ missionId: unassignedDaily(0), type: 'daily' }, ctx('m_unassigned')),
      /not assigned/i,
    )) === true,
  );

  await seedUser('m_unfinished', { crew: CREW });
  check(
    'an unfinished mission is refused',
    (await rejects(
      () => claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_unfinished')),
      /not completed/i,
    )) === true,
  );

  // Players without a crew get missions too, from the non-crew pool.
  const [solo] = getDailyMissions(today(), null, 0);
  await seedMissionUser('m_nocrew', { extra: { crew: null } });
  const soloClaim = await claimMissionReward.run({ missionId: solo!.id, type: 'daily' }, ctx('m_nocrew'));
  const soloUser = await getUser('m_nocrew');
  check(
    'a player with no crew claims their own missions, at 1x',
    soloClaim.reward === solo!.reward && soloUser.cash === 1000 + solo!.reward,
    soloClaim,
  );
  check('and they do not count for any rivalry', !soloUser.weeklyMissions[weekId()].rivalry);
  check(
    'a crew-only mission is never theirs',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'CREW_MAJORITY', type: 'daily' }, ctx('m_nocrew')),
      /not assigned/i,
    )) === true,
  );

  // Switching crews hands out a different set; claims are capped by count, so
  // a full day's claims in the old crew leave nothing to claim in the new one.
  await seedMissionUser('m_switched', {
    extra: {
      dailyMissions: { [today()]: { ...FULL_DAILY, claimed: { OLD_A: true, OLD_B: true, OLD_C: true } } },
      weeklyMissions: { [weekId()]: { ...FULL_WEEKLY, claimed: { OLD_W: true } } },
    },
  });
  check(
    'after a full day of claims, a crew switch opens no new daily claims',
    (await rejects(
      () => claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('m_switched')),
      /claimed all your daily/i,
    )) === true,
  );
  const [, switchedWeekly] = getWeeklyMissions(CREW, weekId(), 0);
  check(
    'and no new weekly claim either (the Call does not count)',
    (await rejects(
      () => claimMissionReward.run({ missionId: switchedWeekly!.id, type: 'weekly' }, ctx('m_switched')),
      /claimed all your weekly/i,
    )) === true,
  );

  // Throwaway trades: a buy too small for the account, or one sold back.
  const crewSupportSeed = seedAssigning('daily', 'BUY_CREW_MEMBER');
  await seedMissionUser('m_tiny', {
    seed: crewSupportSeed,
    extra: {
      portfolioValue: 20000,
      dailyMissions: { [today()]: { buys: { [MINE]: { shares: 1, value: 60, low: 60 } } } },
    },
  });
  check(
    'a buy under 1% of net worth does not count',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'BUY_CREW_MEMBER', type: 'daily' }, ctx('m_tiny')),
      /not completed/i,
    )) === true,
  );
  await seedMissionUser('m_flip', { seed: crewSupportSeed, extra: { holdings: { [THEIRS]: 10 } } });
  check(
    'a buy that was sold back does not count',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'BUY_CREW_MEMBER', type: 'daily' }, ctx('m_flip')),
      /not completed/i,
    )) === true,
  );

  check(
    'a bad mission type is refused',
    (await rejects(
      () => claimMissionReward.run({ missionId: daily!.id, type: 'monthly' }, ctx('m_nocrew')),
      /invalid mission/i,
    )) === true,
  );

  // A reroll seed changes which missions are assigned, and claims follow it.
  const target = unassignedDaily(0);
  const rerolledSeed = seedAssigning('daily', target);
  await seedMissionUser('m_seeded', { seed: rerolledSeed });
  const seeded = await claimMissionReward.run({ missionId: target, type: 'daily' }, ctx('m_seeded'));
  check('after a reroll, the newly assigned mission can be claimed', seeded.success === true, seeded);

  const untouched = ['m_unassigned', 'm_unfinished', 'm_tiny', 'm_flip', 'm_switched'];
  for (const uid of untouched) {
    const u = await getUser(uid);
    check(`refused claim left ${uid} unpaid`, u.cash === 1000 && !u.grantedValue, `cash=${u.cash}`);
  }

  // ── F. Weekly missions ────────────────────────────────────────────────────
  console.log('\nF. Weekly missions');

  const streakSeed = seedAssigning('weekly', 'TRADING_STREAK');
  const weekly = WEEKLY_MISSIONS.TRADING_STREAK;
  await seedMissionUser('w_claim', {
    seed: streakSeed,
    extra: { portfolioValue: 100000, grantedValue: 0 },
  });
  await db
    .collection('users')
    .doc('w_claim')
    .update({
      [`weeklyMissions.${weekId()}.startPortfolioValue`]: 10000,
      [`weeklyMissions.${weekId()}.startGrantedValue`]: 0,
    });
  check(
    'the Call cannot be claimed by hand',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'WEEKLY_CALL', type: 'weekly' }, ctx('w_claim')),
      /pays out by itself/i,
    )) === true,
  );
  const wk = await claimMissionReward.run({ missionId: weekly!.id, type: 'weekly' }, ctx('w_claim'));
  const wkUser = await getUser('w_claim');
  check('a finished weekly mission pays its listed reward', wk.reward === weekly!.reward, wk);
  check('and books it as granted value', near(wkUser.grantedValue, weekly!.reward), `granted=${wkUser.grantedValue}`);
  check('it is marked claimed for this week', wkUser.weeklyMissions[weekId()].claimed?.[weekly!.id] === true);

  // Growth missions must not count free money as growth.
  const growthSeed = seedAssigning('weekly', 'PORTFOLIO_BUILDER');
  const need = WEEKLY_MISSIONS.PORTFOLIO_BUILDER!.requirement!;
  const start = 10000;
  // The whole rise this week is free money, booked as granted value.
  const freeRise = (start * (need + 5)) / 100;
  await seedMissionUser('w_grants', {
    seed: growthSeed,
    extra: { portfolioValue: start + freeRise, grantedValue: freeRise },
  });
  await db
    .collection('users')
    .doc('w_grants')
    .update({
      [`weeklyMissions.${weekId()}.startPortfolioValue`]: start,
      [`weeklyMissions.${weekId()}.startGrantedValue`]: 0,
    });
  check(
    'growth that is all free money does not complete a growth mission',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'PORTFOLIO_BUILDER', type: 'weekly' }, ctx('w_grants')),
      /not completed/i,
    )) === true,
  );

  await seedMissionUser('w_earned', {
    seed: growthSeed,
    extra: { portfolioValue: start + freeRise, grantedValue: 0 },
  });
  await db
    .collection('users')
    .doc('w_earned')
    .update({
      [`weeklyMissions.${weekId()}.startPortfolioValue`]: start,
      [`weeklyMissions.${weekId()}.startGrantedValue`]: 0,
    });
  const earned = await claimMissionReward.run({ missionId: 'PORTFOLIO_BUILDER', type: 'weekly' }, ctx('w_earned'));
  check('the same growth from trading does complete it', earned.success === true, earned);

  // Borrowing is not growth: a margin buy adds the stock to portfolioValue
  // without subtracting the loan.
  await seedMissionUser('w_margin', {
    seed: growthSeed,
    extra: { portfolioValue: start + freeRise, grantedValue: 0, marginUsed: freeRise },
  });
  await db
    .collection('users')
    .doc('w_margin')
    .update({
      [`weeklyMissions.${weekId()}.startPortfolioValue`]: start,
      [`weeklyMissions.${weekId()}.startGrantedValue`]: 0,
      [`weeklyMissions.${weekId()}.startMarginUsed`]: 0,
    });
  check(
    'growth that is all borrowed money does not complete a growth mission',
    (await rejects(
      () => claimMissionReward.run({ missionId: 'PORTFOLIO_BUILDER', type: 'weekly' }, ctx('w_margin')),
      /not completed/i,
    )) === true,
  );

  // ── G. Reroll ─────────────────────────────────────────────────────────────
  console.log('\nG. Reroll');

  await seedUser('r_ok', { crew: CREW });
  const reroll = await rerollMissions.run({}, ctx('r_ok'));
  const rerollUser = await getUser('r_ok');
  check('a reroll costs $50', rerollUser.cash === 950, `cash=${rerollUser.cash}`);
  check('and is not booked as granted value either way', !rerollUser.grantedValue);
  check(
    'it stores the new seed for the week',
    rerollUser.weeklyMissions[weekId()].rerolled === true &&
      rerollUser.weeklyMissions[weekId()].rerollSeed === reroll.rerollSeed,
  );
  check(
    'the reroll hands out a different weekly mission',
    getWeeklyMissions(CREW, weekId(), reroll.rerollSeed)[1]?.id !== getWeeklyMissions(CREW, weekId())[1]?.id,
  );
  check(
    'a second reroll in the same week is refused',
    (await rejects(() => rerollMissions.run({}, ctx('r_ok')), /already rerolled/i)) === true,
  );

  await seedMissionUser('r_claimed');
  await claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx('r_claimed'));
  check(
    'no reroll after claiming a reward',
    (await rejects(() => rerollMissions.run({}, ctx('r_claimed')), /after claiming/i)) === true,
  );

  await seedUser('r_poor', { crew: CREW, cash: 49 });
  check('no reroll without $50', (await rejects(() => rerollMissions.run({}, ctx('r_poor')), /need \$50/i)) === true);
  check('and the refused reroll costs nothing', (await getUser('r_poor')).cash === 49);

  // ── H. Account guards ─────────────────────────────────────────────────────
  console.log('\nH. Account guards');

  check('check-in needs a login', (await rejects(() => dailyCheckin.run({}, {}), /logged in/i)) === true);
  check('check-in needs an account', (await rejects(() => dailyCheckin.run({}, ctx('nobody')), /not found/i)) === true);

  await seedMissionUser('g_banned', { extra: { isBanned: true } });
  await seedMissionUser('g_wall', { extra: { requiresDiscordLink: true } });
  for (const [uid, pattern] of [
    ['g_banned', /banned/i],
    ['g_wall', /link your discord/i],
  ] as const) {
    check(`${uid}: check-in refused`, (await rejects(() => dailyCheckin.run({}, ctx(uid)), pattern)) === true);
    check(
      `${uid}: mission claim refused`,
      (await rejects(() => claimMissionReward.run({ missionId: daily!.id, type: 'daily' }, ctx(uid)), pattern)) ===
        true,
    );
    check(`${uid}: reroll refused`, (await rejects(() => rerollMissions.run({}, ctx(uid)), pattern)) === true);
    const u = await getUser(uid);
    check(`${uid}: nothing paid or booked`, u.cash === 1000 && !u.grantedValue, `cash=${u.cash}`);
  }

  await seedMissionUser('g_linked', { extra: { requiresDiscordLink: true, discordId: '123' } });
  const linked = await dailyCheckin.run({}, ctx('g_linked'));
  check('linking Discord lifts the wall', linked.success === true);

  await callsSection();
  await rivalrySection();
}

// ── I. Weekly Calls ─────────────────────────────────────────────────────────
async function callsSection() {
  console.log('\nI. Weekly Calls');
  const wk = weekId();
  await setCrewMultiplier(null);

  await seedUser('c_pick', { crew: CREW });
  if (callPicksOpen()) {
    const made = await makeWeeklyCall.run({ ticker: MINE.toLowerCase(), direction: 'up' }, ctx('c_pick'));
    const u = await getUser('c_pick');
    check('a Call is stored for the week', made.success && u.weeklyMissions[wk].call.ticker === MINE, u.weeklyMissions);
    await makeWeeklyCall.run({ ticker: MINE, direction: 'down' }, ctx('c_pick'));
    check(
      'and can be changed while picks are open',
      (await getUser('c_pick')).weeklyMissions[wk].call.direction === 'down',
    );
    check(
      'an unknown stock is refused',
      (await rejects(() => makeWeeklyCall.run({ ticker: 'NOPE', direction: 'up' }, ctx('c_pick')), /not trading/i)) ===
        true,
    );
  } else {
    check(
      'outside Thursday to Saturday a Call is refused',
      (await rejects(() => makeWeeklyCall.run({ ticker: MINE, direction: 'up' }, ctx('c_pick')), /open again/i)) ===
        true,
    );
  }
  check(
    'a Call needs a direction',
    (await rejects(() => makeWeeklyCall.run({ ticker: MINE, direction: 'sideways' }, ctx('c_pick')), /up or down/i)) ===
      true,
  );

  // Scoring: halt-start prices against the 20:55 lock.
  const call = (ticker: string, direction: string) => ({
    weeklyMissions: { [wk]: { call: { ticker, direction, at: 1 } } },
  });
  await db
    .collection('market')
    .doc('current')
    .set({ prices: { [MINE]: 100, [THEIRS]: 100, [SPARE]: 100 } });
  await lockCallBaseline();
  await db
    .collection('market')
    .doc('current')
    .set({ prices: { [MINE]: 105, [THEIRS]: 120, [SPARE]: 100.2 } });
  await seedUser('c_win', { crew: CREW, ...call(MINE, 'up') });
  await seedUser('c_big', { crew: CREW, ...call(THEIRS, 'up'), totalMissionsCompleted: 9 });
  await seedUser('c_loss', { crew: CREW, ...call(MINE, 'down') });
  await seedUser('c_push', { ...call(SPARE, 'up') });
  await setCrewMultiplier(1.5);
  const res = await resolveWeeklyCalls();
  check('every Call is scored', res.scored === (callPicksOpen() ? 5 : 4), res); // c_pick's too, when made

  const win = await getUser('c_win');
  const wcall = win.weeklyMissions[wk].call;
  check(
    'a right Call pays the reward times the underdog bonus',
    wcall.result === 'win' &&
      near(win.cash, 1000 + WEEKLY_CALL.reward * 1.5) &&
      near(win.grantedValue, WEEKLY_CALL.reward * 1.5),
    wcall,
  );
  check(
    'it counts as a finished mission and for the rivalry',
    win.totalMissionsCompleted === 1 && win.weeklyMissions[wk].rivalry?.count === 1,
  );
  const big = await getUser('c_big');
  check(
    'a 10%+ move pays the big reward and can earn a milestone',
    big.weeklyMissions[wk].call.result === 'big' &&
      near(big.cash, 1000 + WEEKLY_CALL.bigReward * 1.5) &&
      (big.achievements || []).includes('MISSION_10'),
    big.weeklyMissions[wk].call,
  );
  const loss = await getUser('c_loss');
  const push = await getUser('c_push');
  check('a wrong Call pays nothing', loss.weeklyMissions[wk].call.result === 'loss' && loss.cash === 1000);
  check('a flat stock is a push', push.weeklyMissions[wk].call.result === 'push' && push.cash === 1000);

  check(
    'the lasting Call record counts the result',
    win.callRecord?.wins === 1 && win.callRecord?.streak === 1 && loss.callRecord?.losses === 1,
    win.callRecord,
  );
  check('a push is recorded but not as right or wrong', push.callRecord?.pushes === 1 && !push.callRecord?.wins);
  const board = (await db.collection('leaderboard').doc('calls').get()).data();
  check(
    'the callers board ranks the big Call first and is public-safe',
    board?.rows?.[0]?.uid === 'c_big' && board.rows.every((r: Loose) => !('cash' in r)),
    board?.rows,
  );

  const marker = await recordChapterMarker();
  check(
    'the chapter marker records what the review did',
    marker.moves[MINE] === 5 && marker.moves[THEIRS] === 20 && !(SPARE in marker.moves),
    marker.moves,
  );
  await adminSetChapterNote.run({ weekId: wk, label: 'Chapter 1', note: 'Test' }, { auth: { uid: ADMIN_UID } });
  await recordChapterMarker();
  const markers = (await db.collection('market').doc('chapterMarkers').get()).data()?.markers || [];
  check(
    'a re-run keeps one marker per week and the admin note',
    markers.filter((m: Loose) => m.weekId === wk).length === 1 && markers[0].label === 'Chapter 1',
    markers,
  );

  const again = await resolveWeeklyCalls();
  check('re-running pays nobody twice', again.scored === 0 && (await getUser('c_win')).cash === win.cash, again);
  check('and does not count the Call twice', (await getUser('c_win')).callRecord?.calls === 1);
  await setCrewMultiplier(null);

  // A chapter break: nothing moved during the halt, so every Call gets the consolation.
  await db
    .collection('market')
    .doc('current')
    .set({ prices: { [MINE]: 100, [THEIRS]: 100, [SPARE]: 100 } });
  await lockCallBaseline();
  await seedUser('c_brk', { crew: CREW, ...call(MINE, 'down') });
  await resolveWeeklyCalls();
  const brk = await getUser('c_brk');
  check(
    'a chapter break pays every Call the consolation',
    brk.weeklyMissions[wk].call.result === 'break' &&
      near(brk.cash, 1000 + WEEKLY_CALL.breakReward) &&
      brk.weeklyMissions[wk].rivalry?.count === 1,
    brk.weeklyMissions[wk].call,
  );
  await db.collection('market').doc('current').set({ prices: PRICES, weekOpenPrices: WEEK_OPEN });
}

// ── J. Crew Rivalries ───────────────────────────────────────────────────────
async function rivalrySection() {
  console.log('\nJ. Crew Rivalries');
  const wk = '2020-01-02'; // a week no other section writes to
  const rv = (crew: string, count: number, checkin = true) => ({
    crew,
    weeklyMissions: { [wk]: { rivalry: { crew, count }, ...(checkin ? { checkinDays: { [wk]: true } } : {}) } },
  });
  await db
    .collection('rivalries')
    .doc(wk)
    .set({ matches: [{ crews: [CREW, RIVAL] }] });
  // Active = finished a mission in the crew. CREW: 1 of 2 qualified (50%).
  // RIVAL: 1 of 3 (33%); r5 only checked in and r6 finished elsewhere, so
  // neither counts against it.
  await seedUser('r1', rv(CREW, RIVALRY.qualifyMissions));
  await seedUser('r2', rv(CREW, 2));
  await seedUser('r3', rv(RIVAL, RIVALRY.qualifyMissions + 2));
  await seedUser('r4', rv(RIVAL, 1));
  await seedUser('r5', rv(RIVAL, 0));
  await seedUser('r7', rv(RIVAL, 1, false));
  // Five missions, but finished in another crew before switching.
  await seedUser('r6', { ...rv(RIVAL, 0), weeklyMissions: { [wk]: { rivalry: { crew: CREW, count: 6 } } } });
  const snap = await db.collection('users').get();
  const users = snap.docs.map((d: Loose) => ({ id: d.id, data: d.data() }));

  const out = await settleRivalryWeek(wk, users, { multipliers: { [RIVAL]: 2 } });
  check('the bigger share of active members wins', out?.winners?.join() === CREW, out?.winners);
  const r1 = await getUser('r1');
  const r3 = await getUser('r3');
  check(
    'a qualified winner gets the win reward',
    near(r1.cash, 1000 + RIVALRY.winReward) && near(r1.grantedValue, RIVALRY.winReward),
    r1.cash,
  );
  check(
    'a qualified loser gets the consolation, times their bonus',
    near(r3.cash, 1000 + RIVALRY.loseReward * 2),
    r3.cash,
  );
  check(
    'members who did not qualify get nothing',
    (await getUser('r2')).cash === 1000 && (await getUser('r4')).cash === 1000,
  );
  check('missions finished in another crew do not count', (await getUser('r6')).cash === 1000);
  check(
    'a member who only checked in does not count against the crew',
    out?.results?.[RIVAL]?.active === 3 && out?.results?.[CREW]?.active === 2,
    out?.results,
  );
  const board = (await db.collection('rivalries').doc(wk).get()).data();
  check(
    'results are stored',
    board.settled === true && board.results[CREW].won === true && board.results[RIVAL].won === false,
    board.results,
  );

  await settleRivalryWeek(wk, users, null);
  check('settling again pays nobody twice', (await getUser('r1')).cash === r1.cash);
}

it('missions and check-in', main);
