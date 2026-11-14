// Mission Autopilot (the shop perk) against the LOCAL Firestore emulator, never
// production: buying it, what a run pays, and who it leaves alone.
//
// Run via: npm run test:autopilot

import { it, vi } from 'vitest';
import { createRequire } from 'module';
import { check, type Loose } from './harness';

process.env.TZ = 'UTC';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { purchasePin, claimMissionReward } =
  require('../../functions/src/missions/missions') as typeof import('../../functions/src/missions/missions');
const { autoClaimMissions } =
  require('../../functions/src/missions/claimMission') as typeof import('../../functions/src/missions/claimMission');
const { getDailyMissions, getWeeklyMissions } =
  require('../../functions/src/shared/crews') as typeof import('../../functions/src/shared/crews');
const { missionWeekId, weeklyMissionsOpen } =
  require('../../functions/src/shared/rules/missions') as typeof import('../../functions/src/shared/rules/missions');
const { MISSION_AUTOPILOT_PRICE, MISSION_AUTOPILOT_IDLE_DAYS } =
  require('../../functions/src/shared/rules/economy') as typeof import('../../functions/src/shared/rules/economy');
const { CREW_MEMBERS } =
  require('../../functions/src/shared/constants') as typeof import('../../functions/src/shared/constants');

const DAY = 24 * 60 * 60 * 1000;
if (!weeklyMissionsOpen(missionWeekId())) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY, shouldAdvanceTime: true });
}

const CREW = Object.keys(CREW_MEMBERS)[0]!;
const ctx = (uid: string) => ({ auth: { uid } });
const today = () => new Date().toISOString().split('T')[0]!;
const user = (uid: string) => db.collection('users').doc(uid);
const read = async (uid: string): Promise<Loose> => (await user(uid).get()).data();
const sum = (list: { reward: number }[]) => list.reduce((s, m) => s + m.reward, 0);

/** A crew member who has done nothing at all today or this week. */
const seed = (uid: string, extra: Loose = {}) =>
  user(uid).set({
    displayName: uid,
    cash: 1000,
    holdings: {},
    costBasis: {},
    shorts: {},
    crew: CREW,
    discordId: `discord_${uid}`,
    lastActive: Date.now(),
    createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 90 * DAY),
    ...extra,
  });

const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

async function main() {
  await db.collection('market').doc('current').set({ prices: {} });
  await db.collection('market').doc('crewStats').set({});
  const daily = getDailyMissions(today(), CREW, 0, false);
  const weekly = getWeeklyMissions(CREW, missionWeekId(), 0);
  const all = sum(daily) + sum(weekly);
  const count = daily.length + weekly.length;

  // --- Buying ---
  await seed('poor', { cash: MISSION_AUTOPILOT_PRICE - 1 });
  check('too little money is refused', await refused(() => purchasePin.run({ action: 'buyAutopilot' }, ctx('poor'))));
  check('and nothing is granted', !(await read('poor')).missionAutopilot);

  await seed('rich', { cash: MISSION_AUTOPILOT_PRICE + 1000, totalMissionsCompleted: 24 });
  await purchasePin.run({ action: 'buyAutopilot' }, ctx('rich'));
  let rich = await read('rich');
  check('buying turns it on', rich.missionAutopilot === true);
  check('the price is charged and the missions pay at once', rich.cash === 1000 + all, rich.cash);
  check(
    'every daily mission is claimed',
    daily.every((m) => rich.dailyMissions?.[today()]?.claimed?.[m.id]),
  );
  check(
    'every weekly mission is claimed',
    weekly.every((m) => rich.weeklyMissions?.[missionWeekId()]?.claimed?.[m.id]),
  );
  check('the rewards are booked as granted value', rich.grantedValue === all, rich.grantedValue);
  check('the lifetime mission count does not move', rich.totalMissionsCompleted === 24);
  check('so no shop credit milestone is paid', !rich.shopCredit);
  check('the crew counts them for the Rivalry', rich.weeklyMissions[missionWeekId()].rivalry?.count === count, {
    rivalry: rich.weeklyMissions[missionWeekId()].rivalry,
  });
  const board = (await db.collection('rivalries').doc(missionWeekId()).get()).data();
  check('and the live board shows them qualified', board?.crews?.[CREW]?.qualified?.rich === true);
  const ledger = await db.collection('ledger').where('uid', '==', 'rich').get();
  const types = ledger.docs.map((d: Loose) => d.data().type);
  check(
    'one purchase entry and one entry per mission',
    types.filter((t: string) => t === 'autopilot_purchase').length === 1 &&
      types.filter((t: string) => t === 'mission_reward').length === count,
    types,
  );

  check('it cannot be bought twice', await refused(() => purchasePin.run({ action: 'buyAutopilot' }, ctx('rich'))));
  check('a second run the same day pays nothing', (await autoClaimMissions('rich')) === 0);
  rich = await read('rich');
  check('cash unchanged after the second run', rich.cash === 1000 + all, rich.cash);

  // --- Who it leaves alone ---
  await seed('plain');
  check('an account without the perk is not touched', (await autoClaimMissions('plain')) === 0);
  check(
    'and cannot claim an unfinished mission by hand',
    await refused(() => claimMissionReward.run({ missionId: daily[0]!.id, type: 'daily' }, ctx('plain'))),
  );

  await seed('banned', { missionAutopilot: true, isBanned: true });
  check(
    'a banned owner is not paid',
    (await autoClaimMissions('banned')) === 0 && (await read('banned')).cash === 1000,
  );

  await seed('away', { missionAutopilot: true, lastActive: Date.now() - (MISSION_AUTOPILOT_IDLE_DAYS + 1) * DAY });
  check(
    'an owner away too long is not paid',
    (await autoClaimMissions('away')) === 0 && (await read('away')).cash === 1000,
  );

  await seed('half', { missionAutopilot: true, dailyMissions: { [today()]: { claimed: { [daily[0]!.id]: true } } } });
  check('missions already claimed by hand are skipped', (await autoClaimMissions('half')) === count - 1);
  check('and only the rest is paid', (await read('half')).cash === 1000 + all - daily[0]!.reward);

  await seed('solo', { missionAutopilot: true, crew: null });
  const soloPaid = await autoClaimMissions('solo');
  check('an owner without a crew is still paid', soloPaid > 0 && (await read('solo')).cash > 1000);
  check('but has no Rivalry record', !(await read('solo')).weeklyMissions?.[missionWeekId()]?.rivalry);
}

it('mission autopilot', main);
