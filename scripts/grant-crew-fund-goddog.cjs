'use strict';

// Crew Fund for God Dog (2026-10-30, Darth YG): God Dog has no crew ETF, so
// Crew Fund ("Buy your crew's ETF") could never be finished. It left their
// rotation on 2026-10-31. This marks it claimed and pays it, exactly as a
// normal claim would (crew multiplier, mission count, Mission Machine, rivalry,
// milestone credit, ledger), for every God Dog member who has it on today's
// list and hasn't claimed it.
//
//   npx tsx scripts/grant-crew-fund-goddog.cjs            (dry run)
//   npx tsx scripts/grant-crew-fund-goddog.cjs --confirm  (pays it)
//   --day=2026-10-29  an earlier day instead of today (Crew Fund started 10-29).
//   That day's list changed at the 21:00 reopen if the player rerolled, so it
//   counts if Crew Fund was on the list under either week's reroll.
//
// Safe to re-run: the claimed flag is checked inside each transaction.

const fs = require('fs');
const path = require('path');
// The functions' own firebase-admin, so the helpers below share this app.
const admin = require('../functions/node_modules/firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { getDailyMissions, getCrewMultiplier, DAILY_MISSIONS } = require('../functions/src/shared/crews');
const {
  holdsShortForMissions,
  nextRivalry,
  rivalryQualified,
} = require('../functions/src/shared/rules/missionProgress');
const { missionCreditFor } = require('../functions/src/shared/rules/shop');
const { grantedValueUpdate } = require('../functions/src/shared/equity');
const { recordLedger } = require('../functions/src/shared/ledger');
const { noteRivalryActivity } = require('../functions/src/shared/rivalries');
const { missionAchievementFor } = require('../functions/src/missions/missionChecks');
const { getWeekId } = require('../functions/src/shared/tradeRecords');

const CREW = 'GOD_DOG';
const MISSION = 'CREW_FUND';
const CONFIRM = process.argv.includes('--confirm');
const DAY_ARG = process.argv.find((a) => a.startsWith('--day='))?.slice(6);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const main = async () => {
  const now = Date.now();
  const today = DAY_ARG || new Date(now).toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`Bad --day: ${DAY_ARG}`);
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  const dayEnd = Math.min(now, dayStart + 86400000 - 1);
  // The weeks the day's list could have been drawn under (it can span the reopen).
  const weeks = [...new Set([getWeekId(dayStart), getWeekId(dayEnd)])];
  const weekId = getWeekId(now);
  const stats = (await db.doc('market/crewStats').get()).data() || null;
  const reward = Math.round(DAILY_MISSIONS[MISSION].reward * getCrewMultiplier(stats, CREW));

  const snap = await db.collection('users').where('crew', '==', CREW).get();
  const list = [];
  for (const d of snap.docs) {
    const u = d.data();
    if (u.isBot || u.isBanned) continue;
    const holds = holdsShortForMissions(u, u.dailyMissions?.[today], dayEnd);
    const had = weeks.some((w) =>
      getDailyMissions(today, CREW, u.weeklyMissions?.[w]?.rerollSeed || 0, holds).some((m) => m.id === MISSION),
    );
    if (!had) continue;
    if (u.dailyMissions?.[today]?.claimed?.[MISSION]) continue;
    list.push({ uid: d.id, name: u.displayName || d.id });
  }
  console.log(`${today}: ${list.length} God Dog players have Crew Fund unclaimed, ${money(reward)} each`);
  for (const r of list) console.log(`  ${r.name}`);
  if (!CONFIRM) {
    console.log('Dry run. Nothing paid. Re-run with --confirm to pay.');
    return;
  }

  let paid = 0;
  for (const r of list) {
    const userRef = db.collection('users').doc(r.uid);
    const result = await db.runTransaction(async (tx) => {
      const user = await tx.get(userRef);
      const u = user.data();
      if (!u || u.dailyMissions?.[today]?.claimed?.[MISSION]) return null;
      const newTotal = (u.totalMissionsCompleted || 0) + 1;
      const wp = u.weeklyMissions?.[weekId] || {};
      const rivalry = nextRivalry(wp, CREW);
      const updates = {
        cash: (u.cash || 0) + reward,
        totalMissionsCompleted: newTotal,
        ...grantedValueUpdate(reward),
        [`dailyMissions.${today}.claimed.${MISSION}`]: true,
        [`weeklyMissions.${weekId}.dailyClaims`]: admin.firestore.FieldValue.increment(1),
        [`weeklyMissions.${weekId}.rivalry`]: rivalry,
      };
      const earned = missionAchievementFor(newTotal, u.achievements);
      if (earned) updates.achievements = admin.firestore.FieldValue.arrayUnion(earned);
      const credit = missionCreditFor(newTotal);
      if (credit) updates.shopCredit = (u.shopCredit || 0) + credit;
      tx.update(userRef, updates);
      recordLedger(tx, {
        uid: r.uid,
        type: 'mission_reward',
        amount: reward,
        cashAfter: (u.cash || 0) + reward,
        ref: MISSION,
        detail: { missionType: 'daily', grantedBy: 'admin' },
      });
      recordLedger(tx, {
        uid: r.uid,
        type: 'mission_credit',
        account: 'credit',
        amount: credit,
        cashAfter: (u.shopCredit || 0) + credit,
        ref: MISSION,
        detail: { missions: newTotal },
      });
      return { qualified: rivalryQualified({ rivalry }, CREW) };
    });
    if (!result) continue;
    paid += reward;
    await noteRivalryActivity(weekId, CREW, r.uid, result.qualified);
    await userRef.collection('notifications').add({
      type: 'system',
      title: 'Crew Fund completed',
      message: `God Dog has no crew ETF, so Crew Fund couldn't be finished. It's been completed for you and paid ${money(reward)}. It won't show up for God Dog anymore.`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      data: { amount: reward },
    });
    console.log(`  paid ${r.name}`);
  }
  console.log(`Paid ${money(paid)} to ${paid / reward || 0} players.`);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
