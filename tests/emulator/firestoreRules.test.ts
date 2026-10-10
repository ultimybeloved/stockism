// Verifies firestore.rules against the LOCAL emulator (never production).
// Seeds a user doc with the Admin SDK (bypasses rules), then acts AS that
// signed-in user through the client SDK (rules enforced) and checks that:
//   - the cash-printing / impersonation exploits are now blocked, and
//   - every legitimate preference write the app makes still succeeds.
//
// Run via: npm run test:rules

import { it } from 'vitest';
import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import { check as record, type Loose } from './harness';

const PROJECT_ID = 'stockism-abb28';

// emulators:exec injects FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST
// into this process. Fall back to defaults when run against a manual emulator.
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const [AUTH_HOST, AUTH_PORT] = (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099').split(':');

process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${AUTH_HOST}:${AUTH_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = admin.firestore();

const clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-emulator-key' });
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, `http://${AUTH_HOST}:${AUTH_PORT}`, { disableWarnings: true });
console.log(`firestore=${FIRESTORE_HOST}:${FIRESTORE_PORT} auth=${AUTH_HOST}:${AUTH_PORT}`);
const clientDb = getFirestore(clientApp);
connectFirestoreEmulator(clientDb, FIRESTORE_HOST, Number(FIRESTORE_PORT));

const EMAIL = 'rulestest@example.com';
const PASSWORD = 'password123';

// expectAllowed: the write must succeed. expectBlocked: it must be rejected.
async function check(label: string, mode: string, fields: Loose) {
  const ref = doc(clientDb, 'users', uid);
  try {
    await updateDoc(ref, fields);
    record(`${label} (${mode})`, mode === 'allowed', 'write was ALLOWED but should be blocked');
  } catch (err) {
    const denied = err.code === 'permission-denied' || /PERMISSION_DENIED/.test(err.message);
    record(
      `${label} (${mode})`,
      mode === 'blocked' && denied,
      `expected ${mode === 'blocked' ? 'permission-denied' : 'success'}, got: ${err.code || err.message}`,
    );
  }
}

let uid: string;

// Same idea for reads and writes on other collections.
async function checkAccess(label: string, mode: string, op: () => Promise<unknown>) {
  try {
    await op();
    record(`${label} (${mode})`, mode === 'allowed', 'access was ALLOWED but should be blocked');
  } catch (err) {
    const denied = err.code === 'permission-denied' || /PERMISSION_DENIED/.test(err.message);
    record(`${label} (${mode})`, mode === 'blocked' && denied, `got: ${err.code || err.message}`);
  }
}

async function main() {
  // Create + sign in the test user.
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(clientAuth, EMAIL, PASSWORD);
  } catch {
    cred = await signInWithEmailAndPassword(clientAuth, EMAIL, PASSWORD);
  }
  uid = cred.user.uid;

  // Seed the user doc as admin (bypasses rules), mirroring a real account.
  await adminDb
    .collection('users')
    .doc(uid)
    .set({
      displayName: 'RulesTester',
      displayNameLower: 'rulestester',
      cash: 10000,
      holdings: {},
      shorts: {},
      marginUsed: 0,
      marginEnabled: false,
      eventPositions: {},
      checkinStreak: 0,
      darkMode: true,
      drip: {},
      activeCosmetics: {},
      watchlist: [],
      // Season titles: one granted, so the "equip what you own" rule has both a
      // legal and an illegal case to test against.
      ownedTitles: ['season_1_gold'],
      titleMeta: { season_1_gold: 'Season 1 Gold' },
      createdAt: admin.firestore.Timestamp.now(),
    });

  console.log('\n── Exploits that MUST now be blocked ─────────────────────────');
  await check('forge prediction winnings (eventPositions)', 'blocked', {
    eventPositions: { rigged: { shares: { YES: 999999 }, costBasis: 0, settled: false } },
  });
  await check('reset daily check-in cooldown (lastCheckin)', 'blocked', {
    lastCheckin: Date.now() - 86400000,
  });
  await check('forge check-in streak (checkinStreak)', 'blocked', { checkinStreak: 9999 });
  await check('grant self cash', 'blocked', { cash: 1000000 });
  await check('enable margin (bypass $2k gate)', 'blocked', { marginEnabled: true });
  await check('change display name (bypass uniqueness)', 'blocked', { displayName: 'admin' });
  await check('grant self holdings', 'blocked', { holdings: { JAY: 100000 } });
  await check('clear short collateral', 'blocked', { shorts: {}, marginUsed: -5000 });
  await check('mixed legit + illegit in one write', 'blocked', { darkMode: false, cash: 50000 });
  // activeTitle is on the preference allowlist, which only says the key may
  // change — it never said what could go in it, so any string at all was
  // accepted for a field rendered next to the player's name.
  await check('equip a title never earned', 'blocked', { activeTitle: 'season_9_diamond' });
  await check('equip a junk title string', 'blocked', { activeTitle: 'Actual Site Admin' });
  await check('grant self a title', 'blocked', { ownedTitles: ['season_9_diamond'] });
  await check('write own title label', 'blocked', { 'titleMeta.season_1_gold': 'Site Owner' });

  console.log('\n── Legitimate preference writes that MUST still work ─────────');
  await check('toggle dark mode', 'allowed', { darkMode: false });
  await check('toggle color-blind mode', 'allowed', { colorBlindMode: true });
  await check('toggle public profile', 'allowed', { isPublic: true });
  await check('complete onboarding', 'allowed', { onboardingComplete: true });
  await check('complete margin tutorial', 'allowed', { marginTutorialCompleted: true });
  await check('complete ladder tutorial', 'allowed', { ladderTutorial2Completed: true });
  await check('update watchlist', 'allowed', { watchlist: ['JAY', 'GUN'] });
  await check('enable DRIP on a ticker', 'allowed', { 'drip.JAY': true });
  await check('disable DRIP on a ticker', 'allowed', { 'drip.JAY': deleteField() });
  await check('set shop pin order', 'allowed', { displayedShopPins: ['a', 'b'] });
  await check('set achievement pin order', 'allowed', { displayedAchievementPins: ['x'] });
  await check('toggle crew pin', 'allowed', { displayCrewPin: true });
  await check('equip a cosmetic', 'allowed', { 'activeCosmetics.banner': 'gold' });
  await check('equip a title actually earned', 'allowed', { activeTitle: 'season_1_gold' });
  await check('clear the equipped title', 'allowed', { activeTitle: null });

  console.log('\n── History records ───────────────────────────────────────────');
  await adminDb.collection('eventTrades').doc('mine').set({ uid, marketId: 'm', action: 'buy', shares: 1, cash: 1 });
  await adminDb.collection('eventTrades').doc('theirs').set({ uid: 'someone_else', marketId: 'm', action: 'buy' });
  await adminDb
    .collection('deletedUsers')
    .doc('gone')
    .set({ uid: 'gone', data: { signupIp: '1.2.3.4' } });
  await checkAccess('read own market history', 'allowed', () => getDoc(doc(clientDb, 'eventTrades', 'mine')));
  await checkAccess("read another player's market history", 'blocked', () =>
    getDoc(doc(clientDb, 'eventTrades', 'theirs')),
  );
  await checkAccess('forge a market history record', 'blocked', () =>
    setDoc(doc(clientDb, 'eventTrades', 'forged'), { uid, action: 'payout', cash: 1e6 }),
  );
  await checkAccess('read a deleted account copy', 'blocked', () => getDoc(doc(clientDb, 'deletedUsers', 'gone')));
}

it('firestore.rules on the user doc', main);
